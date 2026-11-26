//! The orchestrator binary: one static binary that drives a stdio system under
//! test through protocol v0 and checks determinism, with seed-first reporting.
//!
//!   simharness-orchestrator <run|replay|fuzz|snap> [--seed N] [--ticks T]
//!       [--seeds N] -- <sut-command> [args...]
//!
//! Example (drive a Rust SUT):   simharness-orchestrator fuzz -- ./simharness-echo
//! Example (drive a TS SUT):     simharness-orchestrator replay -- deno run sut.ts

use simharness_orchestrator::{canonical, drive, fuzz, replay_ok, StdioTransport, Transport};
use std::process::exit;

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}

fn usage() -> ! {
    eprintln!(
        "usage: simharness-orchestrator <run|replay|fuzz|snap> [--seed N] [--ticks T] [--seeds N] -- <sut-command> [args...]"
    );
    exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sep = args.iter().position(|a| a == "--");
    let (head, sut): (&[String], Vec<String>) = match sep {
        Some(i) => (&args[..i], args[i + 1..].to_vec()),
        None => (&args[..], Vec::new()),
    };
    if head.is_empty() || sut.is_empty() {
        usage();
    }

    let cmd = head[0].as_str();
    let seed: f64 = flag(head, "--seed")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let ticks: usize = flag(head, "--ticks")
        .and_then(|s| s.parse().ok())
        .unwrap_or(200);
    let seeds: usize = flag(head, "--seeds")
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);

    let sut_cmd = sut[0].clone();
    let sut_args = sut[1..].to_vec();
    let sut_display = sut.join(" ");
    let spawn_cmd = sut_cmd.clone();
    let spawn_args = sut_args.clone();
    let mut make = move || -> Box<dyn Transport> {
        Box::new(StdioTransport::spawn(&spawn_cmd, &spawn_args).expect("spawn SUT"))
    };

    match cmd {
        "run" => {
            let r = drive(&mut *make(), seed, ticks);
            println!("run seed={seed} ticks={ticks}");
            println!("{}", canonical(&r.final_state));
            if let Some(e) = r.error {
                eprintln!("protocol error: {e}");
                exit(1);
            }
        }
        "replay" => match replay_ok(&mut make, seed, ticks) {
            Ok(()) => println!("replay seed={seed} deterministic=yes"),
            Err(e) => {
                eprintln!("FAIL seed={seed}: {e}");
                exit(1);
            }
        },
        "fuzz" => match fuzz(&mut make, seeds, ticks) {
            None => println!("ok: {seeds} seeds x {ticks} ticks, deterministic ({sut_display})"),
            Some((s, reason)) => {
                eprintln!("FAIL seed={s}: {reason}");
                eprintln!("  reproduce: simharness-orchestrator replay --seed {s} --ticks {ticks} -- {sut_display}");
                exit(1);
            }
        },
        "snap" => {
            let r = drive(&mut *make(), seed, ticks);
            println!("{}", canonical(&r.snapshot));
        }
        _ => usage(),
    }
}
