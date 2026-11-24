import type { JsonObject, RequestRecord } from "../types";
import { buildFlow, type FlowItem } from "./flow";
import { oneLine } from "./format";
import { toolCategory } from "./timeline";

/** One row of a tool's parameter list, nested ones included. */
export interface ToolParam {
  /** Dotted path from the top of the input, e.g. "input.url" or "items[].id". */
  path: string;
  name: string;
  depth: number;
  type: string;
  required: boolean;
  description?: string;
  values?: unknown[];
  fallback?: unknown;
}

export interface ToolCall {
  item: FlowItem;
  /** Where the call's arguments disagree with the schema. */
  issues: string[];
}

export interface ToolEntry {
  id: string;
  /** Position in the request's tool list. */
  index: number;
  name: string;
  description: string;
  summary: string;
  schema: JsonObject;
  params: ToolParam[];
  /** True when the parameter list was cut short. */
  clipped: boolean;
  /** Size of the definition as sent: name, description and schema. */
  chars: number;
  share: number;
  tokens: number | null;
  category: string | null;
  calls: ToolCall[];
  failed: number;
}

export interface ToolsModel {
  tools: ToolEntry[];
  chars: number;
  /** Estimated tokens for all definitions, from Flow's split of the input. */
  tokens: number | null;
  /** Definitions as a share of everything sent. */
  inputShare: number | null;
  called: number;
  /** Tools the conversation calls that this request does not define. */
  undefinedTools: string[];
  /** Request settings that steer tool use, e.g. tool_choice. */
  settings: [name: string, value: string][];
}

export type ToolFilter = "all" | "called" | "unused";
export type ToolSort = "sent" | "size" | "calls" | "name";

const PARAM_LIMIT = 150;
const DEPTH_LIMIT = 4;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Short type name for a JSON Schema node: "string", "object[]", "string | null". */
export function schemaType(schema: unknown): string {
  if (!isObject(schema)) return "any";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return [...new Set(union.map(schemaType))].join(" | ") || "any";
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") {
    const item = schemaType(schema.items);
    return `${item.includes(" ") ? `(${item})` : item}[]`;
  }
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.properties) return "object";
  if (typeof schema.$ref === "string") return schema.$ref.split("/").pop() || "any";
  return "any";
}

/** Flattens an input schema into readable rows; `clipped` says rows were left out. */
export function schemaParams(schema: unknown): { params: ToolParam[]; clipped: boolean } {
  const params: ToolParam[] = [];
  let clipped = false;
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (!isObject(node) || !isObject(node.properties)) return;
    const required = new Set<string>(Array.isArray(node.required) ? node.required : []);
    for (const [name, child] of Object.entries(node.properties)) {
      if (params.length >= PARAM_LIMIT) {
        clipped = true;
        return;
      }
      const spec = isObject(child) ? child : {};
      const path = prefix + name;
      params.push({
        path,
        name,
        depth,
        type: schemaType(spec),
        required: required.has(name),
        description: typeof spec.description === "string" ? spec.description.trim() : undefined,
        values: Array.isArray(spec.enum) ? spec.enum : undefined,
        fallback: spec.default,
      });
      const items = isObject(spec.items) ? spec.items : undefined;
      const nested = spec.properties ? spec : items?.properties ? items : undefined;
      if (!nested) continue;
      if (depth + 1 >= DEPTH_LIMIT) clipped = true;
      else walk(nested, `${path}${nested === items ? "[]" : ""}.`, depth + 1);
    }
  };
  walk(schema, "", 0);
  return { params, clipped };
}

/** Compares a call's arguments with the top level of the tool's schema. */
export function callIssues(schema: unknown, text: string): string[] {
  if (!isObject(schema) || !isObject(schema.properties)) return [];
  let input: unknown;
  try {
    input = text.trim() ? JSON.parse(text) : {};
  } catch {
    return ["Arguments are not valid JSON"];
  }
  if (!isObject(input)) return ["Arguments are not a JSON object"];
  const issues: string[] = [];
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((name) => !(name in input));
  if (missing.length) issues.push(`Missing required: ${missing.join(", ")}`);
  // A schema may allow extra keys; one that does not name them cannot explain them.
  if (!schema.additionalProperties && !schema.patternProperties) {
    const unknown = Object.keys(input).filter((name) => !(name in schema.properties));
    if (unknown.length) issues.push(`Not in the schema: ${unknown.join(", ")}`);
  }
  return issues;
}

function firstLine(description: string) {
  const line = description.split("\n").find((text) => text.trim()) ?? "";
  return oneLine(line, 200);
}

const setting = (value: unknown) =>
  typeof value === "string" ? value : oneLine(JSON.stringify(value), 80);

export function buildTools(record: RequestRecord): ToolsModel {
  const definitions = record.parsed?.view?.tools ?? [];
  const flow = buildFlow(record);
  const calls = flow.items.filter((item) => item.kind === "tool");
  const sizes = definitions.map(
    (tool) =>
      JSON.stringify({ name: tool.name, description: tool.description, schema: tool.schema ?? {} })
        .length,
  );
  const chars = sizes.reduce((total, size) => total + size, 0);
  const section = flow.sections.find((part) => part.id === "tools");
  const tokens = section?.tokens ?? null;

  const tools: ToolEntry[] = definitions.map((tool, index) => {
    const schema = isObject(tool.schema) ? tool.schema : {};
    const description = String(tool.description || "").trim();
    const own = calls
      .filter((item) => item.tool === tool.name)
      .map((item) => ({ item, issues: callIssues(schema, item.text) }));
    const share = chars ? sizes[index] / chars : 0;
    return {
      id: `tool-${index}`,
      index,
      name: String(tool.name ?? ""),
      description,
      summary: firstLine(description),
      schema,
      ...schemaParams(schema),
      chars: sizes[index],
      share,
      tokens: tokens == null ? null : Math.round(tokens * share),
      category: toolCategory(tool.name),
      calls: own,
      failed: own.filter((call) => call.item.status === "error").length,
    };
  });

  const defined = new Set(tools.map((tool) => tool.name));
  const body = isObject(record.request?.body) ? record.request.body : {};
  return {
    tools,
    chars,
    tokens,
    inputShare: section?.share ?? null,
    called: tools.filter((tool) => tool.calls.length).length,
    undefinedTools: [
      ...new Set(
        calls
          .map((item) => item.tool)
          .filter((name): name is string => !!name && !defined.has(name)),
      ),
    ],
    settings: ["tool_choice", "parallel_tool_calls"]
      .filter((name) => body[name] !== undefined)
      .map((name) => [name, setting(body[name])]),
  };
}

export function matchesTool(filter: ToolFilter, query: string, tool: ToolEntry) {
  if (filter === "called" && !tool.calls.length) return false;
  if (filter === "unused" && tool.calls.length) return false;
  if (!query) return true;
  return [tool.name, tool.description, ...tool.params.map((param) => param.path)].some((text) =>
    text.toLowerCase().includes(query),
  );
}

export function sortTools(tools: ToolEntry[], sort: ToolSort) {
  if (sort === "sent") return tools;
  return [...tools].sort((a, b) =>
    sort === "size"
      ? b.chars - a.chars || a.index - b.index
      : sort === "calls"
        ? b.calls.length - a.calls.length || a.index - b.index
        : a.name.localeCompare(b.name),
  );
}
