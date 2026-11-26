// Out-of-process entrypoint for the echo adapter: serve it over stdio and exit
// when stdin closes. The conformance test spawns this with the deno binary to
// prove a real black-box round-trip, the same adapter it drives in-process.

import { serveStdio } from "../../src/engine/protocol/stdio.ts";
import { EchoAdapter } from "./echo_adapter.ts";

await serveStdio(new EchoAdapter());
