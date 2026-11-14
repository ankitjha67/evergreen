// Spec diff viewer - compare two versions of a changefeed spec
import { BreakingChangeSpec, ChangeRule } from "./types.js";

export interface RuleDiff {
  ruleId: string;
  status: "added" | "removed" | "changed" | "unchanged";
  title: string;
  changes?: string[];
  before?: Partial<ChangeRule>;
  after?: Partial<ChangeRule>;
}

export interface SpecDiff {
  beforeRef: string;
  afterRef: string;
  metadataChanges: string[];
  rules: {
    added: RuleDiff[];
    removed: RuleDiff[];
    changed: RuleDiff[];
    unchanged: number;
  };
  summary: string;
}

export function diffSpecs(before: BreakingChangeSpec, after: BreakingChangeSpec): SpecDiff {
  const beforeRef = `${before.vendor}@${before.api}@${before.version}`;
  const afterRef = `${after.vendor}@${after.api}@${after.version}`;

  const metadataChanges: string[] = [];
  if (before.title !== after.title) metadataChanges.push(`title: "${before.title}" -> "${after.title}"`);
  if (before.docsUrl !== after.docsUrl) metadataChanges.push(`docsUrl: "${before.docsUrl ?? "(none)"}" -> "${after.docsUrl ?? "(none)"}"`);
  if (before.deadline !== after.deadline) metadataChanges.push(`deadline: "${before.deadline ?? "(none)"}" -> "${after.deadline ?? "(none)"}"`);

  const langsBefore = new Set(before.languages);
  const langsAfter = new Set(after.languages);
  const addedLangs = [...langsAfter].filter((l) => !langsBefore.has(l));
  const removedLangs = [...langsBefore].filter((l) => !langsAfter.has(l));
  if (addedLangs.length > 0) metadataChanges.push(`languages added: ${addedLangs.join(", ")}`);
  if (removedLangs.length > 0) metadataChanges.push(`languages removed: ${removedLangs.join(", ")}`);

  const beforeRules = new Map(before.changes.map((r) => [r.id, r]));
  const afterRules = new Map(after.changes.map((r) => [r.id, r]));

  const added: RuleDiff[] = [];
  const removed: RuleDiff[] = [];
  const changed: RuleDiff[] = [];
  let unchanged = 0;

  for (const [id, rule] of afterRules) {
    if (!beforeRules.has(id)) {
      added.push({ ruleId: id, status: "added", title: rule.title, after: rule });
    }
  }

  for (const [id, rule] of beforeRules) {
    if (!afterRules.has(id)) {
      removed.push({ ruleId: id, status: "removed", title: rule.title, before: rule });
    }
  }

  for (const [id, afterRule] of afterRules) {
    const beforeRule = beforeRules.get(id);
    if (!beforeRule) continue;

    const changes = diffRule(beforeRule, afterRule);
    if (changes.length > 0) {
      changed.push({ ruleId: id, status: "changed", title: afterRule.title, changes, before: beforeRule, after: afterRule });
    } else {
      unchanged++;
    }
  }

  const totalChanges = added.length + removed.length + changed.length;
  const summary = totalChanges === 0
    ? "No differences found between the two specs."
    : `${totalChanges} rule change(s): ${added.length} added, ${removed.length} removed, ${changed.length} modified, ${unchanged} unchanged.`;

  return { beforeRef, afterRef, metadataChanges, rules: { added, removed, changed, unchanged }, summary };
}

function diffRule(before: ChangeRule, after: ChangeRule): string[] {
  const changes: string[] = [];

  if (before.severity !== after.severity) changes.push(`severity: ${before.severity} -> ${after.severity}`);
  if (before.title !== after.title) changes.push(`title changed`);
  if (before.description !== after.description) changes.push(`description changed`);

  const patsBefore = JSON.stringify(before.detect.patterns);
  const patsAfter = JSON.stringify(after.detect.patterns);
  if (patsBefore !== patsAfter) changes.push(`detect patterns changed`);

  const fpBefore = JSON.stringify(before.detect.filePatterns);
  const fpAfter = JSON.stringify(after.detect.filePatterns);
  if (fpBefore !== fpAfter) changes.push(`file patterns changed`);

  if (before.replace.guidance !== after.replace.guidance) changes.push(`guidance changed`);
  if (before.replace.before !== after.replace.before) changes.push(`before example changed`);
  if (before.replace.after !== after.replace.after) changes.push(`after example changed`);

  return changes;
}

export function formatSpecDiff(diff: SpecDiff): string {
  const lines: string[] = [];

  lines.push(`Spec Diff: ${diff.beforeRef} -> ${diff.afterRef}`);
  lines.push("─".repeat(60));

  if (diff.metadataChanges.length > 0) {
    lines.push("\nMetadata changes:");
    for (const c of diff.metadataChanges) lines.push(`  ${c}`);
  }

  lines.push(`\n${diff.summary}`);

  if (diff.rules.added.length > 0) {
    lines.push("\nAdded rules:");
    for (const r of diff.rules.added) {
      lines.push(`  + [${r.after?.severity ?? "breaking"}] ${r.ruleId}: ${r.title}`);
      if (r.after?.detect?.patterns) lines.push(`    patterns: ${r.after.detect.patterns.join(", ")}`);
      if (r.after?.replace?.guidance) lines.push(`    guidance: ${r.after.replace.guidance.slice(0, 100)}`);
    }
  }

  if (diff.rules.removed.length > 0) {
    lines.push("\nRemoved rules:");
    for (const r of diff.rules.removed) {
      lines.push(`  - [${r.before?.severity ?? "breaking"}] ${r.ruleId}: ${r.title}`);
    }
  }

  if (diff.rules.changed.length > 0) {
    lines.push("\nModified rules:");
    for (const r of diff.rules.changed) {
      lines.push(`  ~ ${r.ruleId}: ${r.title}`);
      for (const c of r.changes ?? []) lines.push(`    ${c}`);
    }
  }

  return lines.join("\n");
}
