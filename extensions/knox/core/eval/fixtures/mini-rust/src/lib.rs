//! Tiny intercepted-oracle crate. Live check: `cargo test` (no network).

/// Deliberate logic bug for the live eval walkthrough: should be `a + b`.
pub fn add(a: i32, b: i32) -> i32 {
    a - b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_two_and_three() {
        assert_eq!(add(2, 3), 5);
    }
}
