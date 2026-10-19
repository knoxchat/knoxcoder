import { describe, expect, it } from "vitest";

import {
  formatJevNoSkillHint,
  formatJevSkillHint,
  formatMatchedSkillsHint,
  matchSkillsByIntent,
  selectTurnSkills,
} from "./skillMatcher";
import type { SkillInfo } from "./types";

function skill(name: string, description: string): SkillInfo {
  return {
    name,
    description,
    location: `/tmp/${name}/SKILL.md`,
    content: "# body",
  };
}

describe("matchSkillsByIntent", () => {
  const skills = [
    skill("git-commit", "Create conventional commit messages for git"),
    skill("react-refactor", "Refactor React components and hooks"),
    skill("postgres-migrate", "Write Postgres SQL migrations safely"),
  ];

  it("ranks skills that share tokens with the message", () => {
    const matches = matchSkillsByIntent(
      "Please help me refactor this React component",
      skills,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("react-refactor");
  });

  it("returns empty for unrelated messages", () => {
    expect(
      matchSkillsByIntent("what time is lunch today", skills, {
        minScore: 0.3,
      }),
    ).toEqual([]);
  });

  it("formats a compact system hint", () => {
    const matches = matchSkillsByIntent("git commit message please", skills, {
      minScore: 0.1,
    });
    const hint = formatMatchedSkillsHint(matches);
    expect(hint).toContain("## Suggested Skills");
    expect(hint).toContain("`git-commit`");
  });

  it("formats a Jev one-skill relevance block", () => {
    const hint = formatJevSkillHint(skills[1]);
    expect(hint).toContain("<skill_relevance>");
    expect(hint).toContain("react-refactor");
    expect(hint).not.toContain("## Suggested Skills");
  });

  it("formats the cookbook quiet block when nothing applies", () => {
    const hint = formatJevNoSkillHint();
    expect(hint).toContain("<skill_relevance>");
    expect(hint).toContain("No skill in the roster appears relevant");
    expect(hint).not.toContain("## Suggested Skills");
  });
});

describe("selectTurnSkills (K-074)", () => {
  const linux = {
    name: "linux-kernel",
    description: "Linux kernel development",
    location: "/bundled/linux-kernel/SKILL.md",
    content: "# Linux kernel\nNever make mrproper unless asked.",
  };
  const react = {
    name: "react-refactor",
    description: "Refactor React components",
    location: "/tmp/react/SKILL.md",
    content: "# React body that must stay out of the hint",
    globs: ["**/*.tsx"],
  };
  const rust = {
    name: "rust",
    description: "Cargo / rustc loop",
    location: "/bundled/rust/SKILL.md",
    content: "cargo check --workspace",
  };
  const kbuild = {
    name: "kbuild",
    description: "Kbuild / Make / Ninja",
    location: "/bundled/kbuild/SKILL.md",
    content: "make mrproper is refused",
  };

  it("prefers glob-frontmatter matches on the open file", () => {
    const matches = selectTurnSkills({
      message: "please help",
      skills: [linux, react, rust],
      openPaths: ["src/App.tsx"],
    });
    expect(matches[0]?.skill.name).toBe("react-refactor");
  });

  it("does not dump linux-kernel SKILL body in a Node workspace", () => {
    const matches = selectTurnSkills({
      message: "add a React button to the settings card",
      skills: [linux, react, rust, kbuild],
      openPaths: ["package.json", "src/index.ts"],
      workspaceKind: "node",
    });
    const hint = formatMatchedSkillsHint(matches);
    expect(hint).not.toMatch(/mrproper/i);
    expect(hint).not.toContain(linux.content);
    expect(hint).not.toContain("# Linux kernel");
    expect(matches.length).toBeLessThanOrEqual(3);
  });

  it("pins kbuild extra on a systems workspace", () => {
    const extra = skill("git-commit", "Create conventional commit messages for git");
    const matches = selectTurnSkills({
      message: "git commit message please",
      skills: [linux, rust, kbuild, extra],
      workspaceKind: "kernel",
      profile: "systems",
    });
    expect(matches.some((match) => match.skill.name === "kbuild")).toBe(true);
    expect(matches.length).toBeLessThanOrEqual(4);
  });
});
