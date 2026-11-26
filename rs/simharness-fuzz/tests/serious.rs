//! Serious-tier upgrades: corpus minimization (greedy set cover) reduces a
//! corpus while preserving coverage, and mid-stream cuts lose bytes a framer
//! cannot fully recover.

use std::collections::BTreeSet;

use simharness_fuzz::bytes::{buffered_deframe, encode_frames, fragment_with_cuts};
use simharness_fuzz::coverage::{minimize_corpus, Outcome, Target};

/// Coverage is the set of distinct byte values an input contains.
struct ByteCoverage;
impl Target for ByteCoverage {
    fn run(&self, input: &[u8]) -> Outcome {
        Outcome {
            coverage: input.iter().map(|&b| b as u64).collect(),
            bug: false,
        }
    }
}

fn coverage_of(inputs: &[Vec<u8>]) -> BTreeSet<u64> {
    inputs
        .iter()
        .flat_map(|i| i.iter().map(|&b| b as u64))
        .collect()
}

#[test]
fn minimize_corpus_reduces_size_and_preserves_coverage() {
    let corpus = vec![vec![1, 2], vec![2, 3], vec![1, 2, 3], vec![3], vec![1]];
    let minimized = minimize_corpus(&ByteCoverage, &corpus);
    assert!(
        minimized.len() < corpus.len(),
        "a redundant corpus should shrink"
    );
    assert_eq!(
        coverage_of(&minimized),
        coverage_of(&corpus),
        "minimization must preserve total coverage"
    );
}

#[test]
fn clean_fragmentation_recovers_every_frame() {
    let frames = vec![vec![10, 11, 12], vec![20, 21], vec![30]];
    let stream = encode_frames(&frames);
    let chunks = fragment_with_cuts(&stream, 1, 2, 0.0); // no cuts
    assert_eq!(buffered_deframe(&chunks), frames);
}

#[test]
fn mid_stream_cuts_lose_bytes_a_framer_cannot_recover() {
    let frames = vec![vec![10, 11, 12], vec![20, 21], vec![30]];
    let stream = encode_frames(&frames);
    let chunks = fragment_with_cuts(&stream, 1, 2, 0.5);
    let delivered: usize = chunks.iter().map(|c| c.len()).sum();
    assert!(
        delivered < stream.len(),
        "cuts should drop bytes mid-stream"
    );
    assert_ne!(
        buffered_deframe(&chunks),
        frames,
        "lost bytes cannot reframe to the original"
    );
}
