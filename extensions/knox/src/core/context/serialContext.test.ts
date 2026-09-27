import { describe, expect, it } from "vitest";

import {
  formatSerialContext,
  isSerialJob,
  tailLines,
  type SerialJobView,
} from "./serialContext";

function job(
  partial: Partial<SerialJobView> & Pick<SerialJobView, "id" | "command">,
): SerialJobView {
  return {
    status: "running",
    stdout: "",
    stderr: "",
    ...partial,
  };
}

describe("serial context (HL-45)", () => {
  it("tails QEMU job logs and parses oops", () => {
    expect(isSerialJob(job({ id: "1", command: "make -j8" }))).toBe(false);
    const qemu = job({
      id: "pty_1",
      command: "qemu-system-x86_64 -kernel bzImage -serial stdio",
      stdin: true,
      stdout: [
        "Booting...",
        "Kernel panic - not syncing: Fatal exception",
        "RIP: 0010:copy_to_user+0x10/0x20",
        "Call Trace:",
        " do_fault+0x1c/0x40 mm/filemap.c:42",
      ].join("\n"),
    });
    expect(isSerialJob(qemu)).toBe(true);
    const text = formatSerialContext([qemu]);
    expect(text).toContain("Serial / dmesg");
    expect(text).toContain("copy_to_user");
    expect(text).toContain("mm/filemap.c:42");
  });

  it("keeps only the last N lines", () => {
    expect(tailLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });
});
