//! The explorer finds a real concurrency bug (a lost update from a non-atomic
//! read-modify-write) that a random search would usually miss, and reports none
//! when the same increments are atomic.

use simharness_explore::{explore, interleaving_count, Model};

#[derive(Clone)]
struct RaceState {
    counter: i64,
    locals: Vec<i64>,
}

/// Two tasks, each a non-atomic increment: step 0 reads the counter into a
/// per-task local, step 1 writes local + 1 back. Interleaving the reads loses
/// an update.
struct RacyCounter {
    tasks: usize,
}

impl Model for RacyCounter {
    type State = RaceState;
    fn initial(&self) -> RaceState {
        RaceState {
            counter: 0,
            locals: vec![0; self.tasks],
        }
    }
    fn task_lengths(&self) -> Vec<usize> {
        vec![2; self.tasks]
    }
    fn step(&self, s: &mut RaceState, task: usize, step: usize) {
        match step {
            0 => s.locals[task] = s.counter,
            _ => s.counter = s.locals[task] + 1,
        }
    }
    fn invariant(&self, s: &RaceState) -> bool {
        s.counter == self.tasks as i64
    }
}

/// The same increments, but atomic (one step), so no interleaving loses one.
struct AtomicCounter {
    tasks: usize,
}

impl Model for AtomicCounter {
    type State = i64;
    fn initial(&self) -> i64 {
        0
    }
    fn task_lengths(&self) -> Vec<usize> {
        vec![1; self.tasks]
    }
    fn step(&self, s: &mut i64, _task: usize, _step: usize) {
        *s += 1;
    }
    fn invariant(&self, s: &i64) -> bool {
        *s == self.tasks as i64
    }
}

#[test]
fn finds_a_lost_update_interleaving() {
    let found = explore(&RacyCounter { tasks: 2 });
    assert!(
        found.is_some(),
        "a non-atomic increment must have a losing interleaving"
    );
    let schedule = found.unwrap().schedule;
    assert!(
        schedule.windows(2).any(|w| w[0] != w[1]),
        "the counterexample {schedule:?} must interleave the tasks"
    );
}

#[test]
fn atomic_increments_are_always_safe() {
    assert_eq!(explore(&AtomicCounter { tasks: 3 }), None);
}

#[test]
fn exploration_is_deterministic() {
    assert_eq!(
        explore(&RacyCounter { tasks: 2 }),
        explore(&RacyCounter { tasks: 2 })
    );
}

#[test]
fn counts_the_interleaving_search_space() {
    // two tasks of two steps each: 4! / (2! * 2!) = 6 interleavings.
    assert_eq!(interleaving_count(&[2, 2]), 6);
    assert_eq!(interleaving_count(&[1, 1, 1]), 6);
}
