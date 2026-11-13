// FR-01.3 P1 — Fetch changefeed specs from HTTP(S) URLs.
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadSpec } from "./loader.js";
import type { BreakingChangeSpec } from "../types.js";

export interface FetchResult {
  spec: BreakingChangeSpec;
  savedTo: string;
  url: string;
}

export async function fetchSpec(url: string, outDir?: string): Promise<FetchResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Invalid spec URL: ${url} — must be http:// or https://`);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch spec from ${url}: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json") && !contentType.includes("text")) {
    throw new Error(`Unexpected content-type from ${url}: ${contentType} — expected JSON`);
  }

  const body = await res.text();

  // Validate before saving — parse + validate through the standard loader path
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Response from ${url} is not valid JSON`);
  }

  // Write to temp file, then validate through loadSpec
  const dir = outDir ?? join(process.cwd(), "specs");
  await mkdir(dir, { recursive: true });

  const filename = basename(new URL(url).pathname) || "fetched-spec.json";
  const dest = join(dir, filename.endsWith(".json") ? filename : `${filename}.json`);

  await writeFile(dest, JSON.stringify(parsed, null, 2), "utf8");

  // Validate through loader (throws SpecValidationError on problems)
  const spec = await loadSpec(dest);

  return { spec, savedTo: dest, url };
}
