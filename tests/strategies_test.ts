import { strategies, withAbilities } from "@0xheartcode/simharness";
import type { GameState } from "@0xheartcode/simharness/adapter";
import { MockAdapter } from "./mock_adapter.ts";
import { assert, assertEquals, assertStrictEquals } from "./assert.ts";

type S = GameState<Record<string, unknown>>;

function state(
  hero: { x: number; y: number } | undefined,
  enemies: { x: number; y: number }[],
  tick = 0,
): S {
  return {
    tick,
    phase: "running",
    hero: hero ? { ...hero } : undefined,
    enemies: enemies.map((e, i) => ({ kind: "creep", id: `e${i}`, x: e.x, y: e.y })),
    extra: {},
  };
}

const a = new MockAdapter();

Deno.test("idle: no input at all", () => {
  assertEquals(strategies.idle(state({ x: 0, y: 0 }, []), a), {});
});

Deno.test("aggressive: moves toward the nearest enemy and fires", () => {
  const s = state({ x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: 3, y: 0 }]);
  const inp = strategies.aggressive(s, a);
  assert(inp.fire, "fires when an enemy exists");
  assertEquals(inp.aimWorld, { x: 3, y: 0 }, "aims at the nearest enemy");
  assert(inp.move && inp.move.x > 0.99, "moves along +x toward the nearest enemy");
});

Deno.test("aggressive: no enemies => holds and does not fire", () => {
  const inp = strategies.aggressive(state({ x: 2, y: 2 }, []), a);
  assertEquals(inp.move, { x: 0, y: 0 });
  assertStrictEquals(inp.fire, false);
  assertEquals(inp.aimWorld, { x: 2, y: 2 }, "aims at itself when nothing to shoot");
});

Deno.test("turtle: holds position but fires at a target", () => {
  const inp = strategies.turtle(state({ x: 0, y: 0 }, [{ x: 5, y: 5 }]), a);
  assertEquals(inp.move, { x: 0, y: 0 });
  assert(inp.fire);
});

Deno.test("strategies tolerate a missing hero", () => {
  assertEquals(strategies.aggressive(state(undefined, [{ x: 1, y: 1 }]), a).aimWorld, { x: 0, y: 0 });
  assertEquals(strategies.turtle(state(undefined, []), a).aimWorld, { x: 0, y: 0 });
});

Deno.test("withAbilities: fires declared abilities off cooldown and merges into press", () => {
  const s = withAbilities(strategies.turtle, [
    { key: "1", everyTicks: 5 },
    { key: "2", everyTicks: 3, offset: 1 },
  ]);
  // tick 0: "1" fires (0 % 5 == 0); "2" offset 1 => rel -1, not yet.
  assertEquals(s(state({ x: 0, y: 0 }, [{ x: 1, y: 0 }], 0), a).press, ["1"]);
  // tick 5: "1" fires again; tick 4: "2" fires (rel 3 % 3 == 0).
  assertEquals(s(state({ x: 0, y: 0 }, [{ x: 1, y: 0 }], 5), a).press, ["1"]);
  assertEquals(s(state({ x: 0, y: 0 }, [{ x: 1, y: 0 }], 4), a).press, ["2"]);
  // tick 2: neither fires => press is omitted (base turtle has none).
  assertStrictEquals(s(state({ x: 0, y: 0 }, [{ x: 1, y: 0 }], 2), a).press, undefined);
});

Deno.test("withAbilities: 'when' gates an ability", () => {
  const s = withAbilities(strategies.idle, [
    { key: "ult", everyTicks: 1, when: (st) => st.enemies.length >= 2 },
  ]);
  assertStrictEquals(s(state({ x: 0, y: 0 }, [{ x: 1, y: 1 }], 0), a).press, undefined); // 1 enemy: gated off
  assertEquals(s(state({ x: 0, y: 0 }, [{ x: 1, y: 1 }, { x: 2, y: 2 }], 0), a).press, ["ult"]);
});

Deno.test("random: produces a well-formed, bounded input", () => {
  for (let i = 0; i < 200; i++) {
    const inp = strategies.random(state({ x: 0, y: 0 }, [{ x: 1, y: 1 }]), a);
    assert(inp.move && inp.move.x >= -1 && inp.move.x <= 1 && inp.move.y >= -1 && inp.move.y <= 1);
    assert(typeof inp.fire === "boolean");
    assert(inp.aimWorld);
    if (inp.press) assert(inp.press.length === 1);
  }
});
