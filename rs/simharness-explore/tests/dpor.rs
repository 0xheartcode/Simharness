//! Partial-order reduction explores one representative per equivalence class
//! (so N independent writes collapse from N! interleavings to 1), while still
//! finding a real race (a lost update on a shared counter).

use simharness_explore::dpor::{dpor_explore, naive_count, DporModel};

/// N threads, each writing its own distinct object once. Every pair of steps is
/// independent, so all N! interleavings are equivalent.
struct IndependentWrites {
    threads: usize,
}

impl DporModel for IndependentWrites {
    type State = Vec<i64>;
    fn initial(&self) -> Vec<i64> {
        vec![0; self.threads]
    }
    fn threads(&self) -> usize {
        self.threads
    }
    fn step_count(&self, _thread: usize) -> usize {
        1
    }
    fn access(&self, thread: usize, _step: usize) -> (usize, bool) {
        (thread, true) // writes its own object
    }
    fn run(&self, state: &mut Vec<i64>, thread: usize, _step: usize) {
        state[thread] = 1;
    }
    fn invariant(&self, state: &Vec<i64>) -> bool {
        state.iter().all(|&v| v == 1)
    }
}

/// Two threads, each a non-atomic increment of the same shared counter: read
/// (object 0, read), then write (object 0, write). These steps are dependent.
#[derive(Clone)]
struct CounterState {
    counter: i64,
    locals: Vec<i64>,
}

struct SharedCounter;

impl DporModel for SharedCounter {
    type State = CounterState;
    fn initial(&self) -> CounterState {
        CounterState {
            counter: 0,
            locals: vec![0; 2],
        }
    }
    fn threads(&self) -> usize {
        2
    }
    fn step_count(&self, _thread: usize) -> usize {
        2
    }
    fn access(&self, _thread: usize, step: usize) -> (usize, bool) {
        (0, step == 1) // object 0; the write step writes
    }
    fn run(&self, state: &mut CounterState, thread: usize, step: usize) {
        if step == 0 {
            state.locals[thread] = state.counter;
        } else {
            state.counter = state.locals[thread] + 1;
        }
    }
    fn invariant(&self, state: &CounterState) -> bool {
        state.counter == 2
    }
}

fn factorial(n: usize) -> usize {
    (1..=n).product::<usize>().max(1)
}

#[test]
fn independent_writes_collapse_to_one_interleaving() {
    for threads in 2..=5 {
        let model = IndependentWrites { threads };
        let result = dpor_explore(&model);
        assert_eq!(result.violation, None);
        assert_eq!(
            result.explored, 1,
            "all {threads} independent writes are one equivalence class"
        );
        assert_eq!(
            naive_count(&model),
            factorial(threads),
            "the naive search would explore {threads}!"
        );
    }
}

#[test]
fn partial_order_reduction_still_finds_the_race() {
    let result = dpor_explore(&SharedCounter);
    assert!(
        result.violation.is_some(),
        "the lost update must still be found under reduction"
    );
    // the reduction explores no more than the naive search, and typically fewer
    assert!(result.explored <= naive_count(&SharedCounter));
}

#[test]
fn dpor_is_deterministic() {
    assert_eq!(dpor_explore(&SharedCounter), dpor_explore(&SharedCounter));
}
