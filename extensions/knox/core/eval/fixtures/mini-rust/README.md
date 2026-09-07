# mini-rust

Tiny edition-2021 lib crate for Knox Agent Rust goldens (RL-12).

**Live oracle (manual, not CI):**

```bash
cargo test          # red: add() subtracts
```

CI goldens intercept `cargo check` / `cargo test` / `cargo clippy` / `cargo fmt` — they do not need rustc on the eval runner.

Do not commit `target/`.
