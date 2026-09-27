import path from "node:path";

import { ToolImpl } from ".";
import { formatOops, parseOops } from "../build/parseOops";
import {
  formatQemuMonitor,
  parseQemuMonitor,
} from "../build/parseQemuMonitor";
import { getJobsLogDir } from "../shellJobs";
import { shellQuote } from "./git";
import { ptyReadImpl, ptySendImpl, ptyStartImpl } from "./pty";

const DEFAULT_ARCH = "x86_64";

function stringArg(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function actionOf(args: Record<string, unknown>): string {
  const raw = args.action ?? args.op;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function jobIdOf(args: Record<string, unknown>): string {
  return stringArg(args.job_id, args.jobId);
}

export function buildQemuCommand(
  args: Record<string, unknown>,
  opts?: { serialFile?: string; monitor?: boolean },
): string {
  const override = stringArg(args.command);
  if (override) {
    return override;
  }
  const kernel = stringArg(args.kernel);
  if (!kernel) {
    throw new Error("QEMU start needs kernel= (or command= to override the argv).");
  }
  const arch = stringArg(args.arch) || DEFAULT_ARCH;
  const binary = arch.startsWith("qemu-system-")
    ? arch
    : `qemu-system-${arch}`;
  const parts = [binary, "-kernel", shellQuote(kernel)];
  const initrd = stringArg(args.initrd);
  if (initrd) {
    parts.push("-initrd", shellQuote(initrd));
  }
  const machine = stringArg(args.machine);
  if (machine) {
    parts.push("-machine", shellQuote(machine));
  }
  const memory = stringArg(args.memory, args.m);
  if (memory) {
    parts.push("-m", shellQuote(memory));
  }
  const monitor =
    opts?.monitor === true ||
    args.monitor === true ||
    args.monitor === "true";
  if (monitor) {
    parts.push("-monitor", "stdio", "-display", "none", "-nographic");
    const serialFile = opts?.serialFile ?? stringArg(args.serial_file, args.serialFile);
    if (serialFile) {
      parts.push("-serial", `file:${shellQuote(serialFile)}`);
    }
  } else {
    parts.push("-serial", "stdio", "-display", "none", "-nographic");
  }
  if (args.gdb === true || args.gdb === "true") {
    parts.push("-s", "-S");
  }
  const extra = stringArg(args.extra_args, args.extraArgs);
  if (extra) {
    parts.push(extra);
  }
  return parts.join(" ");
}

function withOops(items: Awaited<ReturnType<ToolImpl>>): Awaited<ReturnType<ToolImpl>> {
  return items.map((item) => {
    const parsed = parseOops(item.content ?? "");
    const monitor = parseQemuMonitor(item.content ?? "");
    const prefixes: string[] = [];
    if (parsed) {
      prefixes.push(formatOops(parsed));
    }
    if (monitor) {
      prefixes.push(formatQemuMonitor(monitor));
    }
    if (!prefixes.length) {
      return item;
    }
    return {
      ...item,
      content: `${prefixes.join("\n\n")}\n\n${item.content}`,
    };
  });
}

function wantsMonitor(args: Record<string, unknown>): boolean {
  return args.monitor === true || args.monitor === "true";
}

export const qemuImpl: ToolImpl = async (args, extras) => {
  const action = actionOf(args ?? {});
  if (!action) {
    throw new Error("Missing or invalid required parameter: action");
  }

  if (action === "start") {
    let serialFile: string | undefined;
    if (wantsMonitor(args ?? {})) {
      serialFile = path.join(getJobsLogDir(), `qemu-serial-${Date.now()}.log`);
    }
    const command = buildQemuCommand(args ?? {}, {
      monitor: wantsMonitor(args ?? {}),
      serialFile,
    });
    const started = await ptyStartImpl(
      {
        command,
        working_directory: args.working_directory ?? args.cwd,
      },
      extras,
    );
    const extra = [
      `argv: ${command}`,
      serialFile ? `serial file: ${serialFile}` : "",
      wantsMonitor(args ?? {})
        ? "monitor: stdio (use action=monitor or builtin_pty_send)"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return started.map((item) => ({
      ...item,
      name: "QEMU",
      content: [extra, item.content ?? ""].join("\n\n"),
    }));
  }

  const jobId = jobIdOf(args ?? {});
  if (!jobId) {
    return [
      {
        name: "QEMU",
        description: "missing job_id",
        content:
          "stop/status/monitor need job_id from builtin_qemu start (or the Job: line from builtin_pty_start).",
      },
    ];
  }

  if (action === "stop") {
    const stopped = await ptyReadImpl({ job_id: jobId, kill: true }, extras);
    return withOops(
      stopped.map((item) => ({
        ...item,
        name: "QEMU",
      })),
    );
  }

  if (action === "monitor") {
    const command = stringArg(args.command, args.monitor_command, args.input);
    if (!command) {
      return [
        {
          name: "QEMU",
          description: "missing monitor command",
          content:
            "monitor needs command= (e.g. info status, info registers, x/i $pc, system_reset).",
        },
      ];
    }
    const payload = command.endsWith("\n") ? command : `${command}\n`;
    await ptySendImpl({ job_id: jobId, data: payload }, extras);
    const read = await ptyReadImpl(
      {
        job_id: jobId,
        timeout_ms: args.timeout_ms ?? args.timeout ?? 3_000,
        since_byte: args.since_byte ?? args.sinceByte,
      },
      extras,
    );
    return withOops(
      read.map((item) => ({
        ...item,
        name: "QEMU",
      })),
    );
  }

  if (action === "status" || action === "read") {
    const read = await ptyReadImpl(
      {
        job_id: jobId,
        timeout_ms: args.timeout_ms ?? args.timeout ?? 5_000,
        since_byte: args.since_byte ?? args.sinceByte,
      },
      extras,
    );
    return withOops(
      read.map((item) => ({
        ...item,
        name: "QEMU",
      })),
    );
  }

  return [
    {
      name: "QEMU",
      description: "unknown action",
      content: `Unknown action "${action}". Use start, stop, status, or monitor.`,
    },
  ];
};
