//! Cross-language conformance: the Rust echo adapter must produce exactly the
//! responses the TypeScript echo adapter produced, captured in the shared golden
//! fixture (conformance/echo-golden.json, generated from the TS reference). This
//! is the concrete proof that both SDKs speak the same protocol v0.

use serde_json::Value;
use simharness_adapter::{dispatch, EchoAdapter, Request};

#[test]
fn echo_matches_the_shared_golden_fixture() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../conformance/echo-golden.json"
    );
    let text = std::fs::read_to_string(path).expect("golden fixture is present");
    let pairs: Vec<Value> = serde_json::from_str(&text).expect("golden fixture is valid JSON");

    let mut echo = EchoAdapter::default();
    for pair in &pairs {
        let req: Request = serde_json::from_value(pair["request"].clone()).expect("request parses");
        let got = dispatch(&mut echo, &req);
        assert_eq!(
            got, pair["response"],
            "response mismatch on request id {}",
            req.id
        );
    }
    assert!(!pairs.is_empty(), "the fixture should not be empty");
}
