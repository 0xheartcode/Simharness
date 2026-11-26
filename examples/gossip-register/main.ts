// CLI entrypoint for the gossip-register scenario. Run it with, for example:
//   deno run examples/gossip-register/main.ts fuzz --seeds 100 --ticks 200
//   deno run examples/gossip-register/main.ts replay 3 --profile reorg-storm

import { runCli } from "../../src/engine/cli/cli.ts";
import { gossipScenario } from "./scenario.ts";

Deno.exit(runCli(Deno.args, gossipScenario()));
