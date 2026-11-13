// Tests for structured logger
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, setLogLevel, setJsonMode } from "../src/logger.js";

describe("Logger", () => {
  let infoSpy: any;
  let debugSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setLogLevel("debug");
    setJsonMode(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("info");
    setJsonMode(false);
  });

  it("logs at info level by default", () => {
    setLogLevel("info");
    log.info("hello");
    log.debug("should be suppressed");
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("includes metadata in text format", () => {
    log.info("test message", { key: "value", count: 42 });
    const output = infoSpy.mock.calls[0][0] as string;
    expect(output).toContain("INFO");
    expect(output).toContain("test message");
    expect(output).toContain('key="value"');
    expect(output).toContain("count=42");
  });

  it("outputs JSON when json mode is enabled", () => {
    setJsonMode(true);
    log.warn("json test", { code: 404 });
    const output = warnSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("json test");
    expect(parsed.code).toBe(404);
    expect(parsed.ts).toBeTruthy();
  });

  it("respects log level filtering", () => {
    setLogLevel("error");
    log.debug("no");
    log.info("no");
    log.warn("no");
    log.error("yes");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
