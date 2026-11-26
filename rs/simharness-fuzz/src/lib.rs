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
        /// The corpus inputs kept (each reached new coverage), for minimization.
        pub corpus_inputs: Vec<Vec<u8>>,
    }

    /// One mutation: append, flip, insert, delete, or splice a corpus donor's
    /// tail. A richer operator set than a single flip reaches more structures.
    fn mutate(base: &[u8], corpus: &[Vec<u8>], rng: &mut Rng) -> Vec<u8> {
        let mut out = base.to_vec();
        let op = if out.is_empty() { 0 } else { rng.below(5) };
        match op {
            0 => out.push(rng.byte()),
            1 => {
                let i = rng.below(out.len());
                out[i] = rng.byte();
            }
            2 => {
                let i = rng.below(out.len() + 1);
                out.insert(i, rng.byte());
            }
            3 => {
                if out.len() > 1 {
                    let i = rng.below(out.len());
                    out.remove(i);
                }
            }
            _ => {
                let donor = &corpus[rng.below(corpus.len())];
                if !donor.is_empty() {
                    let cut = rng.below(donor.len());
                    out.extend_from_slice(&donor[cut..]);
                }
            }
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
            let input = mutate(&base, &corpus, &mut rng);
            let out = target.run(&input);
            if out.bug {
                return FuzzResult {
                    bug_input: Some(input),
                    corpus: corpus.len(),
                    coverage: seen.len(),
                    iterations: it + 1,
                    corpus_inputs: corpus,
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
            corpus_inputs: corpus,
        }
    }

    /// Reduce a corpus to a minimal subset that preserves its total coverage,
    /// via greedy set cover: repeatedly take the input adding the most new
    /// coverage. Ties favor shorter inputs (the AFL "favored" heuristic).
    pub fn minimize_corpus<T: Target>(target: &T, corpus: &[Vec<u8>]) -> Vec<Vec<u8>> {
        let covs: Vec<BTreeSet<u64>> = corpus
            .iter()
            .map(|input| target.run(input).coverage.into_iter().collect())
            .collect();
        let mut covered: BTreeSet<u64> = BTreeSet::new();
        let mut chosen: Vec<usize> = Vec::new();
        loop {
            let mut best: Option<usize> = None;
            let mut best_gain = 0usize;
            for (idx, cov) in covs.iter().enumerate() {
                if chosen.contains(&idx) {
                    continue;
                }
                let gain = cov.iter().filter(|c| !covered.contains(c)).count();
                if gain > best_gain || (gain == best_gain && gain > 0 && best.is_none()) {
                    best_gain = gain;
                    best = Some(idx);
                }
            }
            match best {
                Some(idx) => {
                    for &c in &covs[idx] {
                        covered.insert(c);
                    }
                    chosen.push(idx);
                }
                None => break,
            }
        }
        chosen.sort_by_key(|&i| corpus[i].len());
        chosen.into_iter().map(|i| corpus[i].clone()).collect()
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
                    corpus_inputs: Vec::new(),
                };
            }
        }
        FuzzResult {
            bug_input: None,
            corpus: 1,
            coverage: 0,
            iterations,
            corpus_inputs: Vec::new(),
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

    /// Fragment a stream and cut (drop) some chunks mid-stream with probability
    /// `cut_prob`: the mid-frame-death fault. Lost bytes desync a length-prefix
    /// framer, which only a byte-level channel can produce.
    pub fn fragment_with_cuts(
        stream: &[u8],
        seed: u64,
        max_chunk: usize,
        cut_prob: f64,
    ) -> Vec<Vec<u8>> {
        let mut rng = Rng::new(seed);
        let mut chunks = Vec::new();
        let mut i = 0;
        while i < stream.len() {
            let take = 1 + rng.below(max_chunk.max(1));
            let end = (i + take).min(stream.len());
            if (rng.next_u64() as f64) / (u64::MAX as f64) >= cut_prob {
                chunks.push(stream[i..end].to_vec());
            }
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
