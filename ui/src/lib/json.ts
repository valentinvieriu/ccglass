export function formatJson(text: string): { json: boolean; formatted: string } {
  if (!/^[\[{]/.test(text.trimStart())) return { json: false, formatted: text };
  try {
    return { json: true, formatted: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { json: false, formatted: text };
  }
}

export type JsonToken = {
  kind: "plain" | "key" | "string" | "number" | "boolean" | "null" | "punctuation";
  text: string;
};

export function tokenizeJson(text: string): JsonToken[] {
  const pattern =
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;
  const tokens: JsonToken[] = [];
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > position) tokens.push({ kind: "plain", text: text.slice(position, index) });
    const value = match[0];
    const kind: JsonToken["kind"] = value.startsWith('"')
      ? /^\s*:/.test(text.slice(index + value.length))
        ? "key"
        : "string"
      : value === "null"
        ? "null"
        : value === "true" || value === "false"
          ? "boolean"
          : /^-?\d/.test(value)
            ? "number"
            : "punctuation";
    tokens.push({ kind, text: value });
    position = index + value.length;
  }
  if (position < text.length) tokens.push({ kind: "plain", text: text.slice(position) });
  return tokens;
}
