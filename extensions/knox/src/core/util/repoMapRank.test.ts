import { describe, expect, it } from "vitest";

import {
  directoryCounts,
  formatDirectoryMap,
  rankRepoMapFiles,
  scoreRepoMapPath,
} from "./repoMapRank.js";

describe("scoreRepoMapPath", () => {
  it("ranks MAINTAINERS / Makefile / Kconfig above random C", () => {
    expect(scoreRepoMapPath("MAINTAINERS")).toBeGreaterThan(
      scoreRepoMapPath("drivers/gpu/foo.c"),
    );
    expect(scoreRepoMapPath("Makefile")).toBeGreaterThan(
      scoreRepoMapPath("drivers/gpu/foo.c"),
    );
    expect(scoreRepoMapPath("mm/Kconfig")).toBeGreaterThan(
      scoreRepoMapPath("drivers/gpu/foo.c"),
    );
  });

  it("boosts query and git-touched files", () => {
    expect(
      scoreRepoMapPath("mm/filemap.c", { query: "mm" }),
    ).toBeGreaterThan(scoreRepoMapPath("mm/filemap.c"));
    expect(
      scoreRepoMapPath("kernel/exit.c", { gitTouched: true }),
    ).toBeGreaterThan(scoreRepoMapPath("kernel/exit.c"));
  });

  it("penalizes generated objects", () => {
    expect(scoreRepoMapPath("mm/filemap.c")).toBeGreaterThan(
      scoreRepoMapPath("mm/filemap.o"),
    );
  });
});

describe("rankRepoMapFiles / directoryCounts", () => {
  const files = [
    "drivers/gpu/foo.c",
    "drivers/gpu/bar.c",
    "mm/filemap.c",
    "Makefile",
    "Kconfig",
    "MAINTAINERS",
    "arch/x86/entry.S",
  ];

  it("puts kernel metadata files first", () => {
    const ranked = rankRepoMapFiles(files);
    expect(ranked.slice(0, 3).map((item) => item.path)).toEqual([
      "MAINTAINERS",
      "Kconfig",
      "Makefile",
    ]);
  });

  it("counts top-level subsystems", () => {
    const counts = directoryCounts(files, 1);
    const map = Object.fromEntries(counts.map((c) => [c.dir, c.count]));
    expect(map["drivers/"]).toBe(2);
    expect(map["mm/"]).toBe(1);
    expect(map["arch/"]).toBe(1);
    expect(formatDirectoryMap(counts, files.length)).toContain("## Subsystems");
    expect(formatDirectoryMap(counts, files.length)).toContain("drivers/");
  });
});
