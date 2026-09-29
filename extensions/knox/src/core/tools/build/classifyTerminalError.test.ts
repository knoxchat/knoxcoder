import { describe, expect, it } from "vitest";

import {
  classifyTerminalOutput,
  shouldOfferPackageInstall,
} from "./classifyTerminalError";

describe("classifyTerminalOutput", () => {
  it("classifies gcc file:line error as build", () => {
    const errors = classifyTerminalOutput(
      "mm/file.c:12:3: error: implicit declaration of function 'foo'",
    );
    expect(errors[0]?.category).toBe("build");
    expect(errors[0]?.suggestedAction).toContain("compiler");
  });

  it("classifies Kernel panic as runtime", () => {
    const errors = classifyTerminalOutput(
      "Kernel panic - not syncing: Fatal exception",
    );
    expect(errors[0]?.category).toBe("runtime");
    expect(errors[0]?.matchedText).toContain("Kernel panic");
  });

  it("classifies undefined reference and qemu-system as build/runtime", () => {
    expect(
      classifyTerminalOutput("undefined reference to `bar'")[0]?.category,
    ).toBe("build");
    expect(
      classifyTerminalOutput("qemu-system-x86_64: error: kernel too old")[0]
        ?.category,
    ).toBe("runtime");
  });

  it("classifies kselftest / ninja FAILED as build", () => {
    expect(classifyTerminalOutput("FAILED: foo.o")[0]?.category).toBe("build");
  });
});

describe("shouldOfferPackageInstall", () => {
  it("does not suggest npm install for a kernel make log", () => {
    expect(
      shouldOfferPackageInstall(
        "dependency",
        "make -j8",
        "Cannot find module 'foo'",
      ),
    ).toBe(false);
  });

  it("still suggests install for a Node test run", () => {
    expect(
      shouldOfferPackageInstall(
        "dependency",
        "npm test",
        "Cannot find module 'foo'",
      ),
    ).toBe(true);
  });
});
