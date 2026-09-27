import { afterEach, describe, expect, it } from "vitest";

import { resetShellJobs } from "../shellJobs";
import { buildQemuCommand, qemuImpl } from "./qemu";
import type { IDE, ToolExtras } from "../..";
import { vi } from "vitest";

function extras(): ToolExtras {
  return {
    ide: {
      getWorkspaceDirs: vi.fn(async () => [`file://${process.cwd()}`]),
      getIdeInfo: vi.fn(async () => ({ remoteName: "local" })),
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_qemu" } } as ToolExtras["tool"],
  };
}

afterEach(() => {
  resetShellJobs();
});

describe("buildQemuCommand", () => {
  it("records kernel, initrd, serial stdio, and gdbstub -s -S", () => {
    expect(
      buildQemuCommand({
        kernel: "arch/x86/boot/bzImage",
        initrd: "initramfs.cpio",
        gdb: true,
        memory: "512M",
      }),
    ).toBe(
      "qemu-system-x86_64 -kernel 'arch/x86/boot/bzImage' -initrd 'initramfs.cpio' -m '512M' -serial stdio -display none -nographic -s -S",
    );
  });

  it("uses command= as a full override", () => {
    expect(buildQemuCommand({ command: "echo panic" })).toBe("echo panic");
  });

  it("puts the human monitor on stdio when monitor=true", () => {
    expect(
      buildQemuCommand(
        { kernel: "bzImage", monitor: true },
        { serialFile: "/tmp/serial.log", monitor: true },
      ),
    ).toContain("-monitor stdio");
    expect(
      buildQemuCommand(
        { kernel: "bzImage", monitor: true },
        { serialFile: "/tmp/serial.log", monitor: true },
      ),
    ).toContain("file:'/tmp/serial.log'");
    expect(
      buildQemuCommand({ kernel: "bzImage", monitor: true }, { monitor: true }),
    ).not.toContain("-serial stdio");
  });
});

describe("qemu session helper (HL-32)", () => {
  it("spawns a stub qemu that writes Kernel panic and parses RIP", async () => {
    const stub = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdout.write('Kernel panic - not syncing: Fatal exception\\nRIP: 0010:copy_to_user+0x10/0x20\\nCall Trace:\\n do_fault+0x1c/0x40 mm/filemap.c:42\\n');",
    )}`;
    const started = await qemuImpl({ action: "start", command: stub }, extras());
    expect(started[0].content).toContain("argv:");
    expect(started[0].content).toContain("Status: running");
    const jobMatch = started[0].content.match(/Job: (pty_\S+)/);
    expect(jobMatch?.[1]).toBeTruthy();
    const jobId = jobMatch![1];

    let statusContent = "";
    for (let i = 0; i < 8; i++) {
      const status = await qemuImpl(
        { action: "status", job_id: jobId, timeout_ms: 500 },
        extras(),
      );
      statusContent = status[0].content ?? "";
      if (statusContent.includes("copy_to_user") && statusContent.includes("Oops: panic")) {
        break;
      }
    }
    expect(statusContent).toMatch(/Kernel panic/);
    expect(statusContent).toContain("Oops: panic");
    expect(statusContent).toMatch(/RIP: copy_to_user\+0x10\/0x20/);
    expect(statusContent).toContain("mm/filemap.c:42");

    await qemuImpl({ action: "stop", job_id: jobId }, extras());
  });

  it("sends a monitor command and parses VM status", async () => {
    const stub = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdin.setEncoding('utf8'); process.stdout.write('(qemu) '); process.stdin.on('data', (d) => { if (String(d).includes('info status')) process.stdout.write('VM status: running\\n(qemu) '); });",
    )}`;
    const started = await qemuImpl({ action: "start", command: stub }, extras());
    const jobMatch = started[0].content.match(/Job: (pty_\S+)/);
    expect(jobMatch?.[1]).toBeTruthy();
    const jobId = jobMatch![1];

    let content = "";
    for (let i = 0; i < 8; i++) {
      const result = await qemuImpl(
        {
          action: "monitor",
          job_id: jobId,
          command: "info status",
          timeout_ms: 400,
        },
        extras(),
      );
      content = result[0].content ?? "";
      if (content.includes("VM status: running")) {
        break;
      }
    }
    expect(content).toMatch(/VM status:\s*running/);
    await qemuImpl({ action: "stop", job_id: jobId }, extras());
  });
});
