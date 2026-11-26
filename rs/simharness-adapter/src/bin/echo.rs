//! The echo adapter served over stdio: the Rust black-box counterpart of
//! `examples/echo/echo_stdio.ts`. The orchestrator spawns this and drives it
//! through protocol v0. Exits when stdin closes.

use simharness_adapter::{serve_stdio, EchoAdapter};

fn main() -> std::io::Result<()> {
    serve_stdio(&mut EchoAdapter::default())
}
