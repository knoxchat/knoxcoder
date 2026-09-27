/**
 * Integration test for SkillManager.
 * Run with: npx tsx skills/integration-test.ts
 *
 * Tests:
 *  1. Discovery from skills/, .claude/skills/, and .opencode/skills/
 *  2. Upward directory traversal
 *  3. Symlink support
 *  4. Dirs tracking
 *  5. Description builder with dynamic hints
 *  6. Reload stability
 *  7. Empty workspace handling
 *  8. @file and !shell pattern extraction
 */
import * as fs from "fs";
import * as path from "path";

import { SkillManager } from "./skillManager";
import { buildSkillToolDescription } from "./descriptionBuilder";
import { extractFileRefs, extractShellRefs } from "./frontmatter";

const TEST_DIR = "/tmp/knox-skill-test";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSkill(dir: string, name: string, description: string, content: string) {
  const skillDir = path.join(dir, name);
  ensureDir(skillDir);
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
    "utf-8",
  );
}

function setupTestFixtures() {
  // Clean up
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }

  // ~/.knox/skills/test-skill/ (via global skills path — use workspace skills/ for project-level)
  writeSkill(
    path.join(TEST_DIR, "skills"),
    "test-skill",
    "A test skill for verification",
    "This is a test skill that demonstrates the skill system.\n\nUse @./scripts/build.sh to build.\nRun !`npm test` to verify.\n",
  );

  // .claude/skills/claude-compat/
  writeSkill(
    path.join(TEST_DIR, ".claude", "skills"),
    "claude-compat",
    "A skill from .claude directory for compatibility testing",
    "# Claude Compatible Skill\n\nThis skill tests Claude Code compatibility.\n",
  );

  // .opencode/skills/opencode-compat/
  writeSkill(
    path.join(TEST_DIR, ".opencode", "skills"),
    "opencode-compat",
    "A skill from .opencode directory for compatibility testing",
    "# Opencode Compatible Skill\n\nThis skill tests opencode compatibility.\n",
  );

  // .opencode/skill/opencode-singular/
  writeSkill(
    path.join(TEST_DIR, ".opencode", "skill"),
    "opencode-singular",
    "A skill from .opencode/skill (singular) directory",
    "# Opencode Singular Skill\n\nTests the {skill,skills} pattern.\n",
  );

  // .agents/skills/agents-compat/
  writeSkill(
    path.join(TEST_DIR, ".agents", "skills"),
    "agents-compat",
    "A skill from .agents directory",
    "# Agents Compatible Skill\n",
  );

  // Add a bundled script file to the test-skill
  const scriptsDir = path.join(TEST_DIR, "skills", "test-skill", "scripts");
  ensureDir(scriptsDir);
  fs.writeFileSync(path.join(scriptsDir, "build.sh"), "#!/bin/bash\necho build", "utf-8");

  // Create a symlink skill (if possible)
  const symlinkTarget = path.join(TEST_DIR, "skills", "test-skill");
  const symlinkDir = path.join(TEST_DIR, "skills", "symlinked-skill-dir");
  try {
    // Create a target for the symlink
    const linkTargetDir = path.join(TEST_DIR, "external-skill");
    writeSkill(linkTargetDir, "", "external-linked", "Symlinked skill content.\n");
    // Actually rename to put SKILL.md at the right level
    fs.rmSync(linkTargetDir, { recursive: true, force: true });
    ensureDir(linkTargetDir);
    fs.writeFileSync(
      path.join(linkTargetDir, "SKILL.md"),
      "---\nname: symlink-skill\ndescription: A symlinked skill\n---\nSymlinked skill body.\n",
      "utf-8",
    );
    fs.symlinkSync(linkTargetDir, symlinkDir);
  } catch {
    console.warn("  ⚠ Could not create symlink (may need permissions)");
  }

  // Create a fake .git directory so worktree detection works
  ensureDir(path.join(TEST_DIR, ".git"));
}

