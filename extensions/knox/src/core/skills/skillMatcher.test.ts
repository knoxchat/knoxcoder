import { describe, expect, it } from "vitest";

import {
  formatJevNoSkillHint,
  formatJevSkillHint,
  formatMatchedSkillsHint,
  matchSkillsByIntent,
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
