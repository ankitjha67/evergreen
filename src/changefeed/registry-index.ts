// FR-01.3 P1 - Spec registry index: fetch available specs from a remote registry URL.
// An index is a JSON file listing specs with their download URLs.
import { fetchSpec, FetchResult } from "./fetch.js";

export interface RegistryIndexEntry {
  ref: string;
  url: string;
  vendor: string;
  api: string;
  version: string;
  title?: string;
  languages?: string[];
}

export interface RegistryIndex {
  version: "1";
  registry: string;
  specs: RegistryIndexEntry[];
}

export interface FetchFromIndexResult {
  fetched: FetchResult[];
  skipped: string[];
  errors: { ref: string; error: string }[];
}

export async function fetchRegistryIndex(indexUrl: string): Promise<RegistryIndex> {
  if (!/^https?:\/\//i.test(indexUrl)) {
    throw new Error(`Invalid registry URL: ${indexUrl} - must be http:// or https://`);
  }

  const res = await fetch(indexUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch registry index from ${indexUrl}: ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  if (!body || body.version !== "1" || !Array.isArray(body.specs)) {
    throw new Error(`Invalid registry index format from ${indexUrl} - expected { version: "1", specs: [...] }`);
  }

  for (const entry of body.specs) {
    if (!entry.ref || !entry.url) {
      throw new Error(`Registry index entry missing required fields (ref, url): ${JSON.stringify(entry)}`);
    }
  }

  return body as RegistryIndex;
}

export async function fetchFromIndex(
  indexUrl: string,
  outDir: string,
  opts: { lang?: string; vendor?: string } = {},
): Promise<FetchFromIndexResult> {
  const index = await fetchRegistryIndex(indexUrl);

  let entries = index.specs;
  if (opts.lang) {
    entries = entries.filter((e) => e.languages?.includes(opts.lang!));
  }
  if (opts.vendor) {
    entries = entries.filter((e) => e.vendor === opts.vendor);
  }

  const fetched: FetchResult[] = [];
  const skipped: string[] = [];
  const errors: { ref: string; error: string }[] = [];

  for (const entry of entries) {
    try {
      const result = await fetchSpec(entry.url, outDir);
      fetched.push(result);
    } catch (e: any) {
      errors.push({ ref: entry.ref, error: e.message });
    }
  }

  return { fetched, skipped, errors };
}
