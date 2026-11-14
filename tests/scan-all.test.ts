// Tests for scan-all multi-spec scanning
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { SpecRegistry } from "../src/registry/specs.js";
import { scan } from "../src/scanner/scan.js";
import { specRef } from "../src/types.js";

const SPECS_DIR = resolve("specs");

describe("scan-all multi-spec", () => {
  it("scans JS fixture against all specs and finds Stripe hits", async () => {
    const registry = new SpecRegistry();
    await registry.loadFromDirectory(SPECS_DIR);

    const jsSpecs = registry.forLanguage("javascript");
    expect(jsSpecs.length).toBeGreaterThanOrEqual(2);

    const repo = resolve("fixtures/demo-repo");
    const results = await Promise.all(
      jsSpecs.map(async (spec) => {
        const result = await scan(repo, spec);
        return { ref: specRef(spec), findings: result.findings.length };
      }),
    );

    const stripeResult = results.find((r) => r.ref.includes("stripe-node"));
    expect(stripeResult).toBeDefined();
    expect(stripeResult!.findings).toBeGreaterThan(0);
  });

  it("scans Python fixture against Python specs", async () => {
    const registry = new SpecRegistry();
    await registry.loadFromDirectory(SPECS_DIR);

    const pySpecs = registry.forLanguage("python");
    expect(pySpecs.length).toBeGreaterThanOrEqual(1);

    const repo = resolve("fixtures/demo-repo-python");
    const results = await Promise.all(
      pySpecs.map(async (spec) => {
        const result = await scan(repo, spec);
        return { ref: specRef(spec), findings: result.findings.length };
      }),
    );

    expect(results[0].findings).toBeGreaterThan(0);
  });

  it("scans Ruby fixture against Ruby specs", async () => {
    const registry = new SpecRegistry();
    await registry.loadFromDirectory(SPECS_DIR);

    const rubySpecs = registry.forLanguage("ruby");
    expect(rubySpecs.length).toBeGreaterThanOrEqual(1);

    const repo = resolve("fixtures/demo-repo-ruby");
    const results = await Promise.all(
      rubySpecs.map(async (spec) => {
        const result = await scan(repo, spec);
        return { ref: specRef(spec), findings: result.findings.length };
      }),
    );

    expect(results[0].findings).toBeGreaterThan(0);
  });

  it("scans Go fixture against Go specs", async () => {
    const registry = new SpecRegistry();
    await registry.loadFromDirectory(SPECS_DIR);

    const goSpecs = registry.forLanguage("go");
    expect(goSpecs.length).toBeGreaterThanOrEqual(1);

    const repo = resolve("fixtures/demo-repo-go");
    const results = await Promise.all(
      goSpecs.map(async (spec) => {
        const result = await scan(repo, spec);
        return { ref: specRef(spec), findings: result.findings.length };
      }),
    );

    expect(results[0].findings).toBeGreaterThan(0);
  });

  it("concurrent scanning produces same results as sequential", async () => {
    const registry = new SpecRegistry();
    await registry.loadFromDirectory(SPECS_DIR);

    const repo = resolve("fixtures/demo-repo");
    const allSpecs = registry.allSpecs();

    // Sequential
    const sequential = [];
    for (const spec of allSpecs) {
      const result = await scan(repo, spec);
      sequential.push({ ref: specRef(spec), count: result.findings.length });
    }

    // Concurrent
    const concurrent = await Promise.all(
      allSpecs.map(async (spec) => {
        const result = await scan(repo, spec);
        return { ref: specRef(spec), count: result.findings.length };
      }),
    );

    // Sort both by ref and compare
    sequential.sort((a, b) => a.ref.localeCompare(b.ref));
    concurrent.sort((a, b) => a.ref.localeCompare(b.ref));
    expect(concurrent).toEqual(sequential);
  });
});
