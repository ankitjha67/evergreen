import { describe, it, expect } from "vitest";
import { diffOpenAPISchemas, generateSpecFromDiff, OpenAPISchema } from "../src/changefeed/openapi-diff.js";

const baseBefore: OpenAPISchema = {
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        parameters: [{ name: "limit", in: "query", required: false }],
        responses: { "200": { description: "OK" }, "400": { description: "Bad Request" } },
      },
      post: {
        operationId: "createUser",
        responses: { "201": { description: "Created" } },
      },
    },
    "/users/{id}": {
      get: {
        operationId: "getUser",
        parameters: [{ name: "id", in: "path", required: true }],
        responses: { "200": { description: "OK" } },
      },
      delete: {
        operationId: "deleteUser",
        responses: { "204": { description: "No Content" } },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
        },
      },
      Status: {
        type: "string",
        enum: ["active", "inactive", "pending"],
      },
    },
  },
};

describe("diffOpenAPISchemas", () => {
  it("detects removed paths", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: { "/users": baseBefore.paths!["/users"] },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const removed = diffs.filter((d) => d.type === "path_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].path).toBe("/users/{id}");
  });

  it("detects removed methods", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: {
        ...baseBefore.paths,
        "/users": { get: baseBefore.paths!["/users"].get },
      },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const removed = diffs.filter((d) => d.type === "method_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].method).toBe("post");
  });

  it("detects removed parameters", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: {
        ...baseBefore.paths,
        "/users": {
          ...baseBefore.paths!["/users"],
          get: { ...baseBefore.paths!["/users"].get as any, parameters: [] },
        },
      },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const removed = diffs.filter((d) => d.type === "param_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].detail).toContain("limit");
  });

  it("detects newly required parameters", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: {
        ...baseBefore.paths,
        "/users": {
          ...baseBefore.paths!["/users"],
          get: {
            ...baseBefore.paths!["/users"].get as any,
            parameters: [{ name: "limit", in: "query", required: true }],
          },
        },
      },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const required = diffs.filter((d) => d.type === "param_required");
    expect(required).toHaveLength(1);
    expect(required[0].detail).toContain("limit");
  });

  it("detects removed schema fields", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      components: {
        schemas: {
          ...baseBefore.components!.schemas,
          User: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
        },
      },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const removed = diffs.filter((d) => d.type === "schema_field_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].detail).toContain("User.email");
  });

  it("detects removed enum values", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      components: {
        schemas: {
          ...baseBefore.components!.schemas,
          Status: { type: "string", enum: ["active", "inactive"] },
        },
      },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const removed = diffs.filter((d) => d.type === "enum_value_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].detail).toContain("pending");
  });

  it("detects deprecated endpoints", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: {
        ...baseBefore.paths,
        "/users/{id}": {
          ...baseBefore.paths!["/users/{id}"],
          delete: { ...baseBefore.paths!["/users/{id}"].delete as any, deprecated: true },
        },
      },
    };
    const diffs = diffOpenAPISchemas(baseBefore, after);
    const deprecated = diffs.filter((d) => d.type === "deprecated");
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0].detail).toContain("DELETE");
  });

  it("returns empty for identical schemas", () => {
    const diffs = diffOpenAPISchemas(baseBefore, baseBefore);
    expect(diffs).toHaveLength(0);
  });
});

describe("generateSpecFromDiff", () => {
  it("generates a valid spec from diffs", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: { "/users": baseBefore.paths!["/users"] },
      components: {
        schemas: {
          User: {
            type: "object",
            properties: { id: { type: "string" } },
          },
        },
      },
    };

    const spec = generateSpecFromDiff(baseBefore, after, {
      vendor: "test",
      api: "test-api",
      version: "2.0.0",
    });

    expect(spec.specVersion).toBe("1");
    expect(spec.vendor).toBe("test");
    expect(spec.api).toBe("test-api");
    expect(spec.version).toBe("2.0.0");
    expect(spec.changes.length).toBeGreaterThan(0);
    for (const rule of spec.changes) {
      expect(rule.id).toMatch(/^test-diff-\d{3}$/);
      expect(rule.detect.patterns.length).toBeGreaterThan(0);
    }
  });

  it("throws for identical schemas", () => {
    expect(() => generateSpecFromDiff(baseBefore, baseBefore, {
      vendor: "test",
      api: "test-api",
      version: "1.0.0",
    })).toThrow("No breaking changes");
  });

  it("respects custom languages", () => {
    const after: OpenAPISchema = {
      ...baseBefore,
      paths: {},
    };

    const spec = generateSpecFromDiff(baseBefore, after, {
      vendor: "test",
      api: "test-api",
      version: "2.0.0",
      languages: ["python", "ruby"],
    });

    expect(spec.languages).toEqual(["python", "ruby"]);
  });
});
