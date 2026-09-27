import { describe, expect, it } from "vitest";

import { SkillManager, getBundledSkillsPath } from "./skillManager";
import { matchSkillsByIntent } from "./skillMatcher";

describe("bundled systems skills (HL-40)", () => {
  it("ships linux-kernel, qemu, gdb, kbuild", async () => {
    const manager = new SkillManager({
      workspaceDirs: ["/tmp/nonexistent-knox-skills-ws"],
      disableExternalSkills: true,
    });
    await manager.load();
    const names = manager.all().map((skill) => skill.name);
    expect(names).toEqual(
      expect.arrayContaining(["linux-kernel", "qemu", "gdb", "kbuild", "rust"]),
    );
    expect(getBundledSkillsPath()).toMatch(/bundled$/);
    expect(manager.get("linux-kernel")?.content).toMatch(/mrproper/i);
    expect(manager.get("qemu")?.content).toMatch(/-s -S/);
  });

  it("suggests linux-kernel on a boot panic in mm", async () => {
    const manager = new SkillManager({
      workspaceDirs: ["/tmp/nonexistent-knox-skills-ws"],
      disableExternalSkills: true,
    });
    await manager.load();
    const matches = matchSkillsByIntent(
      "boot panic in mm",
      manager.all(),
      { minScore: 0.12 },
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("linux-kernel");
  });

  it("suggests rust on a borrowck fix in src/lib.rs", async () => {
    const manager = new SkillManager({
      workspaceDirs: ["/tmp/nonexistent-knox-skills-ws"],
      disableExternalSkills: true,
    });
    await manager.load();
    expect(manager.get("rust")?.content).toMatch(/cargo check/);
    const matches = matchSkillsByIntent(
      "fix E0502 in src/lib.rs",
      manager.all(),
      { minScore: 0.12 },
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("rust");
  });
});
