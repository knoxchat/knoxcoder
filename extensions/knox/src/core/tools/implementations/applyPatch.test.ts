import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { applyPatchImpl } from "./applyPatch";

function mockIde(files: Record<string, string>): IDE {
  const store = { ...files };
  return {
    fileExists: vi.fn(async (uri: string) => uri in store),
    readFile: vi.fn(async (uri: string) => {
      if (!(uri in store)) {
        throw new Error("missing");
      }
      return store[uri];
    }),
    writeFile: vi.fn(async (uri: string, contents: string) => {
      store[uri] = contents;
    }),
    removeFile: vi.fn(async (uri: string) => {
      delete store[uri];
    }),
    openFile: vi.fn(async () => {}),
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    getCurrentFile: vi.fn(async () => undefined),
  } as unknown as IDE;
}

function extras(ide: IDE, aborted = false): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_apply_patch" } } as ToolExtras["tool"],
    abortSignal: aborted ? AbortSignal.abort() : undefined,
  };
}

const UPDATE = `*** Begin Patch
*** Update File: src/a.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** End Patch`;

describe("applyPatchImpl", () => {
  it("updates an existing file and returns a diff", async () => {
    const ide = mockIde({
      "file:///tmp/ws/src/a.ts": "const a = 1;\nconst b = 2;\n",
    });
    const result = await applyPatchImpl({ patch: UPDATE }, extras(ide));
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/src/a.ts",
      "const a = 1;\nconst b = 3;\n",
    );
    expect(result[0].content).toContain("M\tsrc/a.ts");
    expect(result[0].content).toContain("+const b = 3;");
  });

  it("adds and deletes atomically", async () => {
    const ide = mockIde({
      "file:///tmp/ws/src/gone.ts": "bye\n",
    });
    const result = await applyPatchImpl(
      {
        patch: `*** Begin Patch
*** Add File: src/new.ts
+hello
*** Delete File: src/gone.ts
*** End Patch`,
      },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/src/new.ts",
      "hello\n",
    );
    expect(ide.removeFile).toHaveBeenCalledWith("file:///tmp/ws/src/gone.ts");
    expect(result[0].description).toMatch(/2 files/);
  });

  it("rolls back earlier writes when a later write fails", async () => {
    const ide = mockIde({
      "file:///tmp/ws/src/ok.ts": "ok\n",
    });
    (ide.writeFile as ReturnType<typeof vi.fn>).mockImplementation(
      async (uri: string, contents: string) => {
        if (String(uri).endsWith("ok.ts")) {
          throw new Error("disk full");
        }
        await Promise.resolve();
        (ide as any).__written = { uri, contents };
      },
    );
    await expect(
      applyPatchImpl(
        {
          patch: `*** Begin Patch
*** Add File: src/new.ts
+hello
*** Update File: src/ok.ts
@@
-ok
+ok2
*** End Patch`,
        },
        extras(ide),
      ),
    ).rejects.toThrow(/disk full/i);
    expect(ide.removeFile).toHaveBeenCalledWith("file:///tmp/ws/src/new.ts");
  });

  it("rejects add when the file already exists", async () => {
    const ide = mockIde({
      "file:///tmp/ws/src/new.ts": "exists\n",
    });
    await expect(
      applyPatchImpl(
        {
          patch: `*** Begin Patch
*** Add File: src/new.ts
+x
*** End Patch`,
        },
        extras(ide),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it("requires a patch string", async () => {
    const ide = mockIde({});
    await expect(applyPatchImpl({}, extras(ide))).rejects.toThrow(/patch/i);
  });

  it("rewrites a new Cargo.toml add from edition 2021 to 2024", async () => {
    const ide = mockIde({});
    await applyPatchImpl(
      {
        patch: `*** Begin Patch
*** Add File: Cargo.toml
+[package]
+name = "demo"
+version = "0.1.0"
+edition = "2021"
*** End Patch`,
      },
      extras(ide),
    );
    const written = vi.mocked(ide.writeFile).mock.calls[0][1];
    expect(written).toContain('edition = "2024"');
    expect(written).toContain('rust-version = "1.98.1"');
    expect(written).not.toContain('edition = "2021"');
  });
});
