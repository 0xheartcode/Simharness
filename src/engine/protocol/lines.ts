// The stdio line protocol, built on string streams so it is fully testable in
// memory (no subprocess needed to exercise the framing). A real stdio adapter
// is these same pieces with Deno.stdin/stdout wrapped as string streams; see
// stdio.ts.
//
// Wire format: one JSON value per line, newline-terminated, no embedded
// newlines (JSON.stringify never emits a raw newline). The server turns each
// request line into a response line through the shared `dispatch`, so the stdio
// path and the in-process path agree by construction.

import type { Adapter } from "./adapter.ts";
import { dispatch } from "./dispatch.ts";
import { type Op, PROTOCOL_VERSION, type Request, type Response } from "./types.ts";

/** Serialize a value as one protocol line (JSON + newline). */
export function encodeLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/**
 * Split a byte stream into lines of text. Decodes UTF-8 and emits each complete
 * newline-terminated line (without the newline); a trailing partial line is
 * flushed at end of stream if non-empty.
 */
export function toLineStream(bytes: ReadableStream<Uint8Array>): ReadableStream<string> {
  const decoder = new TextDecoder();
  let buf = "";
  return bytes.pipeThrough(
    new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          controller.enqueue(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
        }
      },
      flush(controller) {
        buf += decoder.decode();
        if (buf.length > 0) controller.enqueue(buf);
      },
    }),
  );
}

/**
 * Serve an adapter over string streams: read request lines from `input`, write
 * response lines to `output`, until `input` ends. Resolves when done. A line
 * that is not valid JSON gets a `bad_args` response (with id -1, since the id is
 * unknown) rather than killing the loop.
 */
export async function runLineServer(
  adapter: Adapter,
  input: ReadableStream<string>,
  output: WritableStream<string>,
): Promise<void> {
  const writer = output.getWriter();
  try {
    for await (const line of input) {
      if (line.trim().length === 0) continue;
      let resp: Response;
      try {
        const req = JSON.parse(line) as Request;
        resp = dispatch(adapter, req);
      } catch {
        resp = {
          v: PROTOCOL_VERSION,
          id: -1,
          ok: false,
          error: { code: "bad_args", reason: "line was not valid JSON" },
        };
      }
      await writer.write(encodeLine(resp));
    }
  } finally {
    await writer.close();
  }
}

/**
 * Drive an adapter over string streams: write request lines to `output`, match
 * response lines from `input` by id. Phase-0 is synchronous, but requests are
 * correlated by id so pipelining later needs no format change.
 */
export class LineClient {
  #writer: WritableStreamDefaultWriter<string>;
  #nextId = 0;
  #pending = new Map<number, (r: Response) => void>();
  #loop: Promise<void>;
  readonly #timeoutMs: number;

  /**
   * `timeoutMs` is a wall-clock safety timeout: if a response does not arrive in
   * time the request fails loud instead of hanging CI. It is a liveness guard on
   * the real-IO boundary, deliberately not part of the deterministic sim clock;
   * 0 disables it.
   */
  constructor(input: ReadableStream<string>, output: WritableStream<string>, timeoutMs = 0) {
    this.#writer = output.getWriter();
    this.#timeoutMs = timeoutMs;
    this.#loop = this.#readLoop(input);
  }

  async #readLoop(input: ReadableStream<string>): Promise<void> {
    for await (const line of input) {
      if (line.trim().length === 0) continue;
      const resp = JSON.parse(line) as Response;
      const resolve = this.#pending.get(resp.id);
      if (resolve) {
        this.#pending.delete(resp.id);
        resolve(resp);
      }
    }
    // Stream ended: fail any still-pending requests so callers do not hang.
    for (const [id, resolve] of this.#pending) {
      resolve({ v: PROTOCOL_VERSION, id, ok: false, error: { code: "sut_error", reason: "stream closed" } });
    }
    this.#pending.clear();
  }

  /** Send one operation and await its response (or a timeout, if one is set). */
  request(op: Op, args: Record<string, unknown> = {}): Promise<Response> {
    this.#nextId += 1;
    const id = this.#nextId;
    const req: Request = { v: PROTOCOL_VERSION, id, op, args };
    const done = new Promise<Response>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (r: Response) => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(r);
      };
      this.#pending.set(id, settle);
      if (this.#timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.#pending.delete(id)) {
            resolve({
              v: PROTOCOL_VERSION,
              id,
              ok: false,
              error: { code: "sut_error", reason: "request timed out", op, timeoutMs: this.#timeoutMs },
            });
          }
        }, this.#timeoutMs);
      }
    });
    this.#writer.write(encodeLine(req));
    return done;
  }

  /** Close the request stream and wait for the read loop to drain. */
  async close(): Promise<void> {
    await this.#writer.close();
    await this.#loop;
  }
}
