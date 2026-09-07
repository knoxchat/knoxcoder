import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const qemuTool: Tool = {
  type: "function",
  displayTitle: t("qemu"),
  wouldLikeTo: t("wouldLikeToQemu"),
  isCurrently: t("isRunningQemu"),
  hasAlready: t("hasRunQemu"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Qemu,
    description: `Start or stop a QEMU session with a recorded argv (kernel, initrd, optional gdbstub -s -S, serial on stdio). Serial is the job log. After start, drive the guest with builtin_pty_send / builtin_pty_read, or action=monitor for the human monitor (info status / info registers). Stop kills the process group.

Prefer this over inventing qemu-system-* flags. Do not embed a kernel/QEMU binary — the command must already be on PATH (or pass command= to run a stub). Set monitor=true on start to put the QEMU monitor on stdio and serial in a job file.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "status", "monitor"],
          description:
            "start records argv and launches via PTY; stop kills the job; status/read waits for serial; monitor sends a human-monitor command (info status, info registers).",
        },
        kernel: {
          type: "string",
          description: "Kernel image path (-kernel). Required for start unless command is set.",
        },
        initrd: {
          type: "string",
          description: "Optional initrd (-initrd).",
        },
        arch: {
          type: "string",
          description: "qemu-system-<arch> (default x86_64).",
        },
        machine: {
          type: "string",
          description: "Optional -machine.",
        },
        memory: {
          type: "string",
          description: "Optional -m (e.g. 512M).",
        },
        gdb: {
          type: "boolean",
          description: "If true, add -s -S (gdbstub, wait for gdb).",
        },
        monitor: {
          type: "boolean",
          description:
            "If true on start, use -monitor stdio and write guest serial to a file under the jobs log dir. For action=monitor this is ignored.",
        },
        extra_args: {
          type: "string",
          description: "Extra qemu argv appended after the recipe.",
        },
        command: {
          type: "string",
          description:
            "Start: override the entire qemu argv (tests / custom qemu-system-* lines). Monitor: the human-monitor command (info status, info registers, x/i $pc).",
        },
        job_id: {
          type: "string",
          description: "Job id from start (required for stop/status).",
        },
        timeout_ms: {
          type: "number",
          description: "For status: how long to wait for serial (default 5000).",
        },
        working_directory: {
          type: "string",
          description: "Cwd for start.",
        },
      },
    },
  },
};
