// Tests for FR-01.3 - spec fetch from URL
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

describe("fetchSpec", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  it("rejects non-HTTP URLs", async () => {
    const { fetchSpec } = await import("../src/changefeed/fetch.js");
    await expect(fetchSpec("ftp://example.com/spec.json")).rejects.toThrow("must be http:// or https://");
  });

  it("rejects non-JSON responses", async () => {
    const { fetchSpec } = await import("../src/changefeed/fetch.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "text/html"]]),
      text: async () => "<html>Not JSON</html>",
    }));
    tmpDir = await mkdtemp(join(tmpdir(), "evergreen-fetch-"));
    await expect(fetchSpec("https://example.com/spec.json", tmpDir)).rejects.toThrow("not valid JSON");
  });

  it("rejects HTTP error responses", async () => {
    const { fetchSpec } = await import("../src/changefeed/fetch.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));
    await expect(fetchSpec("https://example.com/spec.json")).rejects.toThrow("404");
  });
});
