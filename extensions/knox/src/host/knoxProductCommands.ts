/**
 * Command-palette entry points for 2.0 product gaps (P1-3, P1-7):
 * team bundles, custom agents, hook test, Memory Brain export/wipe,
 * background agents, and the grouped Knox settings filter.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { exportTeamBundle, importTeamBundle, parseTeamBundle } from "core/config/teamBundle";
import {
  loadCustomAgents,
  parseCustomAgent,
} from "core/tools/subagent/customAgents";
import {
  bgRoot,
  discardJob,
  formatJobLine,
  listJobs,
  loadJob,
  mergeJob,
} from "core/cli/background";
import { HOOK_EVENTS, type HookEvent } from "core/hooks/hooks";
import { getWorkspaceHookRunner } from "core/hooks/workspaceHooks";
import { BrainManager } from "core/context/memory/brain/BrainManager";

import { VsCodeIde } from "./VsCodeIde";

const AGENT_TEMPLATE = `---
name: reviewer
description: Reviews diffs for risk
readonly: true
tools: [builtin_read_file, builtin_exact_search]
---
You review code changes. Be concise. Flag bugs, security issues, and missing tests.
`;

function workspaceDir(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

export function registerKnoxProductCommands(
  context: vscode.ExtensionContext,
  ide: VsCodeIde,
): void {
  const register = (id: string, fn: () => Promise<void>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => fn().catch((error) => {
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      })),
    );
  };

  register("knox.openSettings", async () => {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@id:knoxchat",
    );
  });

  register("knox.team.export", async () => {
    const dir = workspaceDir();
    if (!dir) {
      throw new Error("Open a folder first");
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(dir, "knox-team-bundle.json")),
      filters: { JSON: ["json"] },
    });
    if (!uri) {
      return;
    }
    const { bundle, skipped } = exportTeamBundle(dir);
    fs.writeFileSync(uri.fsPath, `${JSON.stringify(bundle, null, 2)}\n`);
    const skip = skipped.length ? ` (${skipped.length} skipped)` : "";
    void vscode.window.showInformationMessage(
      `Exported ${bundle.files.length} files${skip}`,
    );
  });

  register("knox.team.import", async () => {
    const dir = workspaceDir();
    if (!dir) {
      throw new Error("Open a folder first");
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
    });
    if (!picked?.[0]) {
      return;
    }
    const parsed = parseTeamBundle(fs.readFileSync(picked[0].fsPath, "utf-8"));
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    const dry = await vscode.window.showQuickPick(
      [
        { label: "Dry run (preview only)", id: "dry" },
        { label: "Import (keep existing files)", id: "import" },
        { label: "Import and overwrite", id: "force" },
      ],
      { placeHolder: "Team bundle import" },
    );
    if (!dry) {
      return;
    }
    const hasHooks = parsed.files.some((f) => /hooks/i.test(f.path));
    let allowHooks = false;
    if (hasHooks && dry.id !== "dry") {
      const choice = await vscode.window.showWarningMessage(
        "This bundle includes hooks that can run shell commands from the repo. Allow hooks?",
        { modal: true },
        "Allow hooks",
        "Skip hooks",
      );
      allowHooks = choice === "Allow hooks";
    }
    const res = importTeamBundle(parsed, dir, {
      overwrite: dry.id === "force",
      allowHooks,
      dryRun: dry.id === "dry",
    });
    const prefix = dry.id === "dry" ? "Would write" : "Wrote";
    void vscode.window.showInformationMessage(
      `${prefix} ${res.written.length} files (${res.skipped.length} skipped)`,
    );
  });

  register("knox.agents.list", async () => {
    const agents = await loadCustomAgents(ide);
    if (!agents.length) {
      void vscode.window.showInformationMessage(
        "No custom agents in .knox/agents. Use Knox: Create Custom Agent.",
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      agents.map((a) => ({
        label: a.name,
        description: a.readonly ? "readonly" : "",
        detail: a.description || a.source,
      })),
    );
    if (pick) {
      const dir = workspaceDir();
      if (dir) {
        const file = path.join(dir, ".knox", "agents", `${pick.label}.md`);
        if (fs.existsSync(file)) {
          await vscode.window.showTextDocument(vscode.Uri.file(file));
        }
      }
    }
  });

  register("knox.agents.create", async () => {
    const dir = workspaceDir();
    if (!dir) {
      throw new Error("Open a folder first");
    }
    const name = await vscode.window.showInputBox({
      prompt: "Agent name (letters, numbers, _-)",
      value: "reviewer",
      validateInput: (v) =>
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(v.trim())
          ? undefined
          : "Use a short identifier",
    });
    if (!name) {
      return;
    }
    const agentsDir = path.join(dir, ".knox", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const file = path.join(agentsDir, `${name.trim()}.md`);
    if (fs.existsSync(file)) {
      throw new Error(`${file} already exists`);
    }
    const body = AGENT_TEMPLATE.replace("name: reviewer", `name: ${name.trim()}`);
    const parsed = parseCustomAgent(body, path.basename(file));
    if (!parsed) {
      throw new Error("Template did not parse");
    }
    fs.writeFileSync(file, body);
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  });

  register("knox.hooks.test", async () => {
    const dir = workspaceDir();
    if (!dir) {
      throw new Error("Open a folder first");
    }
    const runner = await getWorkspaceHookRunner(ide, () => undefined);
    if (!runner) {
      throw new Error("No hooks configured (.knox/hooks.json)");
    }
    const events = HOOK_EVENTS.filter((e) => runner.has(e));
    if (!events.length) {
      throw new Error("Hooks file has no events");
    }
    const event = (await vscode.window.showQuickPick(events, {
      placeHolder: "Hook event to test",
    })) as HookEvent | undefined;
    if (!event) {
      return;
    }
    const outcome = await runner.run(event, {
      toolName: "builtin_read_file",
      args: { filepath: "README.md" },
      prompt: "hook test",
    });
    const detail = outcome.denied
      ? `denied: ${outcome.denied.reason}`
      : outcome.additionalContext.length
        ? outcome.additionalContext.join("\n")
        : "ok";
    void vscode.window.showInformationMessage(`Hook ${event}: ${detail}`);
  });

  register("knox.memoryBrain.export", async () => {
    const result = await BrainManager.exportMemories();
    void vscode.window.showInformationMessage(result);
  });

  register("knox.memoryBrain.wipe", async () => {
    const choice = await vscode.window.showWarningMessage(
      "Wipe Memory Brain? A backup copy is kept under ~/.knoxcoder/memory/backups.",
      { modal: true },
      "Wipe",
    );
    if (choice !== "Wipe") {
      return;
    }
    const { BrainStore } = await import("core/context/memory/brain/BrainStore");
    const out = await BrainStore.wipeAll();
    void vscode.window.showInformationMessage(
      out.backup ? `Memory Brain wiped. Backup: ${out.backup}` : "Memory Brain wiped.",
    );
  });

  register("knox.bg.list", async () => {
    const jobs = listJobs(bgRoot());
    if (!jobs.length) {
      void vscode.window.showInformationMessage("No background agents.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      jobs.map((j) => ({
        label: j.id,
        description: j.status,
        detail: formatJobLine(j),
      })),
    );
    if (pick) {
      const job = loadJob(bgRoot(), pick.label);
      if (job) {
        void vscode.window.showInformationMessage(
          `${job.id} ${job.status}: ${job.task.slice(0, 120)}`,
        );
      }
    }
  });

  register("knox.bg.merge", async () => {
    const jobs = listJobs(bgRoot()).filter((j) => j.status === "done");
    const pick = await vscode.window.showQuickPick(
      jobs.map((j) => ({ label: j.id, description: j.task.slice(0, 80) })),
      { placeHolder: "Merge which background agent?" },
    );
    if (!pick) {
      return;
    }
    const out = mergeJob(bgRoot(), pick.label);
    void vscode.window.showInformationMessage(out.message);
  });

  register("knox.bg.discard", async () => {
    const jobs = listJobs(bgRoot());
    const pick = await vscode.window.showQuickPick(
      jobs.map((j) => ({ label: j.id, description: j.status })),
      { placeHolder: "Discard which background agent?" },
    );
    if (!pick) {
      return;
    }
    const out = discardJob(bgRoot(), pick.label);
    void vscode.window.showInformationMessage(out.message);
  });
}
