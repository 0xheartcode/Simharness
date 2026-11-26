//! Rust adapter SDK for Simharness protocol v0.
//!
//! A system under test implements [`Adapter`]; [`dispatch`] turns one request
//! into one response with exactly the semantics of the TypeScript reference
//! (see `src/engine/protocol/dispatch.ts`), and [`serve_stdio`] runs the JSON
//! line protocol over stdin/stdout so the orchestrator can drive it as a black
//! box. The cross-language conformance test checks this crate's output against
//! the same golden fixture the TypeScript echo adapter produces.
//!
//! Determinism (ADR-005): this crate uses `serde_json::Value`, whose object maps
//! are ordered (`BTreeMap`), and reads no clock and no unseeded entropy. Those
//! rules are the SUT's to honor; the SDK does not break them.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

/// The protocol version this SDK speaks.
pub const PROTOCOL_VERSION: i64 = 0;

/// A request from the orchestrator.
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub v: i64,
    pub id: i64,
    pub op: String,
    #[serde(default)]
    pub args: Value,
}

/// What a SUT advertises at `hello`.
#[derive(Debug, Clone, Serialize)]
pub struct Capabilities {
    pub name: String,
    pub protocol: i64,
    #[serde(rename = "supportsActions")]
    pub supports_actions: bool,
    #[serde(rename = "supportsNetwork")]
    pub supports_network: bool,
    #[serde(rename = "supportsStorage")]
    pub supports_storage: bool,
    #[serde(rename = "supportsByteNetwork")]
    pub supports_byte_network: bool,
    #[serde(rename = "deterministicConcurrency")]
    pub deterministic_concurrency: bool,
}

/// A system under test. Only `hello`, `reset`, and `read_state` are required; an
/// optional op is reported `unsupported` unless `supports` returns true for it.
pub trait Adapter {
    fn hello(&self) -> Capabilities;
    fn reset(&mut self, seed: Value, config: Option<Value>);
    fn read_state(&self) -> Value;

    /// Report whether an optional op (`tick`, `available_actions`, `act`,
    /// `deliver`, `drain_outbox`, `history`, `snapshot`) is implemented.
    fn supports(&self, _op: &str) -> bool {
        false
    }

    fn tick(&mut self) {}
    fn available_actions(&self) -> Vec<String> {
        Vec::new()
    }
    fn act(&mut self, _action: &str) {}
    fn deliver(&mut self, _message: Value) {}
    fn drain_outbox(&mut self) -> Value {
        json!([])
    }
    fn history(&self) -> Value {
        json!([])
    }
    fn snapshot(&self) -> Value {
        Value::Null
    }
    fn bye(&mut self) {}
}

fn ok(id: i64, result: Value) -> Value {
    json!({ "v": PROTOCOL_VERSION, "id": id, "ok": true, "result": result })
}

fn err(id: i64, code: &str, mut extra: Value) -> Value {
    let obj = extra.as_object_mut().expect("extra must be an object");
    obj.insert("code".into(), json!(code));
    json!({ "v": PROTOCOL_VERSION, "id": id, "ok": false, "error": extra })
}

fn unsupported(id: i64, op: &str) -> Value {
    err(id, "unsupported", json!({ "op": op }))
}

