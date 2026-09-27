import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { buildImpl, optionalCargoPluginHint } from "./build";
import { RUSTDOC_FALLBACK_MARKER } from "../build/rustdoc";

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_build" } } as ToolExtras["tool"],
  };
}

describe("buildImpl action=doc (RL-28)", () => {
  it("returns rustdoc JSON when target/doc/<crate>.json exists", async () => {
    const json = JSON.stringify({
      index: {
        "0:1": {
          name: "add",
          docs: "Add two integers.",
          inner: { function: { decl: "pub fn add(a: i32, b: i32) -> i32" } },
        },
      },
    });
    const files: Record<string, string> = {
      "file:///tmp/ws/Cargo.toml": `[package]\nname = "mini_rust"\nedition = "2024"\nrust-version = "1.98.1"\n`,
      "file:///tmp/ws/target/doc/mini_rust.json": json,
    };
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async (uri: string) => uri in files),
      readFile: vi.fn(async (uri: string) => files[uri] ?? ""),
    } as unknown as IDE;

    const result = await buildImpl(
      { action: "doc", doc: "add" },
      extras(ide),
    );
    expect(result[0].content).toContain("pub fn add(a: i32, b: i32) -> i32");
    expect(result[0].content).toContain("Add two integers.");
  });

  it("falls back to locked registry/vendor paths", async () => {
    const files: Record<string, string> = {
      "file:///tmp/ws/Cargo.toml": `[package]\nname = "demo"\nedition = "2024"\nrust-version = "1.98.1"\n\n[dependencies]\ntokio = "1"\n`,
      "file:///tmp/ws/Cargo.lock": `[[package]]\nname = "tokio"\nversion = "1.40.0"\n`,
    };
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async (uri: string) => uri in files),
      readFile: vi.fn(async (uri: string) => files[uri] ?? ""),
    } as unknown as IDE;

    const result = await buildImpl(
      { action: "doc", doc: "tokio::sync::Mutex" },
      extras(ide),
    );
    expect(result[0].content).toContain("tokio-1.40.0");
    expect(result[0].content).toContain(RUSTDOC_FALLBACK_MARKER);
    expect(result[0].content).not.toMatch(/docs\.rs\/tokio/);
  });
});

describe("optionalCargoPluginHint (RL-48/50/45)", () => {
  it("returns install text for expand / deny / audit / miri", () => {
    expect(optionalCargoPluginHint("expand")?.bin).toBe("cargo-expand");
    expect(optionalCargoPluginHint("deny")?.install).toMatch(/cargo-deny/);
    expect(optionalCargoPluginHint("audit")?.install).toMatch(/cargo-audit/);
    expect(optionalCargoPluginHint("miri")?.install).toMatch(/miri/);
    expect(optionalCargoPluginHint("clippy")).toBeUndefined();
  });
});
