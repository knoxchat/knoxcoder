import { describe, expect, it } from "vitest";

import { formatOops, looksLikeOops, parseOops } from "./parseOops";

const KERNEL_OOPS = [
  "BUG: kernel NULL pointer dereference, address: 0000000000000000",
  "Oops: 0000 [#1] SMP PTI",
  "CPU: 0 PID: 1 Comm: swapper Not tainted 6.8.0",
  "RIP: 0010:copy_to_user+0x10/0x20",
  "Code: 48 89 c7 48 89 f6",
  "RSP: 0018:ffffc90000003e80",
  "Call Trace:",
  " <TASK>",
  " do_fault+0x1c/0x40 mm/filemap.c:42",
  " handle_mm_fault+0x8/0x10",
  " ? some_unreliable+0x4/0x8",
  " </TASK>",
  "Kernel panic - not syncing: Fatal exception",
].join("\n");

describe("parseOops", () => {
  it("extracts RIP, tainted, and Call Trace file:line frames", () => {
    const parsed = parseOops(KERNEL_OOPS);
    expect(parsed?.kind).toBe("panic");
    expect(parsed?.rip).toMatch(/copy_to_user\+0x10\/0x20/);
    expect(parsed?.ripSymbol).toBe("copy_to_user");
    expect(parsed?.tainted).toMatch(/Not tainted/i);
    const files = parsed?.frames.map((frame) => frame.file).filter(Boolean);
    expect(files).toContain("mm/filemap.c");
    const fault = parsed?.frames.find((frame) => frame.symbol === "do_fault");
    expect(fault?.line).toBe(42);
    expect(fault?.offset).toBe("1c");
  });

  it("formats a compact model-facing summary", () => {
    const text = formatOops(KERNEL_OOPS);
    expect(text).toContain("Oops: panic");
    expect(text).toContain("RIP: copy_to_user+0x10/0x20");
    expect(text).toContain("do_fault+0x1c/0x40 mm/filemap.c:42");
    expect(text).toContain("Call trace:");
  });

  it("parses KASAN and UBSAN titles", () => {
    const kasan = parseOops(
      "BUG: KASAN: slab-out-of-bounds in foo+0x10/0x20\nCall Trace:\n foo+0x10/0x20 mm/slub.c:9\n",
    );
    expect(kasan?.kind).toBe("kasan");
    expect(kasan?.title).toMatch(/slab-out-of-bounds/);
    expect(kasan?.frames[0]?.symbol).toBe("foo");

    const ubsan = parseOops(
      "UBSAN: array-index-out-of-bounds in mm/filemap.c:42:5\n",
    );
    expect(ubsan?.kind).toBe("ubsan");
    expect(ubsan?.title).toMatch(/array-index-out-of-bounds/);
  });

  it("parses gcc AddressSanitizer frames", () => {
    const parsed = parseOops(
      [
        "==123==ERROR: AddressSanitizer: heap-use-after-free on address 0x1",
        "    #0 0x7f in foo /src/foo.c:10",
        "    #1 0x7e in main /src/main.c:4",
      ].join("\n"),
    );
    expect(parsed?.kind).toBe("asan");
    expect(parsed?.frames[0]).toMatchObject({
      symbol: "foo",
      file: "/src/foo.c",
      line: 10,
    });
  });

  it("parses QEMU guest faults", () => {
    const parsed = parseOops(
      "qemu-system-x86_64: Trying to execute code outside RAM or ROM at 0xdead\nGuest crashed\n",
    );
    expect(parsed?.kind).toBe("qemu_fault");
    expect(looksLikeOops(parsed!.rawExcerpt)).toBe(true);
  });

  it("returns undefined for compiler logs", () => {
    expect(
      parseOops("mm/filemap.c:42:5: error: implicit declaration of function 'bar'"),
    ).toBeUndefined();
    expect(looksLikeOops("  CC mm/filemap.o")).toBe(false);
  });
});
