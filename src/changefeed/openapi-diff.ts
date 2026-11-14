// FR-01.3 P1 - Generate changefeed specs from OpenAPI schema diffs
import { BreakingChangeSpec, ChangeRule } from "../types.js";

export interface OpenAPISchema {
  openapi?: string;
  swagger?: string;
  info: { title: string; version: string };
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, SchemaObject> };
}

interface PathItem {
  [method: string]: OperationObject | ParameterObject[] | undefined;
  parameters?: ParameterObject[];
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  parameters?: ParameterObject[];
  requestBody?: { content?: Record<string, { schema?: SchemaObject }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: SchemaObject }> }>;
  deprecated?: boolean;
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  schema?: SchemaObject;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  $ref?: string;
  enum?: unknown[];
}

export interface DiffOptions {
  vendor: string;
  api: string;
  version: string;
  languages?: string[];
  filePatterns?: string[];
}

interface DiffEntry {
  type: "path_removed" | "method_removed" | "param_removed" | "param_required" | "response_removed" | "schema_removed" | "schema_field_removed" | "enum_value_removed" | "deprecated";
  path?: string;
  method?: string;
  detail: string;
}

export function diffOpenAPISchemas(before: OpenAPISchema, after: OpenAPISchema): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  const beforePaths = before.paths ?? {};
  const afterPaths = after.paths ?? {};

  // Removed paths
  for (const path of Object.keys(beforePaths)) {
    if (!(path in afterPaths)) {
      diffs.push({ type: "path_removed", path, detail: `Endpoint ${path} removed` });
      continue;
    }

    const beforeItem = beforePaths[path];
    const afterItem = afterPaths[path];

    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const beforeOp = beforeItem[method] as OperationObject | undefined;
      const afterOp = afterItem[method] as OperationObject | undefined;

      if (beforeOp && !afterOp) {
        diffs.push({ type: "method_removed", path, method, detail: `${method.toUpperCase()} ${path} removed` });
        continue;
      }

      if (!beforeOp || !afterOp) continue;

      // Check for newly deprecated
      if (!beforeOp.deprecated && afterOp.deprecated) {
        diffs.push({ type: "deprecated", path, method, detail: `${method.toUpperCase()} ${path} deprecated` });
      }

      // Removed parameters
      const beforeParams = new Map((beforeOp.parameters ?? []).map((p) => [`${p.in}:${p.name}`, p]));
      const afterParams = new Map((afterOp.parameters ?? []).map((p) => [`${p.in}:${p.name}`, p]));

      for (const [key, param] of beforeParams) {
        if (!afterParams.has(key)) {
          diffs.push({ type: "param_removed", path, method, detail: `Parameter ${param.name} (${param.in}) removed from ${method.toUpperCase()} ${path}` });
        }
      }

      // Newly required parameters
      for (const [key, afterParam] of afterParams) {
        const beforeParam = beforeParams.get(key);
        if (beforeParam && !beforeParam.required && afterParam.required) {
          diffs.push({ type: "param_required", path, method, detail: `Parameter ${afterParam.name} now required on ${method.toUpperCase()} ${path}` });
        }
      }

      // Removed response codes
      const beforeResponses = Object.keys(beforeOp.responses ?? {});
      const afterResponses = new Set(Object.keys(afterOp.responses ?? {}));
      for (const code of beforeResponses) {
        if (!afterResponses.has(code)) {
          diffs.push({ type: "response_removed", path, method, detail: `Response ${code} removed from ${method.toUpperCase()} ${path}` });
        }
      }
    }
  }

  // Removed schemas
  const beforeSchemas = before.components?.schemas ?? {};
  const afterSchemas = after.components?.schemas ?? {};

  for (const name of Object.keys(beforeSchemas)) {
    if (!(name in afterSchemas)) {
      diffs.push({ type: "schema_removed", detail: `Schema ${name} removed` });
      continue;
    }

    const beforeProps = beforeSchemas[name].properties ?? {};
    const afterProps = afterSchemas[name].properties ?? {};

    for (const prop of Object.keys(beforeProps)) {
      if (!(prop in afterProps)) {
        diffs.push({ type: "schema_field_removed", detail: `Field ${name}.${prop} removed` });
      }
    }

    // Removed enum values
    const beforeEnum = beforeSchemas[name].enum;
    const afterEnum = afterSchemas[name].enum;
    if (beforeEnum && afterEnum) {
      const afterSet = new Set(afterEnum.map(String));
      for (const val of beforeEnum) {
        if (!afterSet.has(String(val))) {
          diffs.push({ type: "enum_value_removed", detail: `Enum value ${JSON.stringify(val)} removed from ${name}` });
        }
      }
    }
  }

  return diffs;
}

function diffEntryToRule(entry: DiffEntry, index: number, vendor: string): ChangeRule {
  const id = `${vendor}-diff-${String(index + 1).padStart(3, "0")}`;

  const severityMap: Record<DiffEntry["type"], "breaking" | "deprecation"> = {
    path_removed: "breaking",
    method_removed: "breaking",
    param_removed: "breaking",
    param_required: "breaking",
    response_removed: "breaking",
    schema_removed: "breaking",
    schema_field_removed: "breaking",
    enum_value_removed: "breaking",
    deprecated: "deprecation",
  };

  let patterns: string[] = [];
  if (entry.path) {
    const pathPattern = entry.path.replace(/\{[^}]+\}/g, "[^/]+");
    patterns.push(pathPattern.replace(/\//g, "\\/"));
  }
  if (entry.detail.includes(".")) {
    const fieldMatch = entry.detail.match(/(\w+\.\w+)/);
    if (fieldMatch) patterns.push(fieldMatch[1].replace(".", "\\."));
  }
  if (patterns.length === 0) {
    patterns.push(entry.detail.split(" ")[1] ?? entry.detail);
  }

  return {
    id,
    severity: severityMap[entry.type],
    title: entry.detail,
    description: `Detected from OpenAPI diff: ${entry.detail}`,
    detect: {
      patterns,
      filePatterns: ["**/*.ts", "**/*.js", "**/*.py", "**/*.rb", "**/*.go", "**/*.java"],
    },
    replace: {
      guidance: `Review and update code affected by: ${entry.detail}. Check the vendor's migration guide for the recommended replacement.`,
      before: entry.path ? `// Uses ${entry.path}` : undefined,
      after: entry.path ? `// ${entry.path} has been removed/changed` : undefined,
    },
  };
}

export function generateSpecFromDiff(before: OpenAPISchema, after: OpenAPISchema, options: DiffOptions): BreakingChangeSpec {
  const diffs = diffOpenAPISchemas(before, after);

  if (diffs.length === 0) {
    throw new Error("No breaking changes detected between the two schemas");
  }

  const rules = diffs.map((d, i) => {
    const rule = diffEntryToRule(d, i, options.vendor);
    if (options.filePatterns) rule.detect.filePatterns = options.filePatterns;
    return rule;
  });

  return {
    specVersion: "1",
    vendor: options.vendor,
    api: options.api,
    version: options.version,
    title: `${options.api} ${options.version} breaking changes (auto-generated from OpenAPI diff)`,
    languages: options.languages ?? ["javascript", "typescript"],
    changes: rules,
  };
}
