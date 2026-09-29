import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { writeFileImpl } from "./writeFile";

function mockIde(overrides: Partial<IDE> = {}): IDE {
  return {
    fileExists: vi.fn(async () => false),
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    getCurrentFile: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as IDE;
}

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_write_file" } } as ToolExtras["tool"],
  };
}

describe("writeFileImpl", () => {
  it("creates a new file", async () => {
    const ide = mockIde();
    const result = await writeFileImpl(
      { filepath: "src/new.ts", contents: "export const x = 1;\n" },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/src/new.ts",
      "export const x = 1;\n",
    );
    expect(ide.openFile).toHaveBeenCalled();
    expect(result[0].description).toMatch(/Created/);
  });

  it("overwrites an existing file", async () => {
    const ide = mockIde({ fileExists: vi.fn(async () => true) });
    const result = await writeFileImpl(
      { filepath: "src/a.ts", contents: "rewritten" },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/src/a.ts",
      "rewritten",
    );
    expect(result[0].description).toMatch(/Overwrote/);
  });

  it("rejects missing filepath or non-string contents", async () => {
    const ide = mockIde();
    await expect(
      writeFileImpl({ contents: "x" }, extras(ide)),
    ).rejects.toThrow(/filepath/i);
    await expect(
      writeFileImpl({ filepath: "a.ts", contents: 1 }, extras(ide)),
    ).rejects.toThrow(/string/i);
  });

  it("skips opening when openAfterWrite is false", async () => {
    const ide = mockIde();
    await writeFileImpl(
      { filepath: "a.ts", contents: "", openAfterWrite: false },
      extras(ide),
    );
    expect(ide.openFile).not.toHaveBeenCalled();
  });

  it("rewrites a new Cargo.toml from edition 2021 to 2024", async () => {
    const ide = mockIde();
    await writeFileImpl(
      {
        filepath: "Cargo.toml",
        contents: `[package]
name = "demo"
version = "0.1.0"
edition = "2021"
`,
      },
      extras(ide),
    );
    const written = vi.mocked(ide.writeFile).mock.calls[0][1];
    expect(written).toContain('edition = "2024"');
    expect(written).toContain('rust-version = "1.98.1"');
    expect(written).not.toContain('edition = "2021"');
  });

  it("tells the model when it normalized a new Cargo.toml", async () => {
    const ide = mockIde();
    const result = await writeFileImpl(
      {
        filepath: "Cargo.toml",
        contents: `[package]\nname = "demo"\nedition = "2021"\n`,
      },
      extras(ide),
    );
    expect(result[0].content).toMatch(/normalized new Rust project pins/);
    expect(result[0].content).toContain('edition = "2024"');
    expect(result[0].content).toMatch(/read it before editing/);
  });

  it("stays silent when the Cargo.toml already matched the defaults", async () => {
    const ide = mockIde();
    const result = await writeFileImpl(
      {
        filepath: "Cargo.toml",
        contents: `[package]\nname = "demo"\nedition = "2024"\nrust-version = "1.98.1"\n`,
      },
      extras(ide),
    );
    expect(result[0].content).not.toMatch(/normalized/);
  });

  it("does not rewrite edition on an existing Cargo.toml", async () => {
    const ide = mockIde({ fileExists: vi.fn(async () => true) });
    const contents = `[package]
name = "demo"
edition = "2024"
`;
    await writeFileImpl({ filepath: "Cargo.toml", contents }, extras(ide));
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/Cargo.toml",
      contents,
    );
  });
});
