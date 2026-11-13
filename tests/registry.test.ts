// FR-08.4 — Spec registry tests
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { SpecRegistry } from "../src/registry/specs.js";

const SPECS_DIR = resolve("specs");

describe("FR-08.4 SpecRegistry", () => {
  it("loads all valid specs from the specs/ directory", async () => {
    const reg = new SpecRegistry();
    await reg.loadFromDirectory(SPECS_DIR);
    expect(reg.size).toBeGreaterThanOrEqual(2); // stripe + openai at minimum
    expect(reg.get("stripe@2025-03-31.basil")).toBeDefined();
    expect(reg.get("openai@v4")).toBeDefined();
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
    expect(pySpecs.length).toBe(0); // none of our current specs target python
  });

  it("get returns undefined for unknown specRef", async () => {
    const reg = new SpecRegistry();
    await reg.loadFromDirectory(SPECS_DIR);
    expect(reg.get("nonexistent@1.0")).toBeUndefined();
  });
});
