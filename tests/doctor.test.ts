import { describe, it, expect, vi } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { runDoctor, formatDoctorReport, type DoctorReport, type CheckResult } from "../src/doctor.js";

const TMP = resolve("test-tmp-doctor");

describe("runDoctor", () => {
  it("runs all checks and returns a report", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, "specs"), { recursive: true });

    const report = await runDoctor(TMP, join(TMP, "specs"));
    expect(report.checks.length).toBeGreaterThan(0);
    expect(typeof report.ok).toBe("number");
    expect(typeof report.warnings).toBe("number");
    expect(typeof report.failures).toBe("number");
    expect(typeof report.healthy).toBe("boolean");
    expect(report.ok + report.warnings + report.failures).toBe(report.checks.length);

    await rm(TMP, { recursive: true, force: true });
  });

  it("detects Node.js version", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, "specs"), { recursive: true });

    const report = await runDoctor(TMP, join(TMP, "specs"));
    const nodeCheck = report.checks.find((c) => c.name === "Node.js version");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe("ok");

    await rm(TMP, { recursive: true, force: true });
  });

  it("warns when no config file exists", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, "specs"), { recursive: true });

    const report = await runDoctor(TMP, join(TMP, "specs"));
    const configCheck = report.checks.find((c) => c.name === "Repo config");
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe("warn");
    expect(configCheck!.fix).toContain("evergreen init");

    await rm(TMP, { recursive: true, force: true });
  });

  it("detects valid config file", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, "specs"), { recursive: true });
    await writeFile(join(TMP, ".evergreen.yaml"), "threshold: 0.8\nprovider: anthropic\n", "utf8");

    const report = await runDoctor(TMP, join(TMP, "specs"));
    const configCheck = report.checks.find((c) => c.name === "Repo config");
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe("ok");
    expect(configCheck!.message).toContain("provider=anthropic");

    await rm(TMP, { recursive: true, force: true });
  });

  it("warns on empty specs directory", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, "specs"), { recursive: true });

    const report = await runDoctor(TMP, join(TMP, "specs"));
    const specsCheck = report.checks.find((c) => c.name === "Specs directory");
    expect(specsCheck).toBeDefined();
    expect(specsCheck!.status).toBe("warn");

    await rm(TMP, { recursive: true, force: true });
  });

  it("detects specs in directory", async () => {
    await mkdir(TMP, { recursive: true });
    const specsDir = join(TMP, "specs");
    await mkdir(specsDir, { recursive: true });
    await writeFile(join(specsDir, "test.json"), '{"specVersion":"1"}', "utf8");

    const report = await runDoctor(TMP, specsDir);
    const specsCheck = report.checks.find((c) => c.name === "Specs directory");
    expect(specsCheck).toBeDefined();
    expect(specsCheck!.status).toBe("ok");
    expect(specsCheck!.message).toContain("1 spec file(s)");

    await rm(TMP, { recursive: true, force: true });
  });

  it("warns when not a git repo", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, "specs"), { recursive: true });

    const report = await runDoctor(TMP, join(TMP, "specs"));
    const gitCheck = report.checks.find((c) => c.name === "Git repository");
    expect(gitCheck).toBeDefined();
    expect(gitCheck!.status).toBe("warn");

    await rm(TMP, { recursive: true, force: true });
  });
});

describe("formatDoctorReport", () => {
  it("formats a healthy report", () => {
    const report: DoctorReport = {
      checks: [
        { name: "Node.js version", status: "ok", message: "v22.0.0" },
        { name: "Config", status: "ok", message: "Found" },
      ],
      ok: 2, warnings: 0, failures: 0, healthy: true,
    };
    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("Evergreen Doctor");
    expect(formatted).toContain("✓ Node.js version");
    expect(formatted).toContain("2 passed");
    expect(formatted).toContain("healthy and ready");
  });

  it("formats report with failures", () => {
    const report: DoctorReport = {
      checks: [
        { name: "API key", status: "fail", message: "Missing", fix: "Set ANTHROPIC_API_KEY" },
        { name: "Config", status: "warn", message: "No config", fix: "Run init" },
      ],
      ok: 0, warnings: 1, failures: 1, healthy: false,
    };
    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("✗ API key");
    expect(formatted).toContain("! Config");
    expect(formatted).toContain("Fix: Set ANTHROPIC_API_KEY");
    expect(formatted).toContain("Fix the failures");
  });
});
