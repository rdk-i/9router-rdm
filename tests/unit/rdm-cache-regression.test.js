import { describe, expect, it } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

describe("RDM nested cache regression", () => {
  it("canonicalizes OpenAI nested cached tokens", () => {
    expect(canonicalizeUsage({
      prompt_tokens: 63582,
      completion_tokens: 220,
      prompt_tokens_details: { cached_tokens: 61952 },
    })).toMatchObject({
      prompt_tokens: 63582,
      cached_tokens: 61952,
      completion_tokens: 220,
    });
  });

  it("preserves Claude cache fields for canonicalization", () => {
    expect(canonicalizeUsage({
      input_tokens: 100,
      output_tokens: 5,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 10,
    })).toMatchObject({
      prompt_tokens: 190,
      cached_tokens: 80,
      cache_creation_input_tokens: 10,
    });
  });
});
