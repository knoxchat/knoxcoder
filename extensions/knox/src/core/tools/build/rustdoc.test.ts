import { describe, expect, it } from "vitest";

import {
  RUSTDOC_FALLBACK_MARKER,
  crateSourceReadHints,
  formatDocLookupFallback,
  lookupRustdocSymbol,
} from "./rustdoc";

const DOC_JSON = JSON.stringify({
  index: {
    "0:1": {
      name: "add",
      docs: "Add two integers.",
      inner: { function: { decl: "pub fn add(a: i32, b: i32) -> i32" } },
    },
  },
});

/** Shape produced by rustdoc `--output-format json` (decl is structured). */
const REAL_RUSTDOC_JSON = JSON.stringify({
  format_version: 39,
  paths: {
    "0:7": { crate_id: 0, path: ["mini_rust", "add"], kind: "function" },
  },
  index: {
    "0:7": {
      docs: "Add two integers.",
      inner: {
        function: {
          header: { is_const: false, is_async: false, is_unsafe: false },
          decl: {
            inputs: [
              ["a", { primitive: "i32" }],
              ["b", { primitive: "i32" }],
            ],
            output: { primitive: "i32" },
          },
        },
      },
    },
  },
});

describe("lookupRustdocSymbol", () => {
  it("returns signature + docs from rustdoc JSON", () => {
    const hit = lookupRustdocSymbol(DOC_JSON, "add");
    expect(hit).toContain("pub fn add(a: i32, b: i32) -> i32");
    expect(hit).toContain("Add two integers.");
    expect(lookupRustdocSymbol(DOC_JSON, "missing")).toBeUndefined();
  });

  it("reconstructs a signature from real rustdoc JSON", () => {
    const hit = lookupRustdocSymbol(REAL_RUSTDOC_JSON, "add");
    expect(hit).toContain("fn add(a: i32, b: i32) -> i32");
    expect(hit).toContain("Add two integers.");
  });
});

describe("formatDocLookupFallback", () => {
  it("points at the locked crate source, not docs.rs", () => {
    const text = formatDocLookupFallback({
      symbol: "tokio::sync::Mutex",
      cargoToml: `[dependencies]\ntokio = "1"\n`,
      cargoLock: `[[package]]\nname = "tokio"\nversion = "1.40.0"\n`,
    });
    expect(text).toContain("tokio-1.40.0");
    expect(text).toContain("~/.cargo/registry/src");
    expect(text).toContain("vendor/");
    expect(text).toContain(RUSTDOC_FALLBACK_MARKER);
    expect(text).not.toMatch(/docs\.rs\/tokio/);
  });

  it("does not invent versions without a lockfile", () => {
    const text = formatDocLookupFallback({
      symbol: "axum::Router",
      cargoToml: `[dependencies]\naxum = "0.7"\n`,
    });
    expect(text).toContain("cargo generate-lockfile");
    expect(text).not.toMatch(/axum-0\.\d/);
  });
});

describe("crateSourceReadHints", () => {
  it("includes vendor and registry paths", () => {
    expect(crateSourceReadHints("serde", "1.0.210")).toContain(
      "serde-1.0.210",
    );
  });
});
