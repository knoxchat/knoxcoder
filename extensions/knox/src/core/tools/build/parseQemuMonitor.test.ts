import { describe, expect, it } from "vitest";

import {
  formatQemuMonitor,
  looksLikeQemuMonitor,
  parseQemuMonitor,
} from "./parseQemuMonitor";

const INFO_STATUS = `
QEMU 9.0.0 monitor - type 'help' for more information
(qemu) info status
VM status: running
(qemu)
`;

const INFO_REGISTERS = `
(qemu) info registers
RAX=0000000000000001 RBX=0000000000000000 RCX=ffffffff81001234
RIP=ffffffff8100abcd RSP=ffffc90000007e80 RBP=ffffc90000007ea0
(qemu)
`;

describe("parseQemuMonitor", () => {
  it("extracts VM status from info status", () => {
    const parsed = parseQemuMonitor(INFO_STATUS);
    expect(parsed?.prompt).toBe(true);
    expect(parsed?.vmStatus).toBe("running");
    expect(formatQemuMonitor(parsed!)).toContain("VM status: running");
  });

  it("extracts RIP from info registers", () => {
    const parsed = parseQemuMonitor(INFO_REGISTERS);
    expect(parsed?.rip).toMatch(/0x[0-9a-f]+/i);
    expect(parsed?.rip).toContain("8100abcd");
    expect(formatQemuMonitor(parsed!)).toMatch(/RIP:/);
    expect(looksLikeQemuMonitor(INFO_REGISTERS)).toBe(true);
  });

  it("returns null for guest serial without a monitor prompt", () => {
    expect(parseQemuMonitor("Booting Linux\n[    0.000000] CPU: 0")).toBeNull();
    expect(looksLikeQemuMonitor("hello")).toBe(false);
  });
});
