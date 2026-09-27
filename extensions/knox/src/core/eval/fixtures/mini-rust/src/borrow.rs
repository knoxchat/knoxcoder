//! E0502 puzzle: overlapping `&` / `&mut`.
//!
//! The passing fix is `std::mem::take` / restructure — not `.clone()` or
//! `Arc<Mutex<_>>`.

/// Doubles `acc` in place. As written this is rustc-red (E0502).
pub fn double_in_place(acc: &mut String) {
    let snapshot = acc.as_str();
    acc.push_str(snapshot);
}
