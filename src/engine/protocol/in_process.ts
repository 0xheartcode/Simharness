// The in-process transport. The adapter is a native object; the orchestrator
// calls it through the same dispatch core the stdio transport uses, so a SUT
// behaves identically whichever transport drives it. This is the lowest-overhead
// path and the one same-language SUTs use.

import type { Adapter } from "./adapter.ts";
import { dispatch } from "./dispatch.ts";
import { type Op, PROTOCOL_VERSION, type Response } from "./types.ts";

/** A uniform request/response channel to one adapter. */
export interface Channel {
  /** Send one operation and get its response. `id` is assigned internally. */
  request(op: Op, args?: Record<string, unknown>): Response;
}

/** Wrap an adapter as an in-process channel. */
export function inProcessChannel(adapter: Adapter): Channel {
  let nextId = 0;
  return {
    request(op, args = {}) {
      nextId += 1;
      return dispatch(adapter, { v: PROTOCOL_VERSION, id: nextId, op, args });
    },
  };
}