/// Turn one request into one response, with the reference dispatch semantics.
pub fn dispatch(adapter: &mut dyn Adapter, req: &Request) -> Value {
    if req.v != PROTOCOL_VERSION {
        return err(
            req.id,
            "protocol_mismatch",
            json!({ "expected": PROTOCOL_VERSION, "got": req.v }),
        );
    }

    match req.op.as_str() {
        "hello" => {
            if let Some(asked) = req.args.get("protocol") {
                if asked != &json!(PROTOCOL_VERSION) {
                    return err(
                        req.id,
                        "protocol_mismatch",
                        json!({ "expected": PROTOCOL_VERSION, "got": asked }),
                    );
                }
            }
            ok(
                req.id,
                serde_json::to_value(adapter.hello()).unwrap_or(Value::Null),
            )
        }
        "reset" => match req.args.get("seed") {
            Some(seed) if seed.is_number() => {
                let config = req.args.get("config").cloned();
                if let Some(c) = &config {
                    if !c.is_object() {
                        return err(
                            req.id,
                            "bad_args",
                            json!({ "op": "reset", "reason": "config must be an object" }),
                        );
                    }
                }
                adapter.reset(seed.clone(), config);
                ok(req.id, Value::Null)
            }
            _ => err(
                req.id,
                "bad_args",
                json!({ "op": "reset", "reason": "seed must be a finite number" }),
            ),
        },
        "read_state" => ok(req.id, adapter.read_state()),
        "tick" => {
            if !adapter.supports("tick") {
                return unsupported(req.id, "tick");
            }
            adapter.tick();
            ok(req.id, Value::Null)
        }
        "available_actions" => {
            if !adapter.supports("available_actions") {
                return unsupported(req.id, "available_actions");
            }
            ok(req.id, json!(adapter.available_actions()))
        }
        "act" => {
            if !adapter.supports("act") {
                return unsupported(req.id, "act");
            }
            match req.args.get("action").and_then(|a| a.as_str()) {
                Some(action) => {
                    adapter.act(action);
                    ok(req.id, Value::Null)
                }
                None => err(
                    req.id,
                    "bad_args",
                    json!({ "op": "act", "reason": "action must be a string" }),
                ),
            }
        }
        "deliver" => {
            if !adapter.supports("deliver") {
                return unsupported(req.id, "deliver");
            }
            match req.args.get("message") {
                Some(m) if m.is_object() => {
                    adapter.deliver(m.clone());
                    ok(req.id, Value::Null)
                }
                _ => err(
                    req.id,
                    "bad_args",
                    json!({ "op": "deliver", "reason": "message must be an object" }),
                ),
            }
        }
        "drain_outbox" => {
            if !adapter.supports("drain_outbox") {
                return unsupported(req.id, "drain_outbox");
            }
            ok(req.id, adapter.drain_outbox())
        }
        "history" => {
            if !adapter.supports("history") {
                return unsupported(req.id, "history");
            }
            ok(req.id, adapter.history())
        }
        "snapshot" => {
            if !adapter.supports("snapshot") {
                return unsupported(req.id, "snapshot");
            }
            ok(req.id, adapter.snapshot())
        }
        "bye" => {
            adapter.bye();
            ok(req.id, Value::Null)
        }
        other => unsupported(req.id, other),
    }
}

/// Serve an adapter over stdio: read request lines from stdin, write response
/// lines to stdout, until stdin closes. A line that is not valid JSON gets a
/// `bad_args` response with id -1, matching the reference server.
pub fn serve_stdio(adapter: &mut dyn Adapter) -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<Request>(&line) {
            Ok(req) => dispatch(adapter, &req),
            Err(_) => json!({
                "v": PROTOCOL_VERSION,
                "id": -1,
                "ok": false,
                "error": { "code": "bad_args", "reason": "line was not valid JSON" }
            }),
        };
        writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
        stdout.flush()?;
    }
    Ok(())
}

/// The trivial echo adapter: the Rust counterpart of the TypeScript reference,
/// used to prove both speak the same protocol against the shared golden fixture.
pub struct EchoAdapter {
    seed: Value,
    tick: i64,
    last: Value,
}

impl Default for EchoAdapter {
    fn default() -> Self {
        EchoAdapter {
            seed: json!(0),
            tick: 0,
            last: Value::Null,
        }
    }
}

impl Adapter for EchoAdapter {
    fn hello(&self) -> Capabilities {
        Capabilities {
            name: "echo".into(),
            protocol: 0,
            supports_actions: true,
            supports_network: false,
            supports_storage: false,
            supports_byte_network: false,
            deterministic_concurrency: true,
        }
    }

    fn reset(&mut self, seed: Value, _config: Option<Value>) {
        self.seed = seed;
        self.tick = 0;
        self.last = Value::Null;
    }

    fn read_state(&self) -> Value {
        json!({ "tick": self.tick, "phase": "running", "extra": { "seed": self.seed, "last": self.last } })
    }

    fn supports(&self, op: &str) -> bool {
        matches!(op, "tick" | "available_actions" | "act")
    }

    fn tick(&mut self) {
        self.tick += 1;
    }

    fn available_actions(&self) -> Vec<String> {
        vec!["ping".into(), "pong".into()]
    }

    fn act(&mut self, action: &str) {
        self.last = Value::String(action.to_string());
    }
}
