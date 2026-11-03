// A tiny, zero-dependency assertion helper for the harness's own tests. The
// harness core ships no runtime dependencies; we keep the test support in the
// same spirit rather than pull a library in just to compare two values.

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error(msg ?? `expected ${String(expected)}, got ${String(actual)}`);
}

export function assertThrows(fn: () => unknown, msg = "expected function to throw"): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(msg);
}

/** Capture everything written to console.log / console.error while `fn` runs. */
export function captureConsole(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out, err };
}

/** Run `fn` with process.exit and console stubbed; return the exit code (null
 * if it never called exit) plus everything it printed. Output is preserved even
 * when exit is called mid-run. */
export function captureExit(fn: () => void): { code: number | null; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const realExit = process.exit;
  const log = console.log;
  const error = console.error;
  let code: number | null = null;
  console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
  // deno-lint-ignore no-explicit-any
  (process as any).exit = (c?: number) => {
    code = c ?? 0;
    throw new ExitSignal();
  };
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  } finally {
    process.exit = realExit;
    console.log = log;
    console.error = error;
  }
  return { code, out, err };
}

class ExitSignal extends Error {}
