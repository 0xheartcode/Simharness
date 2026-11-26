// The shared request dispatcher. Both transports (in-process and stdio) turn a
// Request into a Response by calling exactly this function, so the two agree by
// construction: the stdio path is the in-process path with JSON lines on either
// side.
//
// Dispatch is pure with respect to the protocol: all state lives in the adapter.
// It never reads a clock or an RNG.

import type { Adapter } from "./adapter.ts";
import { type ErrorCode, PROTOCOL_VERSION, type Request, type Response } from "./types.ts";

function ok(id: number, result: unknown): Response {
  return { v: PROTOCOL_VERSION, id, ok: true, result };
}

function err(id: number, code: ErrorCode, extra: Record<string, unknown> = {}): Response {
  return { v: PROTOCOL_VERSION, id, ok: false, error: { code, ...extra } };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Turn one request into one response against the given adapter. Never throws. */
export function dispatch(adapter: Adapter, req: Request): Response {
  // Envelope version is checked for every request, not just hello.
  if (req.v !== PROTOCOL_VERSION) {
    return err(req.id, "protocol_mismatch", { expected: PROTOCOL_VERSION, got: req.v });
  }

  try {
    switch (req.op) {
      case "hello": {
        const asked = req.args.protocol;
        if (asked !== undefined && asked !== PROTOCOL_VERSION) {
          return err(req.id, "protocol_mismatch", { expected: PROTOCOL_VERSION, got: asked });
        }
        return ok(req.id, adapter.hello());
      }
      case "reset": {
        const seed = req.args.seed;
        if (typeof seed !== "number" || !Number.isFinite(seed)) {
          return err(req.id, "bad_args", { op: req.op, reason: "seed must be a finite number" });
        }
        const config = req.args.config;
        if (config !== undefined && (typeof config !== "object" || config === null)) {
          return err(req.id, "bad_args", { op: req.op, reason: "config must be an object" });
        }
        adapter.reset(seed, config as Record<string, unknown> | undefined);
        return ok(req.id, null);
      }
      case "read_state":
        return ok(req.id, adapter.readState());
      case "tick":
        if (!adapter.tick) return err(req.id, "unsupported", { op: req.op });
        adapter.tick();
        return ok(req.id, null);
      case "available_actions":
        if (!adapter.availableActions) return err(req.id, "unsupported", { op: req.op });
        return ok(req.id, adapter.availableActions());
      case "act": {
        if (!adapter.act) return err(req.id, "unsupported", { op: req.op });
        const action = str(req.args.action);
        if (action === undefined) {
          return err(req.id, "bad_args", { op: req.op, reason: "action must be a string" });
        }
        adapter.act(action);
        return ok(req.id, null);
      }
      case "deliver": {
        if (!adapter.deliver) return err(req.id, "unsupported", { op: req.op });
        const message = req.args.message;
        if (typeof message !== "object" || message === null) {
          return err(req.id, "bad_args", { op: req.op, reason: "message must be an object" });
        }
        adapter.deliver(message as Parameters<NonNullable<Adapter["deliver"]>>[0]);
        return ok(req.id, null);
      }
      case "drain_outbox":
        if (!adapter.drainOutbox) return err(req.id, "unsupported", { op: req.op });
        return ok(req.id, adapter.drainOutbox());
      case "history":
        if (!adapter.history) return err(req.id, "unsupported", { op: req.op });
        return ok(req.id, adapter.history());
      case "snapshot":
        if (!adapter.snapshot) return err(req.id, "unsupported", { op: req.op });
        return ok(req.id, adapter.snapshot());
      case "bye":
        if (adapter.bye) adapter.bye();
        return ok(req.id, null);
      default:
        return err(req.id, "unsupported", { op: req.op });
    }
  } catch (e) {
    return err(req.id, "sut_error", { op: req.op, message: e instanceof Error ? e.message : String(e) });
  }
}
