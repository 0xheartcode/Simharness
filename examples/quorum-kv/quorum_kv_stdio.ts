// Out-of-process entrypoint for the quorum-KV SUT: the same adapter the gate
// drives in-process, served as a stdio black box. Proves a real distributed SUT
// is hostable over the stdio transport, not just the trivial echo adapter.

import { serveStdio } from "../../src/engine/protocol/stdio.ts";
import { QuorumKvAdapter } from "./quorum_kv.ts";

await serveStdio(new QuorumKvAdapter());
