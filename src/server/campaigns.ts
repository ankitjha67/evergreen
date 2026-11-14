// FR-06.2 - Vendor campaign analytics: aggregate stats per spec
import { UsageRecord } from "../usage.js";

export interface CampaignStats {
  specRef: string;
  vendor: string;
  api: string;
  version: string;
  reposScanned: number;
  reposAffected: number;
  totalFindings: number;
  prsCreated: number;
  totalCostUSD: number;
  totalTokens: { input: number; output: number };
  repos: CampaignRepoEntry[];
  firstSeen: string;
  lastSeen: string;
}

export interface CampaignRepoEntry {
  repo: string;
  findings: number;
  prUrl?: string;
  lastEvent: string;
  costUSD: number;
}

export function buildCampaignStats(records: UsageRecord[]): CampaignStats[] {
  const campaigns = new Map<string, {
    vendor: string;
    api: string;
    version: string;
    repos: Map<string, { findings: number; prUrl?: string; lastEvent: string; costUSD: number }>;
    totalCostUSD: number;
    totalTokens: { input: number; output: number };
    firstSeen: string;
    lastSeen: string;
  }>();

  for (const record of records) {
    const ref = record.specRef;
    if (!ref) continue;

    let campaign = campaigns.get(ref);
    if (!campaign) {
      const parts = ref.split("@");
      campaign = {
        vendor: parts[0] ?? ref,
        api: parts[1] ?? "",
        version: parts[2] ?? "",
        repos: new Map(),
        totalCostUSD: 0,
        totalTokens: { input: 0, output: 0 },
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
      };
      campaigns.set(ref, campaign);
    }

    if (record.timestamp < campaign.firstSeen) campaign.firstSeen = record.timestamp;
    if (record.timestamp > campaign.lastSeen) campaign.lastSeen = record.timestamp;

    campaign.totalCostUSD += record.usage.costUSD;
    campaign.totalTokens.input += record.usage.inputTokens;
    campaign.totalTokens.output += record.usage.outputTokens;

    let repoEntry = campaign.repos.get(record.repo);
    if (!repoEntry) {
      repoEntry = { findings: 0, lastEvent: record.timestamp, costUSD: 0 };
      campaign.repos.set(record.repo, repoEntry);
    }
    repoEntry.findings += record.findings ?? 0;
    repoEntry.costUSD += record.usage.costUSD;
    if (record.timestamp > repoEntry.lastEvent) repoEntry.lastEvent = record.timestamp;
    if (record.prUrl) repoEntry.prUrl = record.prUrl;
  }

  const results: CampaignStats[] = [];
  for (const [specRef, campaign] of campaigns) {
    const repos = [...campaign.repos.entries()].map(([repo, entry]) => ({
      repo,
      ...entry,
      costUSD: Number(entry.costUSD.toFixed(4)),
    }));

    results.push({
      specRef,
      vendor: campaign.vendor,
      api: campaign.api,
      version: campaign.version,
      reposScanned: repos.length,
      reposAffected: repos.filter((r) => r.findings > 0).length,
      totalFindings: repos.reduce((sum, r) => sum + r.findings, 0),
      prsCreated: repos.filter((r) => r.prUrl).length,
      totalCostUSD: Number(campaign.totalCostUSD.toFixed(4)),
      totalTokens: campaign.totalTokens,
      repos,
      firstSeen: campaign.firstSeen,
      lastSeen: campaign.lastSeen,
    });
  }

  return results.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
