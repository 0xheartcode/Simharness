// Interleaving exploration (#41), integrated with the engine. Instead of hoping
// a random seed hits the bad message-delivery order, this systematically
// explores delivery orderings on the real SimulatedNetwork and checks the
// scenario's invariants at each terminal state. It is stateless model checking:
// re-execute the scenario from the seed for each schedule, driving the network's
// delivery order from a path of choices, and DFS over those choices.
//
// The reduction that makes it tractable (a sound partial-order reduction): on a
// tick, delivering a message to process A and a message to process B in either
// order gives the same result, because a handler's sends go to a later tick, so
// A's and B's handlers cannot affect each other this tick. Only messages to the
// SAME recipient interleave meaningfully, so only those are reordered;
// cross-recipient order is fixed (by recipient id). This collapses the search to
// the orderings that can actually change the outcome.

import { checkInvariants, runScenario, type Scenario } from "../cli/scenario.ts";
import type { DeliveryScheduler, DueMessage } from "../sim/network.ts";

export interface ScheduleViolation {
  /** The choice path that reproduces the violation (feed it back to replay). */
  path: number[];
  breaks: string[];
}

export interface ExploreResult {
  violation: ScheduleViolation | null;
  /** Schedules (runs) explored. */
  runs: number;
  /** True if the whole (bounded) schedule space was searched without a violation. */
  exhausted: boolean;
}

const MAX_GROUP = 4; // do not permute a same-recipient group bigger than this
const MAX_ORDERINGS = 24; // cap the orderings considered on one tick

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items.slice()];
  const out: number[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/**
 * The delivery orderings worth exploring for one tick's due messages: the
 * default (send) order first, then same-recipient reorderings, with
 * cross-recipient order fixed by recipient id.
 */
export function orderingsOf(due: readonly DueMessage[]): number[][] {
  const groups = new Map<string, number[]>();
  due.forEach((m, i) => {
    const g = groups.get(m.to);
    if (g) g.push(i);
    else groups.set(m.to, [i]);
  });
  let orders: number[][] = [[]];
  for (const recipient of [...groups.keys()].sort()) {
    const idxs = groups.get(recipient)!;
    const perms = idxs.length > MAX_GROUP ? [idxs] : permutations(idxs);
    const next: number[][] = [];
    for (const order of orders) {
      for (const perm of perms) next.push([...order, ...perm]);
    }
    orders = next;
    if (orders.length >= MAX_ORDERINGS) {
      orders = orders.slice(0, MAX_ORDERINGS);
      break;
    }
  }
  return orders;
}

/** A scheduler driven by a choice path, recording the branching it meets. */
function pathScheduler(path: readonly number[], branching: number[]): DeliveryScheduler {
  let k = 0;
  return (due) => {
    const orders = orderingsOf(due);
    if (orders.length <= 1) return orders[0] ?? due.map((_, i) => i);
    const choice = k < path.length ? path[k] : 0;
    branching[k] = orders.length;
    k += 1;
    return orders[Math.min(choice, orders.length - 1)];
  };
}

export interface ExploreOptions {
  seed: number;
  ticks: number;
  profile?: string;
  /** Maximum schedules to explore before giving up (default 2000). */
  maxRuns?: number;
}

/**
 * Explore delivery-order schedules of `scenario` at `seed`; return the first
 * schedule whose terminal state breaks an invariant, or none if the bounded
 * space is clean.
 */
export function exploreSchedules(scenario: Scenario, opts: ExploreOptions): ExploreResult {
  const profile = opts.profile ?? scenario.defaultProfile ?? "quiet";
  const maxRuns = opts.maxRuns ?? 2000;
  let path: number[] = [];
  let runs = 0;

  while (runs < maxRuns) {
    const branching: number[] = [];
    const scheduler = pathScheduler(path, branching);
    const run = runScenario(scenario, { seed: opts.seed, ticks: opts.ticks, profile, scheduler });
    runs += 1;

    const breaks = checkInvariants(scenario, run);
    if (breaks.length > 0) return { violation: { path: path.slice(), breaks }, runs, exhausted: false };

    // Backtrack: the first `path.length` choices are fixed, so choice points
    // 0..path.length-1 recur identically; advance the deepest one with an
    // unexplored alternative.
    while (path.length < branching.length) path.push(0);
    let k = branching.length - 1;
    while (k >= 0 && path[k] + 1 >= branching[k]) k -= 1;
    if (k < 0) return { violation: null, runs, exhausted: true };
    path = path.slice(0, k + 1);
    path[k] += 1;
  }
  return { violation: null, runs, exhausted: false };
}

/** Re-run a scenario under a specific choice path, to reproduce a violation. */
export function replaySchedule(scenario: Scenario, opts: ExploreOptions & { path: readonly number[] }): string[] {
  const profile = opts.profile ?? scenario.defaultProfile ?? "quiet";
  const scheduler = pathScheduler(opts.path, []);
  const run = runScenario(scenario, { seed: opts.seed, ticks: opts.ticks, profile, scheduler });
  return checkInvariants(scenario, run);
}
