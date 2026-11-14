// FR-01.3 P1 - Spec integrity verification: SHA-256 checksums for fetched specs
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";

export interface SpecChecksum {
  file: string;
  sha256: string;
  size: number;
  verifiedAt: string;
}

export interface ChecksumManifest {
  version: "1";
  generatedAt: string;
  checksums: SpecChecksum[];
}

export function computeSHA256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function computeFileChecksum(filePath: string): Promise<SpecChecksum> {
  const content = await readFile(filePath);
  return {
    file: basename(filePath),
    sha256: computeSHA256(content),
    size: content.length,
    verifiedAt: new Date().toISOString(),
  };
}

export async function generateChecksumManifest(specsDir: string, specFiles: string[]): Promise<ChecksumManifest> {
  const checksums: SpecChecksum[] = [];
  for (const file of specFiles) {
    const checksum = await computeFileChecksum(join(specsDir, file));
    checksums.push(checksum);
  }
  return {
    version: "1",
    generatedAt: new Date().toISOString(),
    checksums,
  };
}

export async function saveChecksumManifest(specsDir: string, manifest: ChecksumManifest): Promise<string> {
  const path = join(specsDir, "checksums.json");
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
  return path;
}

export async function loadChecksumManifest(specsDir: string): Promise<ChecksumManifest | null> {
  try {
    const raw = await readFile(join(specsDir, "checksums.json"), "utf8");
    return JSON.parse(raw) as ChecksumManifest;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  file: string;
  status: "ok" | "mismatch" | "missing" | "new";
  expected?: string;
  actual?: string;
}

export async function verifySpecs(specsDir: string, specFiles: string[]): Promise<VerifyResult[]> {
  const manifest = await loadChecksumManifest(specsDir);
  if (!manifest) {
    return specFiles.map((f) => ({ file: f, status: "new" as const }));
  }

  const checksumMap = new Map(manifest.checksums.map((c) => [c.file, c]));
  const results: VerifyResult[] = [];

  for (const file of specFiles) {
    const expected = checksumMap.get(file);
    if (!expected) {
      results.push({ file, status: "new" });
      continue;
    }

    try {
      const actual = await computeFileChecksum(join(specsDir, file));
      if (actual.sha256 === expected.sha256) {
        results.push({ file, status: "ok" });
      } else {
        results.push({
          file,
          status: "mismatch",
          expected: expected.sha256,
          actual: actual.sha256,
        });
      }
    } catch {
      results.push({ file, status: "missing" });
    }
  }

  // Check for specs in manifest but not in current files
  for (const [file] of checksumMap) {
    if (!specFiles.includes(file)) {
      results.push({ file, status: "missing" });
    }
  }

  return results;
}
