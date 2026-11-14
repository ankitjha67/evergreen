// Tests for Ruby language support - Stripe Ruby SDK spec + fixture scanning
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSpec } from "../src/changefeed/loader.js";
import { scan } from "../src/scanner/scan.js";

describe("Stripe Ruby SDK spec", () => {
  it("loads and validates successfully", async () => {
    const spec = await loadSpec(resolve("specs/stripe-ruby-2025-03-31-basil.json"));
    expect(spec.vendor).toBe("stripe");
    expect(spec.api).toBe("stripe-ruby");
    expect(spec.languages).toEqual(["ruby"]);
    expect(spec.changes).toHaveLength(3);
  });

  it("has valid regex patterns", async () => {
    const spec = await loadSpec(resolve("specs/stripe-ruby-2025-03-31-basil.json"));
    for (const change of spec.changes) {
      for (const pat of change.detect.patterns) {
        expect(() => new RegExp(pat)).not.toThrow();
      }
    }
  });

  it("scans Ruby fixture repo and finds all affected call sites", async () => {
    const spec = await loadSpec(resolve("specs/stripe-ruby-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-ruby"), spec);
    expect(result.findings.length).toBeGreaterThanOrEqual(5);

    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("stripe-rb-basil-001")).toBe(true);
    expect(ruleIds.has("stripe-rb-basil-002")).toBe(true);
    expect(ruleIds.has("stripe-rb-basil-003")).toBe(true);
  });

  it("finds Stripe::Invoice.upcoming in billing.rb", async () => {
    const spec = await loadSpec(resolve("specs/stripe-ruby-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-ruby"), spec);
    const upcomingFindings = result.findings.filter(
      (f) => f.ruleId === "stripe-rb-basil-001" && f.file.includes("billing"),
    );
    expect(upcomingFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("finds current_period_end in billing.rb", async () => {
    const spec = await loadSpec(resolve("specs/stripe-ruby-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-ruby"), spec);
    const periodFindings = result.findings.filter((f) => f.ruleId === "stripe-rb-basil-002");
    expect(periodFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("finds Stripe.api_key assignment in both Ruby files", async () => {
    const spec = await loadSpec(resolve("specs/stripe-ruby-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-ruby"), spec);
    const apiKeyFindings = result.findings.filter(
      (f) => f.ruleId === "stripe-rb-basil-003" && f.matchText.includes("api_key"),
    );
    expect(apiKeyFindings.length).toBeGreaterThanOrEqual(2);
  });
});
