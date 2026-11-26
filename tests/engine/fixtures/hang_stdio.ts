// Test fixture: consume stdin and never reply, to exercise the client safety
// timeout. Exits cleanly once stdin closes.
await Deno.stdin.readable.pipeTo(new WritableStream());
