/**
 * Name of the per-user global data directory (`~/.knoxcoder`).
 *
 * KnoxCoder intentionally uses `~/.knoxcoder` instead of `~/.knox` so it never
 * collides with the external Knox marketplace extension (`knoxchat.knoxchat`),
 * which owns `~/.knox`. There is no fallback to, or migration from, `~/.knox`.
 *
 * Dependency-free on purpose so it can be imported from anywhere.
 */
export const KNOX_GLOBAL_DIR_NAME = ".knoxcoder";
