// CLI entrypoint for the gossip-register scenario. Run it with, for example:
//   deno run examples/gossip-register/main.ts fuzz --seeds 100 --ticks 200
//   deno run examples/gossip-register/main.ts replay 3 --profile reorg-storm
//
// Set GOSSIP_BUGGY=1 to run the variant whose adopted-version invariant breaks,
// so the agentic-workflows loop (docs/guide) can be driven end to end against a
// real failure:
//   GOSSIP_BUGGY=1 deno run --allow-env examples/gossip-register/main.ts fuzz --seeds 25 --ticks 120 --json

import { runCli } from "../../src/engine/cli/cli.ts";
import { gossipScenario } from "./scenario.ts";

const buggy = Deno.env.get("GOSSIP_BUGGY") === "1";
Deno.exit(runCli(Deno.args, gossipScenario({ buggy })));
