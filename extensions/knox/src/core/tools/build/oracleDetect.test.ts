import { describe, expect, it } from "vitest";

import { detectOracleCommand, oracleResultLine } from "./oracleDetect";

describe("detectOracleCommand (K-034)", () => {
  it("Node: typecheck script, then tsconfig, then lint", () => {
    expect(detectOracleCommand({ entries: ["package.json", "tsconfig.json"], packageJson: '{"scripts":{"typecheck":"tsc"}}' })?.command).toBe("npm run typecheck");
    expect(detectOracleCommand({ entries: ["package.json", "tsconfig.json"], packageJson: "{}" })?.command).toBe("npx tsc --noEmit");
    expect(detectOracleCommand({ entries: ["package.json"], packageJson: '{"scripts":{"lint":"eslint ."}}' })?.command).toBe("npm run lint");
    expect(detectOracleCommand({ entries: ["package.json"], packageJson: "not json" })).toBeUndefined();
  });

  it("Python: pytest, ruff, or compileall", () => {
    expect(detectOracleCommand({ entries: ["pyproject.toml", "tests"] })?.command).toBe("python -m pytest -x -q");
    expect(detectOracleCommand({ entries: ["pyproject.toml"], pyproject: "[tool.ruff]\nline-length=100" })?.command).toBe("ruff check .");
    expect(detectOracleCommand({ entries: ["setup.py"] })?.command).toBe("python -m compileall -q .");
  });

  it("Go and Rust", () => {
    expect(detectOracleCommand({ entries: ["go.mod", "main.go"] })?.command).toBe("go vet ./...");
    expect(detectOracleCommand({ entries: ["Cargo.toml"] })?.ecosystem).toBe("rust");
  });

  it("Maven, Gradle, Zig and .NET", () => {
    expect(detectOracleCommand({ entries: ["pom.xml"] })?.command).toBe("mvn -q -DskipTests compile");
    expect(detectOracleCommand({ entries: ["build.gradle", "gradlew"] })?.command).toBe("./gradlew -q classes");
    expect(detectOracleCommand({ entries: ["build.gradle.kts"] })?.command).toBe("gradle -q classes");
    expect(detectOracleCommand({ entries: ["build.zig"] })?.command).toBe("zig build");
    expect(detectOracleCommand({ entries: ["App.csproj"] })?.command).toBe("dotnet build --nologo -v q");
  });

  it("returns nothing for unknown projects", () => {
    expect(detectOracleCommand({ entries: ["README.md"] })).toBeUndefined();
  });

  it("formats one structured result line", () => {
    expect(oracleResultLine("go vet ./...", 0)).toBe("oracle: go vet ./... -> pass (exit 0)");
    expect(oracleResultLine("pytest", 1)).toBe("oracle: pytest -> fail (exit 1)");
    expect(oracleResultLine("x", null)).toBe("oracle: x -> fail");
  });
});
