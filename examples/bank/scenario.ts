// The bank scenario: a teller and an account, no faults. The invariant is that
// the account nets to zero once both operations have been delivered. It holds in
// send order and breaks only under the withdraw-before-deposit delivery order,
// which is what the interleaving explorer searches for.

import type { Scenario, ScenarioRun } from "../../src/engine/cli/scenario.ts";
import { Account, Teller } from "./bank.ts";

const TELLER = "teller";
const ACCOUNT = "account";

export function bankScenario(): Scenario {
  return {
    name: "bank",
    nodeIds: [TELLER, ACCOUNT],
    buildNode: (deps) => (deps.id === ACCOUNT ? new Account(deps) : new Teller(deps, ACCOUNT)),
    defaultProfile: "quiet",
    invariants: (run: ScenarioRun): string[] => {
      const account = run.nodeStates[ACCOUNT] as { balance: number } | undefined;
      if (account && account.balance !== 0) {
        return [`account did not net to zero: balance ${account.balance} (a withdraw was lost to reordering)`];
      }
      return [];
    },
    snapshot: (run) => run.nodeStates,
  };
}
