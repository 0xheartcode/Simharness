// Protocol v0 public surface, for engine tooling and SUT adapters. This is internal
// to the rewrite: it is deliberately not re-exported from the package index
// (src/index.ts), so the published package API and its generated API.md are
// unchanged while the engine is built out.

export * from "./types.ts";
export type { Adapter } from "./adapter.ts";
export { dispatch } from "./dispatch.ts";
export { type Channel, inProcessChannel } from "./in_process.ts";
export { encodeLine, LineClient, runLineServer, toLineStream } from "./lines.ts";
export { connectSubprocess, serveStdio, type Subprocess } from "./stdio.ts";
