//! The orchestrator drives a SUT deterministically in-process, and cross-language
//! over stdio (driving the TypeScript echo adapter when deno is available).

use serde_json::Value;
use simharness_adapter::EchoAdapter;
use simharness_orchestrator::{
    drive, fuzz, replay_ok, InProcessTransport, StdioTransport, Transport,
};

#[test]
fn drive_reaches_the_expected_state_in_process() {
    let mut t = InProcessTransport::new(EchoAdapter::default());
    let r = drive(&mut t, 11.0, 3);
    assert_eq!(r.final_state["tick"], Value::from(3));
    assert!(r.error.is_none());
}

#[test]
fn replay_and_fuzz_hold_for_a_deterministic_sut() {
    let mut make =
        || -> Box<dyn Transport> { Box::new(InProcessTransport::new(EchoAdapter::default())) };
    assert!(replay_ok(&mut make, 7.0, 12).is_ok());
    assert!(fuzz(&mut make, 20, 12).is_none());
}

#[test]
fn drives_a_stdio_sut_cross_language() {
    // The Rust orchestrator drives the TypeScript echo adapter over stdio.
    let Some(deno) = find_deno() else {
        eprintln!("deno not found; skipping the cross-language stdio test");
        return;
    };
    let entry = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../examples/echo/echo_stdio.ts"
    )
    .to_string();
    let mut make = || -> Box<dyn Transport> {
        Box::new(
            StdioTransport::spawn(&deno, &["run".to_string(), entry.clone()])
                .expect("spawn the deno SUT"),
        )
    };
    assert!(
        replay_ok(&mut make, 5.0, 8).is_ok(),
        "the TypeScript echo must be deterministic under the Rust orchestrator"
    );
}

/// Resolve a deno binary: the DENO env var, then ~/.deno/bin/deno, then PATH.
fn find_deno() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        std::env::var("DENO").ok(),
        Some(format!("{home}/.deno/bin/deno")),
        Some("deno".to_string()),
    ];
    for candidate in candidates.into_iter().flatten() {
        let ok = std::process::Command::new(&candidate)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(candidate);
        }
    }
    None
}
