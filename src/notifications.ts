// Webhook notification channels - send alerts when breaking changes are detected
import { ScanResult, specRef, BreakingChangeSpec } from "./types.js";

export interface NotificationChannel {
  type: "slack" | "webhook" | "console";
  url?: string;
  token?: string;
  channel?: string;
}

export interface NotificationPayload {
  event: "scan_complete" | "migration_complete" | "new_spec";
  specRef: string;
  repo: string;
  findingsCount: number;
  summary: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export function buildScanNotification(scan: ScanResult, spec: BreakingChangeSpec): NotificationPayload {
  const affectedFiles = new Set(scan.findings.map((f) => f.file)).size;
  const ruleBreakdown = new Map<string, number>();
  for (const f of scan.findings) {
    ruleBreakdown.set(f.ruleId, (ruleBreakdown.get(f.ruleId) ?? 0) + 1);
  }

  const ruleLines = [...ruleBreakdown.entries()]
    .map(([id, count]) => `  ${id}: ${count} site(s)`)
    .join("\n");

  const summary = scan.findings.length === 0
    ? `No breaking changes found in ${scan.repo} for ${spec.title}.`
    : `Found ${scan.findings.length} breaking change(s) across ${affectedFiles} file(s) in ${scan.repo} for ${spec.title}.${ruleLines ? "\n" + ruleLines : ""}`;

  return {
    event: "scan_complete",
    specRef: specRef(spec),
    repo: scan.repo,
    findingsCount: scan.findings.length,
    summary,
    timestamp: new Date().toISOString(),
    details: {
      scannedFiles: scan.scannedFiles,
      affectedFiles,
      durationMs: scan.durationMs,
      deadline: spec.deadline,
      rules: Object.fromEntries(ruleBreakdown),
    },
  };
}

export function buildMigrationNotification(
  repo: string,
  spec: BreakingChangeSpec,
  filesChanged: number,
  prUrl?: string,
): NotificationPayload {
  const summary = prUrl
    ? `Migration PR opened for ${spec.title} in ${repo}: ${prUrl} (${filesChanged} file(s) changed).`
    : `Migration complete for ${spec.title} in ${repo}: ${filesChanged} file(s) changed.`;

  return {
    event: "migration_complete",
    specRef: specRef(spec),
    repo,
    findingsCount: filesChanged,
    summary,
    timestamp: new Date().toISOString(),
    details: { filesChanged, prUrl },
  };
}

function buildSlackPayload(notification: NotificationPayload): object {
  const color = notification.findingsCount > 0 ? "#e74c3c" : "#2ecc71";
  const emoji = notification.event === "scan_complete" ? ":mag:" : ":rocket:";

  return {
    attachments: [
      {
        color,
        fallback: notification.summary,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${emoji} *Evergreen: ${notification.event.replace(/_/g, " ")}*\n${notification.summary}`,
            },
          },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `*Repo:* ${notification.repo}` },
              { type: "mrkdwn", text: `*Spec:* ${notification.specRef}` },
              { type: "mrkdwn", text: `*Time:* ${notification.timestamp}` },
            ],
          },
        ],
      },
    ],
  };
}

export async function sendNotification(
  channel: NotificationChannel,
  notification: NotificationPayload,
): Promise<{ ok: boolean; error?: string }> {
  if (channel.type === "console") {
    console.log(`[notification] ${notification.summary}`);
    return { ok: true };
  }

  if (!channel.url) {
    return { ok: false, error: "No URL configured for notification channel" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string;

  if (channel.type === "slack") {
    if (channel.token) {
      headers["Authorization"] = `Bearer ${channel.token}`;
    }
    body = JSON.stringify(buildSlackPayload(notification));
  } else {
    if (channel.token) {
      headers["Authorization"] = `Bearer ${channel.token}`;
    }
    body = JSON.stringify(notification);
  }

  try {
    const response = await fetch(channel.url, { method: "POST", headers, body });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function parseChannelsFromEnv(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];

  if (process.env.SLACK_WEBHOOK_URL) {
    channels.push({
      type: "slack",
      url: process.env.SLACK_WEBHOOK_URL,
      token: process.env.SLACK_TOKEN,
      channel: process.env.SLACK_CHANNEL,
    });
  }

  if (process.env.NOTIFY_WEBHOOK_URL) {
    channels.push({
      type: "webhook",
      url: process.env.NOTIFY_WEBHOOK_URL,
      token: process.env.NOTIFY_WEBHOOK_TOKEN,
    });
  }

  if (process.env.NOTIFY_CONSOLE === "true") {
    channels.push({ type: "console" });
  }

  return channels;
}

export async function notifyAll(
  channels: NotificationChannel[],
  notification: NotificationPayload,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const results = await Promise.allSettled(
    channels.map((ch) => sendNotification(ch, notification)),
  );

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled" && r.value.ok) {
      sent++;
    } else {
      failed++;
      const err = r.status === "fulfilled" ? r.value.error : (r as PromiseRejectedResult).reason?.message;
      if (err) errors.push(err);
    }
  }

  return { sent, failed, errors };
}
