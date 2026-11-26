//! Partial-order reduction (the serious interleaving explorer). The naive
//! explorer in the crate root enumerates every interleaving, which is `n!` in
//! the number of steps even when most of them are equivalent. This explores one
//! representative per Mazurkiewicz trace using sleep sets over an independence
//! relation: two steps are independent when they touch different shared objects,
//! or both only read, so swapping them cannot change the outcome. Independent
//! steps are therefore not re-explored in both orders.
//!
//! The model is a set of threads, each a sequence of steps; a step declares the
//! shared object it accesses and whether it writes. Sleep sets alone are a sound
//! reduction: every terminal state that a full search would check is still
//! represented, so no invariant violation is missed, while equivalent
//! interleavings collapse to one.

/// A concurrent program for partial-order-reduced exploration.
pub trait DporModel {
    type State: Clone;

    fn initial(&self) -> Self::State;
    fn threads(&self) -> usize;
    /// Steps in thread `thread`.
    fn step_count(&self, thread: usize) -> usize;
    /// The shared object a step touches, and whether it writes it.
    fn access(&self, thread: usize, step: usize) -> (usize, bool);
    /// Execute a step against the state.
    fn run(&self, state: &mut Self::State, thread: usize, step: usize);
    /// The invariant, checked at each terminal state.
    fn invariant(&self, state: &Self::State) -> bool;
}

/// Two accesses are independent unless they touch the same object and at least
/// one writes.
fn independent(a: (usize, bool), b: (usize, bool)) -> bool {
    a.0 != b.0 || (!a.1 && !b.1)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DporResult {
    /// The schedule (thread ids) of the first violating interleaving, if any.
    pub violation: Option<Vec<usize>>,
    /// Terminal interleavings actually explored (the reduced count).
    pub explored: usize,
}

/// Explore `model` with sleep-set partial-order reduction.
pub fn dpor_explore<M: DporModel>(model: &M) -> DporResult {
    let threads = model.threads();
    let mut pc = vec![0usize; threads];
    let mut schedule = Vec::new();
    let mut explored = 0usize;
    let violation = search(
        model,
        &model.initial(),
        &mut pc,
        &Vec::new(),
        &mut schedule,
        &mut explored,
    );
    DporResult {
        violation,
        explored,
    }
}

fn search<M: DporModel>(
    model: &M,
    state: &M::State,
    pc: &mut [usize],
    sleep: &[usize],
    schedule: &mut Vec<usize>,
    explored: &mut usize,
) -> Option<Vec<usize>> {
    let done = (0..model.threads()).all(|t| pc[t] == model.step_count(t));
    if done {
        *explored += 1;
        return if model.invariant(state) {
            None
        } else {
            Some(schedule.clone())
        };
    }

    // Threads with a step to run that are not currently asleep.
    let mut sleep = sleep.to_vec();
    for t in 0..model.threads() {
        if pc[t] >= model.step_count(t) || sleep.contains(&t) {
            continue;
        }
        let op_t = model.access(t, pc[t]);
        // A sleeping thread stays asleep only while its next step is independent
        // of the step we are about to run; a dependent step wakes it.
        let next_sleep: Vec<usize> = sleep
            .iter()
            .copied()
            .filter(|&s| pc[s] < model.step_count(s) && independent(op_t, model.access(s, pc[s])))
            .collect();

        let mut next_state = state.clone();
        model.run(&mut next_state, t, pc[t]);
        pc[t] += 1;
        schedule.push(t);
        let found = search(model, &next_state, pc, &next_sleep, schedule, explored);
        schedule.pop();
        pc[t] -= 1;
        if found.is_some() {
            return found;
        }

        // Having explored t first here, later siblings need not re-explore it.
        sleep.push(t);
    }
    None
}

/// Count the interleavings a full (unreduced) search would explore, for
/// comparison with the reduced count.
pub fn naive_count<M: DporModel>(model: &M) -> usize {
    let threads = model.threads();
    let mut pc = vec![0usize; threads];
    let mut count = 0usize;
    naive(model, &model.initial(), &mut pc, &mut count);
    count
}

fn naive<M: DporModel>(model: &M, state: &M::State, pc: &mut [usize], count: &mut usize) {
    if (0..model.threads()).all(|t| pc[t] == model.step_count(t)) {
        *count += 1;
        return;
    }
    for t in 0..model.threads() {
        if pc[t] >= model.step_count(t) {
            continue;
        }
        let mut next_state = state.clone();
        model.run(&mut next_state, t, pc[t]);
        pc[t] += 1;
        naive(model, &next_state, pc, count);
        pc[t] -= 1;
    }
}
