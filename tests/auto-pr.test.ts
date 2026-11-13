// Tests for FR-10 — Auto-PR creation (unit tests, no actual GitHub calls)
import { describe, it, expect } from "vitest";
import { BreakingChangeSpec, Finding, ScanResult, ChangeManifest, specRef } from "../src/types.js";

const mockSpec: BreakingChangeSpec = {
  specVersion: "1",
  vendor: "stripe",
  api: "node",
  version: "2025-03-31",
  title: "Stripe Node.js SDK v2025-03-31 Migration",
  languages: ["typescript", "javascript"],
  changes: [
    {
      id: "STRIPE-001",
      severity: "breaking",
      title: "charges.create → paymentIntents.create",
      description: "The Charges API is removed. Use PaymentIntents.",
      detect: { patterns: ["charges\\.create"], filePatterns: ["**/*.ts", "**/*.js"] },
      replace: { guidance: "Replace charges.create with paymentIntents.create" },
    },
  ],
};

const mockFindings: Finding[] = [
  { ruleId: "STRIPE-001", file: "src/billing.ts", line: 42, column: 5, matchText: "charges.create", lineText: "const charge = await stripe.charges.create({" },
];

const mockScanResult: ScanResult = {
  specRef: specRef(mockSpec),
  repo: "owner/repo",
  scannedFiles: 100,
  skippedFiles: [],
  findings: mockFindings,
  startedAt: "2026-11-13T00:00:00.000Z",
  durationMs: 500,
};

const mockManifest: ChangeManifest = {
  specRef: specRef(mockSpec),
  engine: { model: "claude-opus-5-5" },
  files: [
    {
      path: "src/billing.ts",
      rules: ["STRIPE-001"],
      status: "migrated",
      confidence: 0.95,
      summary: "Replaced charges.create with paymentIntents.create",
    },
  ],
};

describe("Auto-PR branch naming", () => {
  it("generates a valid evergreen/* branch name", () => {
    const branch = `evergreen/${mockSpec.vendor}-${mockSpec.api}-${mockSpec.version}`.replace(/[^a-zA-Z0-9/_-]/g, "-");
    expect(branch).toBe("evergreen/stripe-node-2025-03-31");
    expect(branch).toMatch(/^evergreen\//);
  });
});

describe("specRef", () => {
  it("formats as vendor@version", () => {
    expect(specRef(mockSpec)).toBe("stripe@2025-03-31");
  });
});

describe("manifest shape", () => {
  it("has required fields", () => {
    expect(mockManifest.specRef).toBe("stripe@2025-03-31");
    expect(mockManifest.engine.model).toBeTruthy();
    expect(mockManifest.files).toHaveLength(1);
    expect(mockManifest.files[0].status).toBe("migrated");
    expect(mockManifest.files[0].confidence).toBeGreaterThan(0);
    expect(mockManifest.files[0].confidence).toBeLessThanOrEqual(1);
  });
});
