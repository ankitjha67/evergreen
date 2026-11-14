import { describe, it, expect } from "vitest";
import {
  listTemplates,
  getTemplate,
  instantiateTemplate,
  formatTemplateLibrary,
} from "../src/templates.js";

describe("listTemplates", () => {
  it("returns all templates with no filter", () => {
    const lib = listTemplates();
    expect(lib.templates.length).toBeGreaterThanOrEqual(6);
    expect(lib.totalTemplates).toBe(lib.templates.length);
  });

  it("filters by language", () => {
    const lib = listTemplates({ language: "typescript" });
    expect(lib.templates.length).toBeGreaterThan(0);
    for (const t of lib.templates) {
      expect(t.languages).toContain("typescript");
    }
  });

  it("filters by vendor", () => {
    const lib = listTemplates({ vendor: "stripe" });
    expect(lib.templates).toHaveLength(1);
    expect(lib.templates[0].vendor).toBe("stripe");
  });

  it("filters by tag", () => {
    const lib = listTemplates({ tag: "react" });
    expect(lib.templates.length).toBeGreaterThan(0);
    for (const t of lib.templates) {
      expect(t.tags.some((tag) => tag.includes("react"))).toBe(true);
    }
  });

  it("returns empty for non-matching filter", () => {
    const lib = listTemplates({ vendor: "nonexistent-vendor" });
    expect(lib.templates).toHaveLength(0);
  });
});

describe("getTemplate", () => {
  it("returns template by id", () => {
    const tpl = getTemplate("stripe/stripe-node");
    expect(tpl).not.toBeNull();
    expect(tpl!.vendor).toBe("stripe");
    expect(tpl!.api).toBe("stripe-node");
    expect(tpl!.rules.length).toBeGreaterThan(0);
  });

  it("returns null for unknown id", () => {
    expect(getTemplate("unknown/template")).toBeNull();
  });
});

describe("instantiateTemplate", () => {
  it("creates a spec from a template with version", () => {
    const spec = instantiateTemplate("openai/openai-node", "5.0.0");
    expect(spec.vendor).toBe("openai");
    expect(spec.api).toBe("openai-node");
    expect(spec.version).toBe("5.0.0");
    expect(spec.changes.length).toBeGreaterThan(0);
    expect(spec.specVersion).toBeDefined();
  });

  it("applies overrides", () => {
    const spec = instantiateTemplate("stripe/stripe-node", "2025.1", {
      title: "Custom Title",
      languages: ["python"],
    });
    expect(spec.title).toBe("Custom Title");
    expect(spec.languages).toEqual(["python"]);
  });

  it("throws for unknown template", () => {
    expect(() => instantiateTemplate("unknown/x", "1.0")).toThrow("Template not found");
  });
});

describe("formatTemplateLibrary", () => {
  it("formats empty library", () => {
    const formatted = formatTemplateLibrary({ templates: [], totalTemplates: 0 });
    expect(formatted).toContain("No templates");
  });

  it("formats library with templates", () => {
    const lib = listTemplates();
    const formatted = formatTemplateLibrary(lib);
    expect(formatted).toContain("Spec Template Library");
    expect(formatted).toContain("stripe/stripe-node");
    expect(formatted).toContain("from-template");
  });
});