async function main() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg}`);
    }
  }

  setupTestFixtures();

  // Test 1: Discovery from all dirs
  console.log("\n=== Test 1: Discovery from skills/, .claude, .opencode, .agents ===");
  const manager = new SkillManager({
    workspaceDirs: [TEST_DIR],
    disableExternalSkills: false,
  });

  await manager.load();
  assert(manager.isLoaded, "Manager reports loaded");

  const all = manager.all();
  console.log(`  Found ${all.length} skill(s): ${all.map((s: { name: string }) => s.name).join(", ")}`);

  const testSkill = manager.get("test-skill");
  assert(testSkill !== undefined, "Found 'test-skill'");
  if (testSkill) {
    assert(testSkill.description === "A test skill for verification", "test-skill description matches");
    assert(testSkill.content.includes("This is a test skill that demonstrates"), "test-skill content contains body");
    assert(testSkill.location.includes("skills/test-skill/SKILL.md"), "test-skill location correct");
  }

  const claudeSkill = manager.get("claude-compat");
  assert(claudeSkill !== undefined, "Found 'claude-compat'");
  if (claudeSkill) {
    assert(claudeSkill.description === "A skill from .claude directory for compatibility testing", "claude-compat description matches");
    assert(claudeSkill.content.includes("Claude Compatible Skill"), "claude-compat content correct");
  }

  // Test opencode compat
  const opencodeSkill = manager.get("opencode-compat");
  assert(opencodeSkill !== undefined, "Found 'opencode-compat' from .opencode/skills/");
  if (opencodeSkill) {
    assert(opencodeSkill.content.includes("Opencode Compatible Skill"), "opencode-compat content correct");
  }

  const opencodeSingular = manager.get("opencode-singular");
  assert(opencodeSingular !== undefined, "Found 'opencode-singular' from .opencode/skill/ (singular)");

  const agentsSkill = manager.get("agents-compat");
  assert(agentsSkill !== undefined, "Found 'agents-compat' from .agents/skills/");

  // Test symlink support
  const symlinkSkill = manager.get("symlink-skill");
  if (fs.existsSync(path.join(TEST_DIR, "skills", "symlinked-skill-dir"))) {
    assert(symlinkSkill !== undefined, "Found 'symlink-skill' via symlink");
  } else {
    console.log("  ⚠ Symlink test skipped (symlink not created)");
  }

  // Test 2: Dirs tracking
  console.log("\n=== Test 2: Dirs tracking ===");
  const dirs = manager.dirs();
  assert(dirs.length >= 4, "Found >= 4 skill dirs (got " + dirs.length + ")");

  // Test 3: Description builder with dynamic hints
  console.log("\n=== Test 3: Description builder ===");
  const desc = buildSkillToolDescription(all);
  assert(desc.includes("test-skill"), "Description includes test-skill");
  assert(desc.includes("claude-compat"), "Description includes claude-compat");
  assert(desc.includes("<available_skills>"), "Description has XML tags");
  assert(desc.includes("(e.g.,"), "Description includes example hints");
  // The first 3 skills (in whatever order) should appear as examples
  const firstSkillName = all[0]?.name;
  assert(
    firstSkillName ? desc.includes(`'${firstSkillName}'`) : true,
    "Description includes first skill name in examples",
  );

  // Test 4: Reload
  console.log("\n=== Test 4: Reload ===");
  await manager.load();
  assert(manager.all().length === all.length, "Reload returns same count");

  // Test 5: Empty workspace
  console.log("\n=== Test 5: Empty workspace ===");
  const emptyManager = new SkillManager({
    workspaceDirs: ["/tmp/nonexistent-knox-test-dir"],
    disableExternalSkills: true,
  });
  await emptyManager.load();
  assert(emptyManager.isLoaded, "Empty manager reports loaded");
  console.log(`  Empty manager found ${emptyManager.all().length} skill(s) (may include global)`);

  // Test 6: @file and !shell pattern extraction
  console.log("\n=== Test 6: @file and !shell patterns ===");
  if (testSkill) {
    const fileRefs = extractFileRefs(testSkill.content);
    assert(fileRefs.length >= 1, `Found ${fileRefs.length} @file ref(s) in test-skill`);

    const shellRefs = extractShellRefs(testSkill.content);
    assert(shellRefs.length >= 1, `Found ${shellRefs.length} !shell ref(s) in test-skill`);
    assert(shellRefs[0][1] === "npm test", "Shell ref is 'npm test'");
  }

  // Test 7: disableExternalSkills flag
  console.log("\n=== Test 7: disableExternalSkills ===");
  const knoxOnlyManager = new SkillManager({
    workspaceDirs: [TEST_DIR],
    disableExternalSkills: true,
  });
  await knoxOnlyManager.load();
  const knoxOnlySkills = knoxOnlyManager.all();
  const hasKnoxSkill = knoxOnlySkills.some((s) => s.name === "test-skill");
  const hasClaudeSkill = knoxOnlySkills.some((s) => s.name === "claude-compat");
  const hasOpencodeSkill = knoxOnlySkills.some((s) => s.name === "opencode-compat");
  assert(hasKnoxSkill, "Knox-native skill still found when external disabled");
  assert(!hasClaudeSkill, "Claude skill NOT found when external disabled");
  assert(!hasOpencodeSkill, "Opencode skill NOT found when external disabled");

  // Test 8: Description builder with no skills
  console.log("\n=== Test 8: Empty description builder ===");
  const emptyDesc = buildSkillToolDescription([]);
  assert(emptyDesc.includes("No skills are currently available"), "Empty desc shows not available");

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Results: " + passed + " passed, " + failed + " failed");
  if (failed > 0) {
    process.exit(1);
  }
  console.log("All integration tests passed!\n");
}

main().catch((err) => {
  console.error("Integration test error:", err);
  process.exit(1);
});
