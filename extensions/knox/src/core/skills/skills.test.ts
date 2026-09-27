/**
 * Tests for the Skills system — frontmatter parser, @file / !shell patterns,
 * fallback sanitization, and description builder.
 */

import { describe, expect, it } from "vitest";

import { buildSkillToolDescription } from "./descriptionBuilder";
import {
  extractFileRefs,
  extractShellRefs,
  fallbackSanitization,
  parseFrontmatter,
} from "./frontmatter";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const raw = `---
name: my-skill
description: A test skill
---
# Hello
This is the body.`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("my-skill");
    expect(result!.data.description).toBe("A test skill");
    expect(result!.content.startsWith("# Hello")).toBe(true);
  });

  it("parses quoted values", () => {
    const raw = `---
name: "quoted-skill"
description: 'single quoted'
---
body`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("quoted-skill");
    expect(result!.data.description).toBe("single quoted");
  });

  it("returns undefined when frontmatter is absent", () => {
    const raw = `# Just a markdown file
No frontmatter here.`;

    expect(parseFrontmatter(raw)).toBeUndefined();
  });

  it("parses empty frontmatter", () => {
    const raw = `---
---
body content`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(Object.keys(result!.data)).toHaveLength(0);
    expect(result!.content).toBe("body content");
  });

  it("parses frontmatter with comments", () => {
    const raw = `---
# This is a comment
name: skill-with-comments
description: Has comments
---
body`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("skill-with-comments");
  });

  it("handles CRLF line endings", () => {
    const raw =
      "---\r\nname: windows-skill\r\ndescription: Windows line endings\r\n---\r\nBody text";

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("windows-skill");
  });

  it("preserves colons inside quoted values", () => {
    const raw = `---
name: colon-skill
description: "Has a colon: in the value"
---
body`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("colon-skill");
    expect(result!.data.description).toBe("Has a colon: in the value");
  });

  it("parses multiline YAML descriptions", () => {
    const raw = `---
name: multiline-skill
description: >
  This is a multiline
  description value
---
body content`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("multiline-skill");
    expect(result!.data.description).toContain("multiline");
  });

  it("parses extra frontmatter fields", () => {
    const raw = `---
name: extra-fields
description: Has extra fields
version: "1.0"
author: Test Author
tags: tools, automation
---
body`;

    const result = parseFrontmatter(raw);
    expect(result).toBeDefined();
    expect(result!.data.name).toBe("extra-fields");
    expect(result!.data.version).toBe("1.0");
    expect(result!.data.author).toBe("Test Author");
  });
});

describe("fallbackSanitization", () => {
  it("converts colon values to block scalars and leaves quoted values alone", () => {
    const input = `---
name: test
description: Has a colon: in value
---
body`;
    const sanitized = fallbackSanitization(input);
    expect(sanitized).toContain("description: |-");
    expect(sanitized).toContain("  Has a colon: in value");

    const quoted = `---
name: test
description: "Already: quoted"
---
body`;
    const sanitizedQuoted = fallbackSanitization(quoted);
    expect(sanitizedQuoted).toContain('"Already: quoted"');
  });
});

describe("extractFileRefs", () => {
  it("extracts @file references from skill content", () => {
    const content = `
Use @./scripts/build.sh to build the project.
Reference @src/config.ts for configuration.
Also check @../other/file.txt and @package.json.
`;

    const refs = extractFileRefs(content);
    expect(refs.length).toBeGreaterThanOrEqual(3);

    const paths = refs.map((m) => m[1]);
    expect(paths).toContain("./scripts/build.sh");
    expect(paths).toContain("src/config.ts");
    expect(paths).toContain("package.json");
  });
});

describe("extractShellRefs", () => {
  it("extracts !shell references from skill content", () => {
    const content = `
Run !\`npm install\` to install deps.
Then execute !\`./scripts/deploy.sh --env prod\` to deploy.
`;

    const refs = extractShellRefs(content);
    expect(refs).toHaveLength(2);
    expect(refs[0][1]).toBe("npm install");
    expect(refs[1][1]).toBe("./scripts/deploy.sh --env prod");
  });
});

describe("buildSkillToolDescription", () => {
  it("describes an empty skill catalog", () => {
    const desc = buildSkillToolDescription([]);
    expect(desc).toContain("No skills are currently available");
  });

  it("lists available skills with examples", () => {
    const skills = [
      {
        name: "test-skill",
        description: "A test skill",
        location: "/tmp/test/SKILL.md",
        content: "body",
      },
      {
        name: "deploy-skill",
        description: "Deploy automation",
        location: "/tmp/deploy/SKILL.md",
        content: "body",
      },
    ];

    const desc = buildSkillToolDescription(skills);
    expect(desc).toContain("<available_skills>");
    expect(desc).toContain("test-skill");
    expect(desc).toContain("deploy-skill");
    expect(desc).toContain("'test-skill'");
    expect(desc).toContain("(e.g.,");
  });
});
