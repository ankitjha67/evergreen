// Tests for Python language support — Stripe Python SDK spec + fixture scanning
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSpec, validateSpec } from "../src/changefeed/loader.js";
import { scan } from "../src/scanner/scan.js";

describe("Stripe Python SDK spec", () => {
  it("loads and validates successfully", async () => {
    const spec = await loadSpec(resolve("specs/stripe-python-2025-03-31-basil.json"));
    expect(spec.vendor).toBe("stripe");
    expect(spec.api).toBe("stripe-python");
    expect(spec.languages).toEqual(["python"]);
    expect(spec.changes).toHaveLength(3);
  });

  it("has valid regex patterns", async () => {
    const spec = await loadSpec(resolve("specs/stripe-python-2025-03-31-basil.json"));
    for (const change of spec.changes) {
      for (const pat of change.detect.patterns) {
        expect(() => new RegExp(pat)).not.toThrow();
      }
    }
  });

  it("scans Python fixture repo and finds all affected call sites", async () => {
    const spec = await loadSpec(resolve("specs/stripe-python-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-python"), spec);
    expect(result.findings.length).toBeGreaterThanOrEqual(5);

    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("stripe-py-basil-001")).toBe(true);
    expect(ruleIds.has("stripe-py-basil-002")).toBe(true);
    expect(ruleIds.has("stripe-py-basil-003")).toBe(true);
  });

  it("finds Invoice.upcoming in billing.py", async () => {
    const spec = await loadSpec(resolve("specs/stripe-python-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-python"), spec);
    const upcomingFindings = result.findings.filter((f) => f.ruleId === "stripe-py-basil-001" && f.file.includes("billing"));
    expect(upcomingFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("finds current_period_end in billing.py", async () => {
    const spec = await loadSpec(resolve("specs/stripe-python-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-python"), spec);
    const periodFindings = result.findings.filter((f) => f.ruleId === "stripe-py-basil-002");
    expect(periodFindings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Spec validation edge cases", () => {
  it("rejects spec with duplicate rule IDs", () => {
    const problems = validateSpec({
      specVersion: "1", vendor: "test", api: "test", version: "1.0", title: "Test",
      languages: ["python"],
      changes: [
        { id: "rule-1", severity: "breaking", title: "T", description: "D", detect: { patterns: ["x"], filePatterns: ["*.py"] }, replace: { guidance: "G" } },
        { id: "rule-1", severity: "breaking", title: "T2", description: "D2", detect: { patterns: ["y"], filePatterns: ["*.py"] }, replace: { guidance: "G2" } },
      ],
    });
    expect(problems.some((p) => p.includes("duplicated"))).toBe(true);
  });

  it("rejects spec with invalid regex", () => {
    const problems = validateSpec({
      specVersion: "1", vendor: "test", api: "test", version: "1.0", title: "Test",
      languages: ["python"],
      changes: [
        { id: "rule-1", severity: "breaking", title: "T", description: "D", detect: { patterns: ["[invalid"], filePatterns: ["*.py"] }, replace: { guidance: "G" } },
      ],
    });
    expect(problems.some((p) => p.includes("not a valid regex"))).toBe(true);
  });
});
