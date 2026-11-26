//! The Simharness orchestrator (#43). It drives a system under test through
//! protocol v0 over a transport (in-process or stdio), and checks the one
//! universal property a black-box SUT can be held to without knowing its
//! invariants: determinism. Same seed in, identical final state and snapshot
//! out, and no unexpected protocol error along the way. Reporting is seed-first.
//!
//! The orchestrator's own choices (which legal action to drive each tick) come
//! from a seeded PRNG, so the drive is a pure function of the seed and the SUT.
//!
//! Determinism (ADR-005): no clock, no unseeded entropy, no threads, and
//! serde_json's ordered maps.

use serde_json::{json, Value};
use simharness_adapter::{dispatch, Adapter, Request};
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// A synchronous request/response channel to one SUT instance.
pub trait Transport {
    fn request(&mut self, op: &str, args: Value) -> Value;
}

/// Drives an in-process adapter through the shared dispatch (no subprocess).
pub struct InProcessTransport<A: Adapter> {
    adapter: A,
    next_id: i64,
}

impl<A: Adapter> InProcessTransport<A> {
    pub fn new(adapter: A) -> Self {
        Self {
            adapter,
            next_id: 0,
        }
    }
}

impl<A: Adapter> Transport for InProcessTransport<A> {
    fn request(&mut self, op: &str, args: Value) -> Value {
        self.next_id += 1;
        let req = Request {
            v: 0,
            id: self.next_id,
            op: op.to_string(),
            args,
        };
        dispatch(&mut self.adapter, &req)
    }
}

/// Drives a child-process SUT over the stdio JSON line protocol.
pub struct StdioTransport {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: i64,
}

impl StdioTransport {
    /// Spawn `command args...` as the SUT and connect to its stdin/stdout.
    pub fn spawn(command: &str, args: &[String]) -> io::Result<Self> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = Some(child.stdin.take().expect("child stdin"));
        let stdout = BufReader::new(child.stdout.take().expect("child stdout"));
        Ok(Self {
            child,
            stdin,
            stdout,
            next_id: 0,
        })
    }
}

impl Transport for StdioTransport {
    fn request(&mut self, op: &str, args: Value) -> Value {
        self.next_id += 1;
        let req = json!({ "v": 0, "id": self.next_id, "op": op, "args": args });
        let stdin = self.stdin.as_mut().expect("stdin is open");
        writeln!(
            stdin,
            "{}",
            serde_json::to_string(&req).expect("serialize request")
        )
        .expect("write request");
        stdin.flush().expect("flush request");
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("read response");
        serde_json::from_str(&line).unwrap_or_else(
            |_| json!({ "ok": false, "error": { "code": "sut_error", "reason": "unreadable response" } }),
        )
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        // Close stdin first so the child sees EOF and exits, then reap it.
        // Waiting before closing stdin would deadlock: the child blocks reading.
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

/// The outcome of one deterministic drive of a SUT.
pub struct RunResult {
    pub seed: f64,
    pub final_state: Value,
    pub snapshot: Value,
    /// Set if the SUT returned an unexpected protocol error during the drive.
    pub error: Option<String>,
}

/// An error response that is not a benign `unsupported`.
fn problem(resp: &Value) -> Option<String> {
    if resp.get("ok") == Some(&Value::Bool(false)) {
        let code = resp["error"]["code"].as_str().unwrap_or("error");
        if code != "unsupported" {
            return Some(code.to_string());
        }
    }
    None
}

/// mulberry32: a small deterministic PRNG for the orchestrator's own choices.
struct Rng {
    state: u32,
}
impl Rng {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }
    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    fn below(&mut self, max: usize) -> usize {
        if max == 0 {
            0
        } else {
            (self.next_u32() as usize) % max
        }
    }
}

/// Drive a SUT for `ticks` ticks from `seed`: reset, then each tick drive a
/// seeded legal action (if the SUT has an action seam) and advance one tick.
pub fn drive<T: Transport + ?Sized>(transport: &mut T, seed: f64, ticks: usize) -> RunResult {
    let hello = transport.request("hello", json!({ "protocol": 0 }));
    let supports_actions = hello["result"]["supportsActions"]
        .as_bool()
        .unwrap_or(false);

    let mut error = problem(&hello);
    transport.request("reset", json!({ "seed": seed }));
    let mut rng = Rng::new((seed as i64 as u32) ^ 0x9e37_79b9);

    for _ in 0..ticks {
        if error.is_some() {
            break;
        }
        if supports_actions {
            let actions = transport.request("available_actions", json!({}));
            if let Some(list) = actions["result"].as_array() {
                if !list.is_empty() {
                    let action = list[rng.below(list.len())]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let acted = transport.request("act", json!({ "action": action }));
                    error = error.or_else(|| problem(&acted));
                }
            }
        }
        let ticked = transport.request("tick", json!({}));
        error = error.or_else(|| problem(&ticked));
    }

    let final_state = transport.request("read_state", json!({}))["result"].clone();
    let snap = transport.request("snapshot", json!({}));
    let snapshot = if snap.get("ok") == Some(&Value::Bool(true)) {
        snap["result"].clone()
    } else {
        final_state.clone()
    };

    RunResult {
        seed,
        final_state,
        snapshot,
        error,
    }
}

/// Check that a SUT is deterministic at `seed`: two fresh drives agree and
/// neither hit a protocol error. `make` produces a fresh SUT instance per drive.
pub fn replay_ok(
    make: &mut dyn FnMut() -> Box<dyn Transport>,
    seed: f64,
    ticks: usize,
) -> Result<(), String> {
    let a = drive(&mut *make(), seed, ticks);
    if let Some(e) = a.error {
        return Err(format!("protocol error: {e}"));
    }
    let b = drive(&mut *make(), seed, ticks);
    if let Some(e) = b.error {
        return Err(format!("protocol error: {e}"));
    }
    if a.final_state != b.final_state {
        return Err("nondeterministic final state across replays".to_string());
    }
    if a.snapshot != b.snapshot {
        return Err("nondeterministic snapshot across replays".to_string());
    }
    Ok(())
}

/// Fuzz across seeds 0..seeds; return the first failing seed and its reason.
pub fn fuzz(
    make: &mut dyn FnMut() -> Box<dyn Transport>,
    seeds: usize,
    ticks: usize,
) -> Option<(f64, String)> {
    for s in 0..seeds {
        let seed = s as f64;
        if let Err(reason) = replay_ok(make, seed, ticks) {
            return Some((seed, reason));
        }
    }
    None
}

/// A stable, sorted JSON snapshot (serde_json orders object keys).
pub fn canonical(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}
