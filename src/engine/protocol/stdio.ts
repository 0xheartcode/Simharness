// Real-process stdio wiring. These are the thin wrappers that bind the line
// protocol (lines.ts) to an actual child process and to this process's own
// stdin/stdout. The framing and dispatch they rely on are tested in memory;
// here we only connect pipes.

import type { Adapter } from "./adapter.ts";
import { LineClient, runLineServer, toLineStream } from "./lines.ts";

/** A WritableStream<string> that UTF-8 encodes into a byte sink. */
function stringSink(bytes: WritableStream<Uint8Array>): WritableStream<string> {
  const enc = new TextEncoderStream();
  enc.readable.pipeTo(bytes).catch(() => {});
  return enc.writable;
}

/**
 * Serve an adapter as a stdio black box: read requests from this process's
 * stdin, write responses to stdout. The entrypoint of an out-of-process adapter
 * calls this and nothing else. Resolves when stdin closes.
 */
export function serveStdio(adapter: Adapter): Promise<void> {
  return runLineServer(adapter, toLineStream(Deno.stdin.readable), stringSink(Deno.stdout.writable));
}

/** A live connection to a child-process adapter. */
export interface Subprocess {
  client: LineClient;
  /** Everything the child has written to stderr so far, for diagnosing a crash. */
  stderr(): string;
  /** Close stdin, wait for the read loop and the child to exit; returns the exit status. */
  close(): Promise<Deno.CommandStatus>;
}

export interface SubprocessOptions {
  /** Wall-clock per-request safety timeout in ms (0 disables it). */
  timeoutMs?: number;
}

/**
 * Spawn a child-process adapter and return a client wired to its stdin/stdout.
 * `command` and `args` launch the adapter (for a Deno adapter: the deno binary
 * plus `run <flags> entry.ts`). stderr is captured so a crash is diagnosable,
 * and an optional per-request timeout stops a hung child from blocking forever.
 */
export function connectSubprocess(command: string, args: string[], opts: SubprocessOptions = {}): Subprocess {
  const child = new Deno.Command(command, {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const client = new LineClient(toLineStream(child.stdout), stringSink(child.stdin), opts.timeoutMs ?? 0);

  // Drain stderr into a buffer so it can be surfaced if the child misbehaves.
  let stderrText = "";
  const stderrDone = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) stderrText += decoder.decode(chunk, { stream: true });
  })().catch(() => {});

  return {
    client,
    stderr: () => stderrText,
    async close() {
      await client.close();
      const status = await child.status;
      await stderrDone;
      return status;
    },
  };
}
