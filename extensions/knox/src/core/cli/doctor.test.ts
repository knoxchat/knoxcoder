import { describe, expect, it } from "vitest";

import { formatDoctorReport, runDoctor } from "./doctor";
import { knoxCliVersion } from "./version";

describe("knox doctor", () => {
  it("reports version, node, git and sandbox without failing the suite", () => {
    const report = runDoctor();
    expect(report.version).toBe(knoxCliVersion());
    expect(report.node).toBe(process.versions.node);
    expect(report.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(["node", "auth", "config", "git", "workspace", "sqlite3", "sandbox"]),
    );
    const text = formatDoctorReport(report);
    expect(text).toContain(`knox ${report.version}`);
    expect(text).not.toMatch(/sk-|kc_live_|apiKey/);
  });
});
