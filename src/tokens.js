// Token estimation (approximate, for previews) + token statistics from the
// exact usage numbers Anthropic returns on every response.

// Rough token estimate: CJK chars count heavier than Latin text. Labelled "≈"
// everywhere in the UI — the real numbers come from response.usage.
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.5 + rest / 4);
}

export function estimateRequestTokens(body) {
  if (!body || typeof body !== "object") return 0;
  let chars = "";
  for (const blk of body.system || []) chars += blk.text || "";
  for (const m of body.messages || []) {
    const content = Array.isArray(m.content) ? m.content : [{ text: m.content }];
    for (const b of content) chars += b.text || JSON.stringify(b.input || "") || "";
  }
  for (const t of body.tools || [])
    chars += (t.description || "") + JSON.stringify(t.input_schema || "");
  return estimateTokens(chars);
}

export function tokenStats(usage = {}, { inputIncludesCache = false } = {}) {
  const cacheRead = usage.cache_read_input_tokens || 0;
  const input = inputIncludesCache
    ? Math.max(0, (usage.input_tokens || 0) - cacheRead)
    : usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = inputIncludesCache ? 0 : usage.cache_creation_input_tokens || 0;
  const totalInput = inputIncludesCache ? usage.input_tokens || 0 : input + cacheWrite + cacheRead;
  const cacheHitRate = totalInput ? cacheRead / totalInput : 0;
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    totalInput,
    cacheHitRate,
  };
}
