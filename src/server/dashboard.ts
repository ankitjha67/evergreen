// FR-08.6 - Admin dashboard HTML renderer
import type { WebhookEvent } from "./event-log.js";

interface DashboardData {
  version: string;
  uptime: number;
  specs: { ref: string; vendor: string; api: string; version: string; title: string; languages: string[]; rules: number }[];
  events: WebhookEvent[];
  evtStats: { total: number; byEvent: Record<string, number>; byStatus: Record<string, number>; byRepo: Record<string, number> };
  usage: { totalEvents: number; totalCostUSD: number; totalTokens: { input: number; output: number }; prsCreated: number; byProvider: Record<string, number> } | null;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderDashboard(data: DashboardData): string {
  const { version, uptime, specs, events, evtStats, usage } = data;

  const specRows = specs.map((s) => `
    <tr>
      <td>${esc(s.ref)}</td>
      <td>${esc(s.vendor)}</td>
      <td>${esc(s.api)} ${esc(s.version)}</td>
      <td>${s.languages.map(esc).join(", ")}</td>
      <td>${s.rules}</td>
    </tr>`).join("");

  const eventRows = events.map((e) => {
    const statusClass = e.status === "error" ? "status-error" : e.status === "ignored" ? "status-ignored" : "status-ok";
    return `
    <tr>
      <td>${esc(e.receivedAt.replace("T", " ").replace(/\.\d+Z$/, "Z"))}</td>
      <td>${esc(e.event)}${e.action ? `/${esc(e.action)}` : ""}</td>
      <td>${e.repo ? esc(e.repo) : "-"}</td>
      <td>${e.sender ? esc(e.sender) : "-"}</td>
      <td class="${statusClass}">${esc(e.status)}</td>
      <td>${e.durationMs ?? "-"}ms</td>
    </tr>`;
  }).join("");

  const usageSection = usage ? `
    <div class="card">
      <h2>Usage Stats</h2>
      <div class="stats-grid">
        <div class="stat"><span class="stat-value">${usage.totalEvents}</span><span class="stat-label">Total Events</span></div>
        <div class="stat"><span class="stat-value">$${usage.totalCostUSD.toFixed(4)}</span><span class="stat-label">Total Cost</span></div>
        <div class="stat"><span class="stat-value">${usage.totalTokens.input.toLocaleString()}</span><span class="stat-label">Input Tokens</span></div>
        <div class="stat"><span class="stat-value">${usage.totalTokens.output.toLocaleString()}</span><span class="stat-label">Output Tokens</span></div>
        <div class="stat"><span class="stat-value">${usage.prsCreated}</span><span class="stat-label">PRs Created</span></div>
        <div class="stat"><span class="stat-value">${Object.keys(usage.byProvider).length}</span><span class="stat-label">Providers Used</span></div>
      </div>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Evergreen Admin</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e1e4e8;line-height:1.5;padding:20px}
    h1{font-size:1.5rem;margin-bottom:4px;color:#58a6ff}
    h2{font-size:1.1rem;margin-bottom:12px;color:#79c0ff;border-bottom:1px solid #21262d;padding-bottom:6px}
    .header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px;border-bottom:1px solid #30363d;padding-bottom:12px}
    .header small{color:#8b949e}
    .card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;margin-bottom:16px}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
    .stat{text-align:center;padding:8px;background:#0d1117;border-radius:6px;border:1px solid #21262d}
    .stat-value{display:block;font-size:1.4rem;font-weight:600;color:#58a6ff}
    .stat-label{font-size:0.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px}
    table{width:100%;border-collapse:collapse;font-size:0.85rem}
    th{text-align:left;padding:8px 10px;border-bottom:2px solid #30363d;color:#8b949e;font-weight:500;text-transform:uppercase;font-size:0.7rem;letter-spacing:0.5px}
    td{padding:6px 10px;border-bottom:1px solid #21262d}
    tr:hover td{background:#1c2128}
    .status-ok{color:#3fb950}
    .status-error{color:#f85149}
    .status-ignored{color:#d29922}
    .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:600}
    .badge-green{background:#1b4332;color:#3fb950}
    .badge-blue{background:#0c2d48;color:#58a6ff}
    .empty{color:#484f58;text-align:center;padding:24px;font-style:italic}
    @media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)}table{font-size:0.75rem}td,th{padding:4px 6px}}
  </style>
</head>
<body>
  <div class="header">
    <div><h1>Evergreen Admin Dashboard</h1><small>Self-maintaining APIs</small></div>
    <div><span class="badge badge-green">v${esc(version)}</span> <span class="badge badge-blue">up ${formatUptime(uptime)}</span></div>
  </div>

  <div class="card">
    <h2>Server Status</h2>
    <div class="stats-grid">
      <div class="stat"><span class="stat-value">${specs.length}</span><span class="stat-label">Loaded Specs</span></div>
      <div class="stat"><span class="stat-value">${evtStats.total}</span><span class="stat-label">Webhook Events</span></div>
      <div class="stat"><span class="stat-value">${evtStats.byStatus?.processed ?? 0}</span><span class="stat-label">Processed</span></div>
      <div class="stat"><span class="stat-value">${evtStats.byStatus?.error ?? 0}</span><span class="stat-label">Errors</span></div>
    </div>
  </div>

  ${usageSection}

  <div class="card">
    <h2>Loaded Changefeed Specs</h2>
    ${specs.length ? `<table>
      <thead><tr><th>Ref</th><th>Vendor</th><th>API</th><th>Languages</th><th>Rules</th></tr></thead>
      <tbody>${specRows}</tbody>
    </table>` : '<p class="empty">No specs loaded</p>'}
  </div>

  <div class="card">
    <h2>Recent Webhook Events</h2>
    ${events.length ? `<table>
      <thead><tr><th>Time</th><th>Event</th><th>Repo</th><th>Sender</th><th>Status</th><th>Duration</th></tr></thead>
      <tbody>${eventRows}</tbody>
    </table>` : '<p class="empty">No webhook events received yet</p>'}
  </div>

  <div class="card" style="text-align:center;color:#484f58;font-size:0.8rem;padding:12px">
    <a href="/healthz" style="color:#58a6ff;text-decoration:none">Health</a> &middot;
    <a href="/ready" style="color:#58a6ff;text-decoration:none">Readiness</a> &middot;
    <a href="/api/specs" style="color:#58a6ff;text-decoration:none">Specs API</a> &middot;
    <a href="/api/events" style="color:#58a6ff;text-decoration:none">Events API</a> &middot;
    <a href="/api/usage" style="color:#58a6ff;text-decoration:none">Usage API</a>
  </div>
</body>
</html>`;
}
