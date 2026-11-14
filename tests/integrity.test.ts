import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import {
  computeSHA256,
  computeFileChecksum,
  generateChecksumManifest,
  saveChecksumManifest,
  loadChecksumManifest,
  verifySpecs,
} from "../src/changefeed/integrity.js";

const TMP = resolve("test-tmp-integrity");

describe("computeSHA256", () => {
  it("produces consistent hashes", () => {
    const hash1 = computeSHA256("hello world");
    const hash2 = computeSHA256("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = computeSHA256("hello");
    const hash2 = computeSHA256("world");
    expect(hash1).not.toBe(hash2);
  });
});

describe("checksum manifest", () => {
  it("generates and verifies checksums", async () => {
    await mkdir(TMP, { recursive: true });
    await writeFile(join(TMP, "spec-a.json"), '{"test": "a"}', "utf8");
    await writeFile(join(TMP, "spec-b.json"), '{"test": "b"}', "utf8");

    const manifest = await generateChecksumManifest(TMP, ["spec-a.json", "spec-b.json"]);
    expect(manifest.version).toBe("1");
    expect(manifest.checksums).toHaveLength(2);
    expect(manifest.checksums[0].sha256).toHaveLength(64);

    await saveChecksumManifest(TMP, manifest);
    const loaded = await loadChecksumManifest(TMP);
    expect(loaded).not.toBeNull();
    expect(loaded!.checksums).toHaveLength(2);

    // Verify all ok
    const results = await verifySpecs(TMP, ["spec-a.json", "spec-b.json"]);
    expect(results.every((r) => r.status === "ok")).toBe(true);

    await rm(TMP, { recursive: true, force: true });
  });

  it("detects modified specs", async () => {
    await mkdir(TMP, { recursive: true });
    await writeFile(join(TMP, "spec.json"), '{"v":1}', "utf8");

    const manifest = await generateChecksumManifest(TMP, ["spec.json"]);
    await saveChecksumManifest(TMP, manifest);

    // Modify the file
    await writeFile(join(TMP, "spec.json"), '{"v":2}', "utf8");

    const results = await verifySpecs(TMP, ["spec.json"]);
    expect(results[0].status).toBe("mismatch");
    expect(results[0].expected).toBeDefined();
    expect(results[0].actual).toBeDefined();

    await rm(TMP, { recursive: true, force: true });
  });

  it("reports new specs not in manifest", async () => {
    await mkdir(TMP, { recursive: true });
    await writeFile(join(TMP, "existing.json"), "{}", "utf8");

    const manifest = await generateChecksumManifest(TMP, ["existing.json"]);
    await saveChecksumManifest(TMP, manifest);

    await writeFile(join(TMP, "new-spec.json"), "{}", "utf8");
    const results = await verifySpecs(TMP, ["existing.json", "new-spec.json"]);

    const newSpec = results.find((r) => r.file === "new-spec.json");
    expect(newSpec?.status).toBe("new");

    await rm(TMP, { recursive: true, force: true });
  });

  it("returns all-new when no manifest exists", async () => {
    await mkdir(TMP, { recursive: true });
    await writeFile(join(TMP, "spec.json"), "{}", "utf8");

    const results = await verifySpecs(TMP, ["spec.json"]);
    expect(results[0].status).toBe("new");

    await rm(TMP, { recursive: true, force: true });
  });
});
