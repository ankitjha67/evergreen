// FR-03.1 - deterministic scanner
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/scanner/scan.js";
import { BreakingChangeSpec } from "../src/types.js";

const spec: BreakingChangeSpec = {
  specVersion: "1",
  vendor: "acme",
  api: "acme-sdk",
  version: "2.0",
  title: "t",
  languages: ["javascript"],
  changes: [
    {
      id: "r1",
      severity: "breaking",
      title: "oldApi removed",
      description: "d",
      // two patterns that both hit the same line - dedupe must collapse them
      detect: { patterns: ["oldApi\\(", "client\\.oldApi"], filePatterns: ["**/*.js"] },
      replace: { guidance: "use newApi" },
    },
  ],
};

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "eg-scan-"));
  await mkdir(join(repo, "src"));
  await mkdir(join(repo, "node_modules", "dep"), { recursive: true });
  await writeFile(join(repo, "src", "affected.js"), `const x = client.oldApi({ a: 1 });\nconst y = 2;\n`);
  await writeFile(join(repo, "src", "unaffected.js"), `const x = client.newApi({ a: 1 });\n`);
  await writeFile(join(repo, "src", "binary.js"), Buffer.from([0x00, 0x01, 0x02]));
  await writeFile(join(repo, "node_modules", "dep", "index.js"), `client.oldApi();\n`);
});

describe("FR-03.1 scanner", () => {
  it("finds affected lines, skips binaries, excludes node_modules, dedupes multi-pattern hits", async () => {
    const result = await scan(repo, spec);
    expect(result.findings).toHaveLength(1); // one line, despite two matching patterns
    expect(result.findings[0].file).toBe("src/affected.js");
    expect(result.findings[0].line).toBe(1);
    expect(result.findings[0].ruleId).toBe("r1");
    expect(result.skippedFiles.some((s) => s.includes("binary.js"))).toBe(true);
    expect(result.findings.every((f) => !f.file.includes("node_modules"))).toBe(true);
  });

  it("returns clean result when nothing matches", async () => {
    const cleanSpec = structuredClone(spec);
    cleanSpec.changes[0].detect.patterns = ["definitelyNotPresent\\("];
    const result = await scan(repo, cleanSpec);
    expect(result.findings).toHaveLength(0);
  });

  it("respects extra ignore globs from repo config", async () => {
    const result = await scan(repo, spec, { ignore: ["src/affected.js"] });
    expect(result.findings).toHaveLength(0);
  });
});
