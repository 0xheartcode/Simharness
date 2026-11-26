//! Coverage guidance finds a deep bug a blind search cannot, and byte-level
//! fragmentation exposes a split-frame bug that whole-frame delivery hides.

use simharness_fuzz::bytes::{buffered_deframe, encode_frames, fragment, naive_deframe};
use simharness_fuzz::coverage::{coverage_guided_fuzz, undirected_fuzz, Outcome, Target};

/// A lock that advances one state per correct password byte; reaching the end is
/// the bug. The password is a needle a blind search would need 256^len tries to
/// find, but coverage guidance builds it up one byte at a time.
struct Lock {
    password: Vec<u8>,
}

impl Target for Lock {
    fn run(&self, input: &[u8]) -> Outcome {
        let mut coverage = vec![0u64];
        let mut state = 0usize;
        for (i, &b) in input.iter().enumerate() {
            if i < self.password.len() && b == self.password[i] {
                state = i + 1;
                coverage.push(state as u64);
            } else {
                break;
            }
        }
        Outcome {
            coverage,
            bug: state == self.password.len(),
        }
    }
}

#[test]
fn coverage_guidance_finds_a_deep_bug_a_blind_search_cannot() {
    let lock = Lock {
        password: vec![7, 42, 99, 200],
    }; // 256^4 for a blind search
    let budget = 50_000;

    let guided = coverage_guided_fuzz(&lock, 1, budget);
    assert!(
        guided.bug_input.is_some(),
        "coverage guidance must find the deep bug"
    );
    assert!(
        guided.bug_input.unwrap().starts_with(&[7, 42, 99, 200]),
        "the input must open the lock"
    );
    assert!(
        guided.coverage >= 4,
        "it should have climbed through the intermediate states"
    );

    let blind = undirected_fuzz(&lock, 1, budget);
    assert!(
        blind.bug_input.is_none(),
        "a blind search should not find a 4-byte needle in {budget} tries"
    );
}

#[test]
fn coverage_guided_fuzzing_is_deterministic() {
    let lock = Lock {
        password: vec![7, 42, 99, 200],
    };
    assert_eq!(
        coverage_guided_fuzz(&lock, 5, 50_000),
        coverage_guided_fuzz(&lock, 5, 50_000)
    );
}

#[test]
fn byte_fragmentation_exposes_a_split_frame_bug() {
    let frames = vec![vec![10, 11, 12], vec![20, 21]];
    let stream = encode_frames(&frames); // [3,10,11,12, 2,20,21]
    let chunks = fragment(&stream, 3, 2); // 1..=2 byte chunks, ignoring frame boundaries
    assert!(
        chunks.len() > frames.len(),
        "fragmentation must break frame alignment"
    );
    assert_eq!(
        buffered_deframe(&chunks),
        frames,
        "the buffering framer recovers every frame"
    );
    assert_ne!(
        naive_deframe(&chunks),
        frames,
        "the naive one-read-one-frame framer is wrong under fragmentation"
    );
}

#[test]
fn whole_frame_delivery_hides_the_split_frame_bug() {
    // Deliver each frame as its own chunk (what a message-level network does):
    // even the naive framer looks correct, which is why byte-level is needed.
    let frames = vec![vec![10, 11, 12], vec![20, 21]];
    let per_frame: Vec<Vec<u8>> = frames
        .iter()
        .map(|f| {
            let mut c = vec![f.len() as u8];
            c.extend_from_slice(f);
            c
        })
        .collect();
    assert_eq!(naive_deframe(&per_frame), frames);
}
