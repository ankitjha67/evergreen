import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { scan } from "../src/scanner/scan.js";
import { loadSpec } from "../src/changefeed/loader.js";

const STRIPE_SPEC = resolve("specs/stripe-2025-03-31-basil.json");
const TMP = resolve("test-tmp-scope");

describe("monorepo scoping", () => {
  it("scans only scoped paths", async () => {
    // Create a mock monorepo with two workspaces
    await mkdir(join(TMP, "packages/web"), { recursive: true });
    await mkdir(join(TMP, "packages/api"), { recursive: true });

    // web workspace has Stripe usage
    await writeFile(
      join(TMP, "packages/web/billing.js"),
      `const upcoming = await stripe.invoices.retrieveUpcoming({ customer_id: cust.id });\n`,
      "utf8",
    );

    // api workspace has no Stripe usage
    await writeFile(
      join(TMP, "packages/api/server.js"),
      `const express = require("express");\nconst app = express();\n`,
      "utf8",
    );

    const spec = await loadSpec(STRIPE_SPEC);

    // Scan only the api workspace -> should find nothing
    const apiResult = await scan(TMP, spec, { scope: ["packages/api"] });
    expect(apiResult.findings).toHaveLength(0);

    // Scan only the web workspace -> should find the Stripe usage
    const webResult = await scan(TMP, spec, { scope: ["packages/web"] });
    expect(webResult.findings.length).toBeGreaterThan(0);
    expect(webResult.findings[0].file).toContain("packages/web");

    // Scan both -> should find findings
    const bothResult = await scan(TMP, spec, { scope: ["packages/web", "packages/api"] });
    expect(bothResult.findings.length).toBeGreaterThan(0);

    // Scan without scope -> should also find findings
    const allResult = await scan(TMP, spec, {});
    expect(allResult.findings.length).toBeGreaterThan(0);

    await rm(TMP, { recursive: true, force: true });
  });

  it("scope with trailing slash works", async () => {
    await mkdir(join(TMP, "src"), { recursive: true });
    await writeFile(
      join(TMP, "src/pay.js"),
      `stripe.invoices.retrieveUpcoming({ customer_id: "cus_123" });\n`,
      "utf8",
    );

    const spec = await loadSpec(STRIPE_SPEC);
    const result = await scan(TMP, spec, { scope: ["src/"] });
    expect(result.findings.length).toBeGreaterThan(0);

    await rm(TMP, { recursive: true, force: true });
  });
});
