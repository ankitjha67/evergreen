// Tests for spec registry index (FR-01.3 P1)
import { describe, it, expect, vi } from "vitest";
import { fetchRegistryIndex } from "../src/changefeed/registry-index.js";

describe("Registry Index", () => {
  it("rejects non-HTTP URLs", async () => {
    await expect(fetchRegistryIndex("ftp://bad.url/index.json")).rejects.toThrow("must be http:// or https://");
  });

  it("rejects invalid index format", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2", specs: [] }),
    }));

    await expect(fetchRegistryIndex("https://example.com/index.json")).rejects.toThrow("Invalid registry index format");

    vi.unstubAllGlobals();
  });

  it("rejects index entries missing required fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1", registry: "test", specs: [{ vendor: "stripe" }] }),
    }));

    await expect(fetchRegistryIndex("https://example.com/index.json")).rejects.toThrow("missing required fields");

    vi.unstubAllGlobals();
  });

  it("parses valid index correctly", async () => {
    const mockIndex = {
      version: "1",
      registry: "evergreen-public",
      specs: [
        { ref: "stripe@stripe-ruby@2025-03-31.basil", url: "https://registry.example.com/stripe-ruby.json", vendor: "stripe", api: "stripe-ruby", version: "2025-03-31.basil", languages: ["ruby"] },
        { ref: "stripe@stripe-go@2025-03-31.basil", url: "https://registry.example.com/stripe-go.json", vendor: "stripe", api: "stripe-go", version: "2025-03-31.basil", languages: ["go"] },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockIndex,
    }));

    const index = await fetchRegistryIndex("https://registry.example.com/index.json");
    expect(index.version).toBe("1");
    expect(index.specs).toHaveLength(2);
    expect(index.specs[0].vendor).toBe("stripe");

    vi.unstubAllGlobals();
  });

  it("handles HTTP errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    await expect(fetchRegistryIndex("https://example.com/missing.json")).rejects.toThrow("404 Not Found");

    vi.unstubAllGlobals();
  });
});
