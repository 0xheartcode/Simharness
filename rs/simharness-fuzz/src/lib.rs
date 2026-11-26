//! Two advanced-tier foundations (#42).
//!
//! `coverage`: a coverage-guided fuzzer (the AFL idea at its core). It keeps a
//! corpus of inputs, and an input that reaches new coverage is kept and mutated
//! further, so the search builds its way toward states a blind random search
//! would practically never reach. The target reports its own coverage, which is
//! the clean abstraction over real edge instrumentation.
//!
//! `bytes`: a byte-level channel (ADR-002's phase-7 seam). It fragments a byte
//! stream into seeded chunks that do not respect frame boundaries, so a system
//! under test's framing code runs under fragmentation. A framer that assumes one
//! read is one frame breaks; a buffering framer survives. This is the class of
//! split-frame bug that message-level delivery can never expose.
//!
//! Determinism (ADR-005): seeded PRNG only, ordered `BTreeSet`, no clock, no
//! threads.

use std::collections::BTreeSet;

/// A small deterministic PRNG (splitmix64) shared by both tiers.
struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u64) -> Self {
        Self {
            state: seed ^ 0x9e37_79b9_7f4a_7c15,
        }
    }
    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next_u64() % n as u64) as usize
        }
    }
    fn byte(&mut self) -> u8 {
        (self.next_u64() & 0xff) as u8
    }
}

/// Coverage-guided fuzzing.
pub mod coverage {
    use super::{BTreeSet, Rng};

    /// What running an input produced: the coverage it reached, and whether it hit a bug.
    pub struct Outcome {
        pub coverage: Vec<u64>,
        pub bug: bool,
    }

    /// A fuzz target: run an input, report coverage and whether it is a bug.
    pub trait Target {
        fn run(&self, input: &[u8]) -> Outcome;
    }

    /// The result of a fuzz campaign.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct FuzzResult {
        /// The crashing input, if one was found.
        pub bug_input: Option<Vec<u8>>,
        /// How many initial seeds the corpus grew to.
        pub corpus: usize,
        /// Distinct coverage points reached.
        pub coverage: usize,
        /// Iterations run before returning.
        pub iterations: usize,
    }

    fn mutate(base: &[u8], rng: &mut Rng) -> Vec<u8> {
        let mut out = base.to_vec();
        if out.is_empty() || rng.below(2) == 0 {
            out.push(rng.byte()); // grow
        } else {
            let i = rng.below(out.len());
            out[i] = rng.byte(); // flip
        }
        out
    }

    /// Coverage-guided fuzzing: keep inputs that reach new coverage and mutate
    /// from the corpus, so the search compounds toward deep states.
    pub fn coverage_guided_fuzz<T: Target>(target: &T, seed: u64, iterations: usize) -> FuzzResult {
        let mut rng = Rng::new(seed);
        let mut corpus: Vec<Vec<u8>> = vec![Vec::new()];
        let mut seen: BTreeSet<u64> = BTreeSet::new();
        for c in target.run(&[]).coverage {
            seen.insert(c);
        }
        for it in 0..iterations {
            let base = corpus[rng.below(corpus.len())].clone();
            let input = mutate(&base, &mut rng);
            let out = target.run(&input);
            if out.bug {
                return FuzzResult {
                    bug_input: Some(input),
                    corpus: corpus.len(),
                    coverage: seen.len(),
                    iterations: it + 1,
                };
            }
            let mut novel = false;
            for c in out.coverage {
                if seen.insert(c) {
                    novel = true;
                }
            }
            if novel {
                corpus.push(input);
            }
        }
        FuzzResult {
            bug_input: None,
            corpus: corpus.len(),
            coverage: seen.len(),
            iterations,
        }
    }

    /// A blind baseline: generate random inputs with no coverage feedback. Used
    /// to show what coverage guidance buys.
    pub fn undirected_fuzz<T: Target>(target: &T, seed: u64, iterations: usize) -> FuzzResult {
        let mut rng = Rng::new(seed);
        for it in 0..iterations {
            let len = rng.below(8);
            let input: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
            if target.run(&input).bug {
                return FuzzResult {
                    bug_input: Some(input),
                    corpus: 1,
                    coverage: 0,
                    iterations: it + 1,
                };
            }
        }
        FuzzResult {
            bug_input: None,
            corpus: 1,
            coverage: 0,
            iterations,
        }
    }
}

/// A byte-level channel: fragment a stream and frame it two ways.
pub mod bytes {
    use super::Rng;

    /// Length-prefix encode frames into one byte stream: each frame is `len` byte then payload.
    pub fn encode_frames(frames: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        for frame in frames {
            out.push(frame.len() as u8);
            out.extend_from_slice(frame);
        }
        out
    }

    /// Split a byte stream into seeded chunks of 1..=max_chunk bytes, ignoring
    /// frame boundaries (the byte-level fault that exposes split-frame bugs).
    pub fn fragment(stream: &[u8], seed: u64, max_chunk: usize) -> Vec<Vec<u8>> {
        let mut rng = Rng::new(seed);
        let mut chunks = Vec::new();
        let mut i = 0;
        while i < stream.len() {
            let take = 1 + rng.below(max_chunk.max(1));
            let end = (i + take).min(stream.len());
            chunks.push(stream[i..end].to_vec());
            i = end;
        }
        chunks
    }

    /// The naive framer: assume one chunk (read) is one frame. Breaks under fragmentation.
    pub fn naive_deframe(chunks: &[Vec<u8>]) -> Vec<Vec<u8>> {
        chunks
            .iter()
            .filter(|c| !c.is_empty())
            .map(|c| c[1..].to_vec())
            .collect()
    }

    /// The correct framer: buffer all bytes and parse frames by their length prefix.
    pub fn buffered_deframe(chunks: &[Vec<u8>]) -> Vec<Vec<u8>> {
        let mut buf = Vec::new();
        for c in chunks {
            buf.extend_from_slice(c);
        }
        let mut out = Vec::new();
        let mut i = 0;
        while i < buf.len() {
            let len = buf[i] as usize;
            i += 1;
            if i + len > buf.len() {
                break;
            }
            out.push(buf[i..i + len].to_vec());
            i += len;
        }
        out
    }
}
