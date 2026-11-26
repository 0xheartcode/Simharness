// An order-dependent bug the interleaving explorer finds but random seeds miss.
// A coordinator sends a deposit and then a withdraw of the same amount to one
// account, in that order. In send order the account ends at zero. But a withdraw
// that arrives before its deposit is rejected for insufficient funds and lost,
// so if the network delivers withdraw-before-deposit the account ends holding
// the deposit. The invariant (the account nets to zero) then breaks, and only a
// specific delivery order triggers it.

import type { Message } from "../../src/engine/protocol/types.ts";
import type { Node, NodeDeps, ProcessId } from "../../src/engine/sim/cluster.ts";

const AMOUNT = 100;

export class Account implements Node {
  readonly id: ProcessId;
  #balance = 0;
  constructor(deps: NodeDeps) {
    this.id = deps.id;
  }
  tick(): void {}
  onMessage(msg: Message): void {
    const amount = msg.payload.amount as number;
    if (msg.kind === "deposit") {
      this.#balance += amount;
    } else if (msg.kind === "withdraw") {
      // A withdraw with insufficient funds is rejected and lost (the bug seam).
      if (this.#balance >= amount) this.#balance -= amount;
    }
  }
  state(): unknown {
    return { balance: this.#balance };
  }
}

export class Teller implements Node {
  readonly id: ProcessId;
  readonly #account: ProcessId;
  readonly #deps: NodeDeps;
  #sent = false;
  constructor(deps: NodeDeps, account: ProcessId) {
    this.id = deps.id;
    this.#account = account;
    this.#deps = deps;
  }
  tick(): void {
    if (this.#sent) return;
    this.#sent = true;
    // Deposit first, then withdraw: correct in send order.
    this.#deps.net.send({ from: this.id, to: this.#account, kind: "deposit", payload: { amount: AMOUNT } });
    this.#deps.net.send({ from: this.id, to: this.#account, kind: "withdraw", payload: { amount: AMOUNT } });
  }
  onMessage(_msg: Message): void {}
}
