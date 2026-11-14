// FR-09.1 / FR-04.1 - Shared tool implementations for the provider-agnostic agent loop.
// Tool surface: Read, Edit, Write, Grep, Glob - no Bash, no network.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fg from "fast-glob";
import { ToolDef, ToolCall, ToolResult } from "./types.js";

const execFileAsync = promisify(execFile);

export const MIGRATION_TOOLS: ToolDef[] = [
  {
    name: "Read",
    description: "Read the contents of a file. Returns the file text.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "Edit",
    description: "Replace an exact string in a file with a new string. The old_string must appear exactly once in the file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path to edit" },
        old_string: { type: "string", description: "Exact text to find and replace (must be unique in the file)" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "Write",
    description: "Write content to a file, creating it (and parent directories) if it does not exist, or overwriting if it does.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path to write" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "Grep",
    description: "Search for a regex pattern across files. Returns matching lines with file:line format.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        glob: { type: "string", description: "Glob pattern to filter files (e.g. '**/*.ts')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern. Returns a list of matching file paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. 'src/**/*.js')" },
      },
      required: ["pattern"],
    },
  },
];

export async function executeTool(call: ToolCall, repoRoot: string): Promise<ToolResult> {
  const args = call.arguments;
  try {
    switch (call.name) {
      case "Read":
        return { toolCallId: call.id, content: await toolRead(repoRoot, args.path as string) };
      case "Edit":
        return { toolCallId: call.id, content: await toolEdit(repoRoot, args.path as string, args.old_string as string, args.new_string as string) };
      case "Write":
        return { toolCallId: call.id, content: await toolWrite(repoRoot, args.path as string, args.content as string) };
      case "Grep":
        return { toolCallId: call.id, content: await toolGrep(repoRoot, args.pattern as string, args.glob as string | undefined) };
      case "Glob":
        return { toolCallId: call.id, content: await toolGlob(repoRoot, args.pattern as string) };
      default:
        return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
    }
  } catch (e: any) {
    return { toolCallId: call.id, content: `Error: ${e.message}`, isError: true };
  }
}

async function toolRead(root: string, filePath: string): Promise<string> {
  const abs = join(root, filePath);
  assertInside(root, abs);
  return await readFile(abs, "utf8");
}

async function toolEdit(root: string, filePath: string, oldStr: string, newStr: string): Promise<string> {
  const abs = join(root, filePath);
  assertInside(root, abs);
  const content = await readFile(abs, "utf8");
  const idx = content.indexOf(oldStr);
  if (idx === -1) return `Error: old_string not found in ${filePath}`;
  if (content.indexOf(oldStr, idx + 1) !== -1) return `Error: old_string appears multiple times in ${filePath}`;
  await writeFile(abs, content.slice(0, idx) + newStr + content.slice(idx + oldStr.length), "utf8");
  return `Edited ${filePath}`;
}

async function toolWrite(root: string, filePath: string, content: string): Promise<string> {
  const abs = join(root, filePath);
  assertInside(root, abs);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return `Wrote ${filePath}`;
}

async function toolGrep(root: string, pattern: string, glob?: string): Promise<string> {
  if (pattern.length > 500) throw new Error("Regex pattern too long (max 500 chars)");
  const files = await fg(glob ?? "**/*", { cwd: root, dot: false, ignore: ["**/node_modules/**", "**/.git/**"] });
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (e: any) {
    throw new Error(`Invalid regex: ${e.message}`);
  }
  const results: string[] = [];
  for (const f of files.slice(0, 500)) {
    try {
      const content = await readFile(join(root, f), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${f}:${i + 1}: ${lines[i]}`);
        }
      }
    } catch { /* skip binary/unreadable */ }
    if (results.length > 200) break;
  }
  return results.length > 0 ? results.join("\n") : "No matches found.";
}

async function toolGlob(root: string, pattern: string): Promise<string> {
  const files = await fg(pattern, { cwd: root, dot: false, ignore: ["**/node_modules/**", "**/.git/**"] });
  return files.length > 0 ? files.join("\n") : "No files matched.";
}

function assertInside(root: string, abs: string): void {
  const normRoot = resolve(root);
  const normAbs = resolve(abs);
  const sep = normRoot.includes("\\") ? "\\" : "/";
  const prefix = normRoot.endsWith(sep) ? normRoot : normRoot + sep;
  if (normAbs !== normRoot && !normAbs.startsWith(prefix)) {
    throw new Error(`Path escapes repo root: ${abs}`);
  }
}
