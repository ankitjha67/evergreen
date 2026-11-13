// FR-08.4 — Bundled spec registry: loads all specs from specs/ at startup
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BreakingChangeSpec, specRef } from "../types.js";
import { loadSpec } from "../changefeed/loader.js";

export class SpecRegistry {
  private specs = new Map<string, BreakingChangeSpec>();

  async loadFromDirectory(dir: string): Promise<void> {
    const entries = await readdir(dir);
    const jsonFiles = entries.filter((e) => e.endsWith(".json"));
    for (const file of jsonFiles) {
      try {
        const spec = await loadSpec(join(dir, file));
        this.specs.set(specRef(spec), spec);
      } catch {
        // skip invalid specs at startup — log but don't crash
      }
    }
  }

  allSpecs(): BreakingChangeSpec[] {
    return [...this.specs.values()];
  }

  forLanguage(lang: string): BreakingChangeSpec[] {
    return this.allSpecs().filter((s) => s.languages.includes(lang));
  }

  get(ref: string): BreakingChangeSpec | undefined {
    return this.specs.get(ref);
  }

  get size(): number {
    return this.specs.size;
  }
}
