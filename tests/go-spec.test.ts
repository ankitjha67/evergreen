// Tests for Go language support - Stripe Go SDK spec + fixture scanning
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSpec } from "../src/changefeed/loader.js";
import { scan } from "../src/scanner/scan.js";

describe("Stripe Go SDK spec", () => {
  it("loads and validates successfully", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    expect(spec.vendor).toBe("stripe");
    expect(spec.api).toBe("stripe-go");
    expect(spec.languages).toEqual(["go"]);
    expect(spec.changes).toHaveLength(3);
  });

  it("has valid regex patterns", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    for (const change of spec.changes) {
      for (const pat of change.detect.patterns) {
        expect(() => new RegExp(pat)).not.toThrow();
      }
    }
  });

  it("scans Go fixture repo and finds all affected call sites", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-go"), spec);
    expect(result.findings.length).toBeGreaterThanOrEqual(5);

    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("stripe-go-basil-001")).toBe(true);
    expect(ruleIds.has("stripe-go-basil-002")).toBe(true);
    expect(ruleIds.has("stripe-go-basil-003")).toBe(true);
  });

  it("finds invoice.GetNext in billing.go", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-go"), spec);
    const invoiceFindings = result.findings.filter(
      (f) => f.ruleId === "stripe-go-basil-001" && f.file.includes("billing"),
    );
    expect(invoiceFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("finds CurrentPeriodEnd in billing.go", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-go"), spec);
    const periodFindings = result.findings.filter((f) => f.ruleId === "stripe-go-basil-002");
    expect(periodFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("finds stripe.Key assignment in both Go files", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-go"), spec);
    const keyFindings = result.findings.filter(
      (f) => f.ruleId === "stripe-go-basil-003" && f.matchText.includes("stripe.Key"),
    );
    expect(keyFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("finds charge.New in billing.go", async () => {
    const spec = await loadSpec(resolve("specs/stripe-go-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-go"), spec);
    const chargeFindings = result.findings.filter(
      (f) => f.ruleId === "stripe-go-basil-003" && f.matchText.includes("charge.New"),
    );
    expect(chargeFindings.length).toBeGreaterThanOrEqual(1);
  });
});
