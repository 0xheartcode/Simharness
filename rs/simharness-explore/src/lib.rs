//! Deterministic interleaving exploration (#41), the Shuttle / loom idea at its
//! core: instead of hoping a random seed hits the bad interleaving, enumerate
//! the interleavings of a set of concurrent tasks and check an invariant at each
//! terminal state. A model is a few tasks, each a sequence of atomic steps over
//! a shared state; the explorer does a depth-first search over "which task takes
//! its next step", and returns the first interleaving (as the schedule of task
//! ids) that leaves the invariant broken.
//!
//! The search is exhaustive and bounded (the total number of steps is finite),
//! and fully deterministic: tasks are tried in id order, so the same model
//! always yields the same first counterexample. This is the exploration tier's
//! floor: a correct scheduler that finds a real concurrency bug a random search
//! would usually miss.
//!
//! Determinism (ADR-005): pure, no clock, no entropy, no threads, ordered Vecs.

/// A concurrent system to explore: a shared state, a set of tasks (each a number
/// of atomic steps), a step function, and the invariant that must hold once all
/// tasks have finished.
pub mod dpor;

pub trait Model {
    type State: Clone;

    /// The starting state.
    fn initial(&self) -> Self::State;

    /// The length (number of atomic steps) of each task, by task id.
    fn task_lengths(&self) -> Vec<usize>;

    /// Run task `task`'s step number `step` against `state`.
    fn step(&self, state: &mut Self::State, task: usize, step: usize);

    /// Whether the invariant holds in a terminal state.
    fn invariant(&self, state: &Self::State) -> bool;
}

/// A counterexample: the interleaving (sequence of task ids) whose terminal state
/// broke the invariant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interleaving {
    pub schedule: Vec<usize>,
}

/// Explore every interleaving of the model's tasks; return the first that leaves
/// the invariant broken, or None if every interleaving is safe.
pub fn explore<M: Model>(model: &M) -> Option<Interleaving> {
    let lengths = model.task_lengths();
    let mut progress = vec![0usize; lengths.len()];
    let mut schedule = Vec::new();
    search(
        model,
        &model.initial(),
        &lengths,
        &mut progress,
        &mut schedule,
    )
}

/// Count how many interleavings exist (for reporting the search space size).
pub fn interleaving_count(task_lengths: &[usize]) -> u128 {
    // Multinomial: (sum)! / prod(len_i!).
    let total: usize = task_lengths.iter().sum();
    let mut result: u128 = factorial(total);
    for &len in task_lengths {
        result /= factorial(len);
    }
    result
}

fn factorial(n: usize) -> u128 {
    (1..=n as u128).product::<u128>().max(1)
}

fn search<M: Model>(
    model: &M,
    state: &M::State,
    lengths: &[usize],
    progress: &mut [usize],
    schedule: &mut Vec<usize>,
) -> Option<Interleaving> {
    if progress.iter().zip(lengths).all(|(p, l)| p == l) {
        return if model.invariant(state) {
            None
        } else {
            Some(Interleaving {
                schedule: schedule.clone(),
            })
        };
    }

    for task in 0..lengths.len() {
        if progress[task] < lengths[task] {
            let mut next = state.clone();
            model.step(&mut next, task, progress[task]);
            progress[task] += 1;
            schedule.push(task);
            if let Some(found) = search(model, &next, lengths, progress, schedule) {
                return Some(found);
            }
            schedule.pop();
            progress[task] -= 1;
        }
    }
    None
}
