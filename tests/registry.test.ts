// FR-08.4 - Spec registry tests
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { SpecRegistry } from "../src/registry/specs.js";

const SPECS_DIR = resolve("specs");

describe("FR-08.4 SpecRegistry", () => {
  it("loads all valid specs from the specs/ directory", async () => {
    const reg = new SpecRegistry();
    await reg.loadFromDirectory(SPECS_DIR);
    expect(reg.size).toBeGreaterThanOrEqual(3); // stripe-node + openai + stripe-python at minimum
    expect(reg.get("stripe@stripe-node@2025-03-31.basil")).toBeDefined();
    expect(reg.get("openai@openai-node@v4")).toBeDefined();
    expect(reg.get("stripe@stripe-python@2025-03-31.basil")).toBeDefined();
  });

  it("allSpecs returns an array of all loaded specs", async () => {
    const reg = new SpecRegistry();
    await reg.loadFromDirectory(SPECS_DIR);
    const all = reg.allSpecs();
    expect(all.length).toBe(reg.size);
    for (const s of all) {
      expect(s.vendor).toBeTruthy();
      expect(s.changes.length).toBeGreaterThan(0);
    }
  });

  it("forLanguage filters by spec languages", async () => {
    const reg = new SpecRegistry();
    await reg.loadFromDirectory(SPECS_DIR);
    const jsSpecs = reg.forLanguage("javascript");
    expect(jsSpecs.length).toBeGreaterThanOrEqual(2);
    for (const s of jsSpecs) {
      expect(s.languages).toContain("javascript");
    }
    const pySpecs = reg.forLanguage("python");
    expect(pySpecs.length).toBeGreaterThanOrEqual(1); // stripe-python spec targets python
  });

  it("get returns undefined for unknown specRef", async () => {
    const reg = new SpecRegistry();
    await reg.loadFromDirectory(SPECS_DIR);
    expect(reg.get("nonexistent@1.0")).toBeUndefined();
  });
});
