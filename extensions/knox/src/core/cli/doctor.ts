/**
 * `knox doctor` — non-interactive environment check for CI and first-run.
 * Never prints credentials.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

import { loadSession, sessionFromEnv } from "./credentials";
import { knoxCliVersion } from "./version";
import { detectSandboxBackend } from "../tools/sandbox";
import { resolveRipgrepBinary } from "../tools/ripgrep";

export type DoctorLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  level: DoctorLevel;
  detail: string;
}

export interface DoctorReport {
  version: string;
  platform: NodeJS.Platform;
  node: string;
  checks: DoctorCheck[];
  ok: boolean;
}

function which(bin: string): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function configPath(): string {
  const override = process.env.KNOX_GLOBAL_DIR?.trim();
  const root = override || path.join(os.homedir(), ".knoxcoder");
  return path.join(root, "config.yaml");
}

export function runDoctor(cwd = process.cwd()): DoctorReport {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node",
    level: nodeMajor >= 20 ? "ok" : "fail",
    detail: `Node ${process.versions.node}${nodeMajor >= 20 ? "" : " (need >= 20)"}`,
  });

  const envSession = sessionFromEnv();
  const fileSession = loadSession();
  if (envSession) {
    checks.push({
      id: "auth",
      level: "ok",
      detail: "KNOX_API_KEY is set (value not printed)",
    });
  } else if (fileSession) {
    checks.push({
      id: "auth",
      level: "ok",
      detail: "signed in via ~/.knoxcoder/auth.json",
    });
  } else {
    checks.push({
      id: "auth",
      level: "warn",
      detail: "not signed in; run knox login or set KNOX_API_KEY",
    });
  }

  const cfg = configPath();
  if (fs.existsSync(cfg)) {
    checks.push({ id: "config", level: "ok", detail: `config.yaml at ${cfg}` });
  } else {
    checks.push({
      id: "config",
      level: "warn",
      detail: `no config.yaml yet (${cfg}); editor/CLI will create defaults`,
    });
  }

  checks.push({
    id: "git",
    level: which("git") ? "ok" : "fail",
    detail: which("git") ? "git on PATH" : "git is not on PATH",
  });

  const gitDir = path.join(cwd, ".git");
  checks.push({
    id: "workspace",
    level: fs.existsSync(gitDir) ? "ok" : "warn",
    detail: fs.existsSync(gitDir)
      ? `git repo at ${cwd}`
      : `${cwd} is not a git repo (background agents need one)`,
  });

  try {
    require("sqlite3");
    checks.push({ id: "sqlite3", level: "ok", detail: "sqlite3 native module loads" });
  } catch (error) {
    checks.push({
      id: "sqlite3",
      level: "warn",
      detail: `sqlite3 did not load (${error instanceof Error ? error.message : error})`,
    });
  }

  const rg = resolveRipgrepBinary();
  checks.push({
    id: "ripgrep",
    level: rg ? "ok" : "warn",
    detail: rg ? `ripgrep at ${rg}` : "ripgrep not found (exact_search needs rg or @vscode/ripgrep)",
  });

  const backend = detectSandboxBackend();
  checks.push({
    id: "sandbox",
    level: backend === "unsupported" || backend === "missing" ? "warn" : "ok",
    detail:
      backend === "sandbox-exec"
        ? "macOS sandbox-exec available"
        : backend === "bwrap"
          ? "Linux bwrap available"
          : backend === "unsupported"
            ? "no OS sandbox on Windows"
            : "sandbox binary not installed (sandbox-exec or bwrap)",
  });

  const ok = !checks.some((c) => c.level === "fail");
  return {
    version: knoxCliVersion(),
    platform: process.platform,
    node: process.versions.node,
    checks,
    ok,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `knox ${report.version} (${report.platform}, node ${report.node})`,
    ...report.checks.map((c) => `  ${c.level.padEnd(4)} ${c.id}: ${c.detail}`),
    report.ok ? "ok" : "doctor found failures",
  ];
  return `${lines.join("\n")}\n`;
}
