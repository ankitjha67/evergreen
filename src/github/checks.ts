// FR-08.5 — Check Run creation with annotations
import { Octokit } from "@octokit/rest";
import { BreakingChangeSpec, Finding, ScanResult, specRef } from "../types.js";

const MAX_ANNOTATIONS_PER_UPDATE = 50;

interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "warning" | "notice";
  title: string;
  message: string;
}

function findingToAnnotation(finding: Finding, spec: BreakingChangeSpec): CheckAnnotation {
  const rule = spec.changes.find((c) => c.id === finding.ruleId);
  const level = rule?.severity === "behavioral" ? "notice" as const : "warning" as const;
  const guidance = rule?.replace.guidance ?? "";
  const docsUrl = rule?.replace.docsUrl ?? spec.docsUrl ?? "";
  const message = [
    `**${rule?.title ?? finding.ruleId}**`,
    guidance,
    docsUrl ? `Docs: ${docsUrl}` : "",
    `Matched: \`${finding.matchText}\``,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    path: finding.file,
    start_line: finding.line,
    end_line: finding.line,
    annotation_level: level,
    title: rule?.title ?? finding.ruleId,
    message,
  };
}

function buildSummary(scan: ScanResult, spec: BreakingChangeSpec): string {
  const byRule = new Map<string, Finding[]>();
  for (const f of scan.findings) {
    const arr = byRule.get(f.ruleId) ?? [];
    arr.push(f);
    byRule.set(f.ruleId, arr);
  }

  const lines: string[] = [
    `## ${spec.title}`,
    "",
    `**${scan.findings.length} affected location(s)** across **${new Set(scan.findings.map((f) => f.file)).size} file(s)**`,
    "",
    "| Rule | Files | Locations |",
    "|---|---|---|",
  ];

  for (const [ruleId, findings] of byRule) {
    const rule = spec.changes.find((c) => c.id === ruleId);
    const fileCount = new Set(findings.map((f) => f.file)).size;
    lines.push(`| ${rule?.title ?? ruleId} | ${fileCount} | ${findings.length} |`);
  }

  lines.push("");
  if (spec.deadline) {
    lines.push(`**Migration deadline:** ${spec.deadline}`);
  }
  lines.push(
    "",
    "Run `npx evergreen migrate` locally for an automated migration PR, or install the [Evergreen CLI](https://github.com/evergreen-api/evergreen).",
  );

  return lines.join("\n");
}

export async function createCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  spec: BreakingChangeSpec,
  scan: ScanResult,
): Promise<void> {
  const annotations = scan.findings.map((f) => findingToAnnotation(f, spec));
  const summary = buildSummary(scan, spec);
  const conclusion = scan.findings.length > 0 ? "action_required" : "success";

  // Create the Check Run with the first batch of annotations
  const firstBatch = annotations.slice(0, MAX_ANNOTATIONS_PER_UPDATE);
  const { data: checkRun } = await octokit.checks.create({
    owner,
    repo,
    name: `Evergreen: ${spec.title}`,
    head_sha: sha,
    status: "completed",
    conclusion,
    output: {
      title:
        scan.findings.length > 0
          ? `${scan.findings.length} breaking API change(s) detected`
          : "No breaking changes detected",
      summary,
      annotations: firstBatch,
    },
  });

  // Batch remaining annotations in updates (GitHub limit: 50 per call)
  for (let i = MAX_ANNOTATIONS_PER_UPDATE; i < annotations.length; i += MAX_ANNOTATIONS_PER_UPDATE) {
    const batch = annotations.slice(i, i + MAX_ANNOTATIONS_PER_UPDATE);
    await octokit.checks.update({
      owner,
      repo,
      check_run_id: checkRun.id,
      output: {
        title:
          scan.findings.length > 0
            ? `${scan.findings.length} breaking API change(s) detected`
            : "No breaking changes detected",
        summary,
        annotations: batch,
      },
    });
  }
}

export async function createFailedCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  error: string,
): Promise<void> {
  await octokit.checks.create({
    owner,
    repo,
    name: "Evergreen: Scan",
    head_sha: sha,
    status: "completed",
    conclusion: "failure",
    output: {
      title: "Evergreen scan failed",
      summary: `The scan could not complete:\n\n\`\`\`\n${error}\n\`\`\``,
    },
  });
}
