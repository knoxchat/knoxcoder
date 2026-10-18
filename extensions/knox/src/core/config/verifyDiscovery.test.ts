import { describe, expect, it } from "vitest";

import { extractAgentsMdVerifyCommand } from "./agentsMd";
import {
  discoverVerifyCommandFromProbe,
  kindDefaultVerifyCommand,
  nodePackageManager,
} from "./verifyDiscovery";

describe("nodePackageManager", () => {
  it("prefers pnpm, then yarn, then bun, else npm", () => {
    expect(nodePackageManager(["pnpm-lock.yaml", "package-lock.json"])).toBe(
      "pnpm",
    );
    expect(nodePackageManager(["yarn.lock"])).toBe("yarn");
    expect(nodePackageManager(["bun.lockb"])).toBe("bun");
    expect(nodePackageManager(["package.json"])).toBe("npm");
  });
});

describe("extractAgentsMdVerifyCommand", () => {
  it("reads the first fenced command under a Test heading", () => {
    expect(
      extractAgentsMdVerifyCommand(`# demo

## Test

\`\`\`
pnpm test --silent
\`\`\`
`),
    ).toBe("pnpm test --silent");
  });

  it("accepts Verify headings", () => {
    expect(
      extractAgentsMdVerifyCommand("## Verify\n\n```sh\nmake test\n```\n"),
    ).toBe("make test");
  });
});

describe("discoverVerifyCommandFromProbe", () => {
  it("lets AGENTS.md win over kind defaults", () => {
    expect(
      discoverVerifyCommandFromProbe({
        kind: "node",
        entries: ["package.json"],
        packageJson: JSON.stringify({ scripts: { test: "vitest" } }),
        agentsMd: "## Test\n\n```\nmake test\n```\n",
      }),
    ).toBe("make test");
  });

  it("uses npm test --silent for a Node test script", () => {
    expect(
      kindDefaultVerifyCommand({
        kind: "node",
        entries: ["package.json"],
        packageJson: JSON.stringify({ scripts: { test: "vitest run" } }),
      }),
    ).toBe("npm test --silent");
  });

  it("uses go test for a Go module", () => {
    expect(
      kindDefaultVerifyCommand({
        kind: "go",
        entries: ["go.mod"],
      }),
    ).toBe("go test ./...");
  });

  it("does not auto-run gulp for this editor", () => {
    expect(
      kindDefaultVerifyCommand({
        kind: "editor",
        entries: ["package.json", "src", "extensions", "product.json"],
      }),
    ).toBe("");
  });
});
