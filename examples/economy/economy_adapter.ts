// A tiny deterministic, NON-SPATIAL sim driven entirely by discrete actions:
// no hero, no enemies, no move/fire. It is the counterpart to examples/chase
// (an action game) and exists to exercise the action-first seam
// (availableActions/act) end to end. Gather wood, craft planks, sell for gold.
import type { GameState, SimAdapter } from "@0xheartcode/simharness/adapter";

export interface EcoExtra extends Record<string, unknown> {
  gold: number;
  wood: number;
  planks: number;
  sold: number;
}

export class EconomyAdapter implements SimAdapter<EcoExtra> {
  readonly name = "economy";
  private t = 0;
  private phase = "running";
  private gold = 0;
  private wood = 0;
  private planks = 0;
  private sold = 0;

  reset(_seed: number): void {
    this.t = 0;
    this.phase = "running";
    this.gold = 0;
    this.wood = 0;
    this.planks = 0;
    this.sold = 0;
  }

  step(_dt: number): void {
    if (this.phase !== "running") return;
    this.t++;
    if (this.t >= 500) this.phase = "over";
  }

  setInput(): void {} // unused: this sim is action-driven, not input-driven

  availableActions(): readonly string[] {
    const acts = ["gather", "wait"];
    if (this.wood >= 2) acts.push("craft");
    if (this.planks >= 1) acts.push("sell");
    return acts;
  }

  act(action: string): void {
    switch (action) {
      case "gather":
        this.wood += 1;
        break;
      case "craft":
        if (this.wood >= 2) {
          this.wood -= 2;
          this.planks += 1;
        }
        break;
      case "sell":
        if (this.planks >= 1) {
          this.planks -= 1;
          this.gold += 5;
          this.sold += 1;
        }
        break;
    }
  }

  readState(): GameState<EcoExtra> {
    // No hero, no enemies: the universal core is just tick + phase + extra.
    return {
      tick: this.t,
      phase: this.phase,
      extra: { gold: this.gold, wood: this.wood, planks: this.planks, sold: this.sold },
    };
  }

  snapshotAscii(): string {
    return `economy t${this.t}  gold ${this.gold}  wood ${this.wood}  planks ${this.planks}  sold ${this.sold}`;
  }
}
