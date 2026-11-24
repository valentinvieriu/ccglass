import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, tokenStats } from "../src/tokens.js";

test("estimateTokens grows with length and counts CJK heavier", () => {
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("你好世界") >= estimateTokens("hihi"));
});

test("tokenStats preserves Anthropic token and cache counts without billing fields", () => {
  const stats = tokenStats({
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 9000,
  });
  assert.deepEqual(stats, {
    input: 1000,
    output: 500,
    cacheWrite: 2000,
    cacheRead: 9000,
    totalInput: 12000,
    cacheHitRate: 0.75,
  });
});

test("tokenStats handles responses without usage", () => {
  assert.deepEqual(tokenStats(), {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    totalInput: 0,
    cacheHitRate: 0,
  });
});
