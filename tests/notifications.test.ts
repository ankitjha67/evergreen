import { describe, it, expect, vi } from "vitest";
import {
  buildScanNotification,
  buildMigrationNotification,
  sendNotification,
  parseChannelsFromEnv,
  notifyAll,
  type NotificationChannel,
  type NotificationPayload,
} from "../src/notifications.js";
import { ScanResult, BreakingChangeSpec } from "../src/types.js";

const mockSpec: BreakingChangeSpec = {
  specVersion: "1",
  vendor: "stripe",
  api: "stripe-node",
  version: "2025-03-31.basil",
  title: "Stripe API 2025-03-31 (basil) breaking changes",
  languages: ["javascript"],
  changes: [
    {
      id: "stripe-basil-001",
      severity: "breaking",
      title: "retrieveUpcoming removed",
      description: "desc",
      detect: { patterns: ["retrieveUpcoming"], filePatterns: ["**/*.js"] },
      replace: { guidance: "Use createPreview" },
    },
  ],
};

const mockScanResult: ScanResult = {
  specRef: "stripe@stripe-node@2025-03-31.basil",
  repo: "/test/repo",
  scannedFiles: 10,
  skippedFiles: [],
  findings: [
    { ruleId: "stripe-basil-001", file: "billing.js", line: 5, column: 1, matchText: "retrieveUpcoming", lineText: "" },
    { ruleId: "stripe-basil-001", file: "billing.js", line: 12, column: 1, matchText: "retrieveUpcoming", lineText: "" },
    { ruleId: "stripe-basil-001", file: "payment.js", line: 3, column: 1, matchText: "retrieveUpcoming", lineText: "" },
  ],
  startedAt: "2026-11-14T00:00:00Z",
  durationMs: 50,
};

describe("buildScanNotification", () => {
  it("builds notification from scan results", () => {
    const notif = buildScanNotification(mockScanResult, mockSpec);
    expect(notif.event).toBe("scan_complete");
    expect(notif.specRef).toBe("stripe@stripe-node@2025-03-31.basil");
    expect(notif.repo).toBe("/test/repo");
    expect(notif.findingsCount).toBe(3);
    expect(notif.summary).toContain("3 breaking change");
    expect(notif.summary).toContain("2 file(s)");
    expect(notif.details).toBeDefined();
    expect(notif.details!.affectedFiles).toBe(2);
  });

  it("handles zero findings", () => {
    const emptyResult = { ...mockScanResult, findings: [] };
    const notif = buildScanNotification(emptyResult, mockSpec);
    expect(notif.findingsCount).toBe(0);
    expect(notif.summary).toContain("No breaking changes found");
  });
});

describe("buildMigrationNotification", () => {
  it("builds notification with PR URL", () => {
    const notif = buildMigrationNotification("/test/repo", mockSpec, 3, "https://github.com/org/repo/pull/42");
    expect(notif.event).toBe("migration_complete");
    expect(notif.summary).toContain("PR opened");
    expect(notif.summary).toContain("pull/42");
    expect(notif.summary).toContain("3 file(s)");
  });

  it("builds notification without PR URL", () => {
    const notif = buildMigrationNotification("/test/repo", mockSpec, 2);
    expect(notif.event).toBe("migration_complete");
    expect(notif.summary).toContain("Migration complete");
    expect(notif.summary).toContain("2 file(s)");
  });
});

describe("sendNotification", () => {
  it("sends to console channel", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await sendNotification(
      { type: "console" },
      { event: "scan_complete", specRef: "test@test@1", repo: "r", findingsCount: 0, summary: "test", timestamp: "" },
    );
    expect(result.ok).toBe(true);
    consoleSpy.mockRestore();
  });

  it("returns error when no URL configured for webhook", async () => {
    const result = await sendNotification(
      { type: "webhook" },
      { event: "scan_complete", specRef: "test@test@1", repo: "r", findingsCount: 0, summary: "test", timestamp: "" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No URL configured");
  });
});

describe("parseChannelsFromEnv", () => {
  it("returns empty when no env vars set", () => {
    const orig = { ...process.env };
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.NOTIFY_WEBHOOK_URL;
    delete process.env.NOTIFY_CONSOLE;
    const channels = parseChannelsFromEnv();
    expect(channels).toHaveLength(0);
    Object.assign(process.env, orig);
  });

  it("parses SLACK_WEBHOOK_URL", () => {
    const orig = process.env.SLACK_WEBHOOK_URL;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    const channels = parseChannelsFromEnv();
    expect(channels.some((c) => c.type === "slack")).toBe(true);
    if (orig === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = orig;
  });

  it("parses NOTIFY_CONSOLE", () => {
    const orig = process.env.NOTIFY_CONSOLE;
    process.env.NOTIFY_CONSOLE = "true";
    const channels = parseChannelsFromEnv();
    expect(channels.some((c) => c.type === "console")).toBe(true);
    if (orig === undefined) delete process.env.NOTIFY_CONSOLE;
    else process.env.NOTIFY_CONSOLE = orig;
  });
});

describe("notifyAll", () => {
  it("aggregates results from multiple channels", async () => {
    const channels: NotificationChannel[] = [
      { type: "console" },
      { type: "webhook" }, // no URL -> will fail
    ];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const payload: NotificationPayload = {
      event: "scan_complete", specRef: "t@t@1", repo: "r", findingsCount: 0, summary: "test", timestamp: "",
    };
    const result = await notifyAll(channels, payload);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    consoleSpy.mockRestore();
  });
});
