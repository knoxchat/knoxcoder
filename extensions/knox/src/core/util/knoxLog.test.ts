import { afterEach, describe, expect, it, vi } from "vitest";

import { createKnoxLogger, getKnoxLogLevel } from "./knoxLog.js";

describe("knoxLog", () => {
  const prevLevel = process.env.KNOX_LOG_LEVEL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevBinary = process.env.IS_BINARY;

  afterEach(() => {
    if (prevLevel === undefined) delete process.env.KNOX_LOG_LEVEL;
    else process.env.KNOX_LOG_LEVEL = prevLevel;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevBinary === undefined) delete process.env.IS_BINARY;
    else process.env.IS_BINARY = prevBinary;
    vi.restoreAllMocks();
  });

  it("defaults to warn in production", () => {
    delete process.env.KNOX_LOG_LEVEL;
    process.env.NODE_ENV = "production";
    delete process.env.IS_BINARY;
    expect(getKnoxLogLevel()).toBe("warn");
  });

  it("defaults to warn when IS_BINARY", () => {
    delete process.env.KNOX_LOG_LEVEL;
    delete process.env.NODE_ENV;
    process.env.IS_BINARY = "true";
    expect(getKnoxLogLevel()).toBe("warn");
  });

  it("defaults to info in development", () => {
    delete process.env.KNOX_LOG_LEVEL;
    process.env.NODE_ENV = "development";
    delete process.env.IS_BINARY;
    expect(getKnoxLogLevel()).toBe("info");
  });

  it("respects KNOX_LOG_LEVEL override", () => {
    process.env.NODE_ENV = "production";
    process.env.KNOX_LOG_LEVEL = "debug";
    expect(getKnoxLogLevel()).toBe("debug");
  });

  it("suppresses info/debug below min level", () => {
    process.env.KNOX_LOG_LEVEL = "warn";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const log = createKnoxLogger("Test");
    log.debug("d");
    log.info("i");
    log.warn("w");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[Test] w");
  });
});
