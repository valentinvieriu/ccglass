// Reasonix adapter: OpenAI Chat Completions wire format with DeepSeek usage
// fields (prompt_cache_hit_tokens / prompt_cache_miss_tokens).

import { openai } from "./openai.js";

export function normUsageReasonix(u = {}) {
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? 0;
  const prompt = u.prompt_tokens ?? u.input_tokens ?? hit + miss ?? 0;
  const cached =
    hit ||
    u.cache_read_input_tokens ||
    u.input_tokens_details?.cached_tokens ||
    u.prompt_tokens_details?.cached_tokens ||
    0;
  return {
    input_tokens: prompt,
    output_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

export const reasonix = {
  ...openai,
  name: "reasonix",
  reassemble(raw, opts = {}) {
    return openai.reassemble(raw, { normalizeUsage: normUsageReasonix, ...opts });
  },
  usageStats(usage = {}) {
    return openai.usageStats(normUsageReasonix(usage));
  },
};
