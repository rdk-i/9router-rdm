import { describe, expect, it } from "vitest";
import {
  GrokCliCompatibilityError,
  translateGrokCliResponsesRequest,
} from "../../open-sse/executors/grok-cli-compat.js";

function translate(body, options = {}) {
  return translateGrokCliResponsesRequest(body, {
    model: "grok-4.5",
    supportsReasoningEffort: true,
    ...options,
  });
}

describe("Grok CLI Responses compatibility", () => {
  it("exports a request translator", async () => {
    const compat = await import("../../open-sse/executors/grok-cli-compat.js").catch(() => null);

    expect(compat?.translateGrokCliResponsesRequest).toBeTypeOf("function");
  });

  it("rebuilds top-level wire without mutating client input", () => {
    const input = {
      model: "grok-4.5",
      instructions: "System rules",
      input: [{ type: "message", role: "developer", content: "Developer rules", id: "msg_foreign" }],
      service_tier: "fast",
      prompt_cache_key: "thread-1",
      metadata: { private: true },
      parallel_tool_calls: false,
      temperature: 0.2,
      top_p: 0.8,
      max_output_tokens: 1234,
    };
    const snapshot = structuredClone(input);

    const result = translate(input);

    expect(input).toEqual(snapshot);
    expect(result.body).toEqual({
      model: "grok-4.5",
      input: [
        { type: "message", role: "system", content: "System rules" },
        { type: "message", role: "system", content: "Developer rules" },
      ],
      max_output_tokens: 1234,
      temperature: 0.2,
      top_p: 0.8,
      parallel_tool_calls: false,
      stream: true,
      store: false,
    });
    expect(result.diagnostics.droppedTopLevel).toEqual([
      "service_tier",
      "prompt_cache_key",
      "metadata",
    ]);
  });

  it("deduplicates identical leading instructions", () => {
    const { body } = translate({
      instructions: "same",
      input: [
        { type: "message", role: "system", content: "same" },
        { type: "message", role: "user", content: "next" },
      ],
    });

    expect(body.input).toEqual([
      { type: "message", role: "system", content: "same" },
      { type: "message", role: "user", content: "next" },
    ]);
    expect(body.instructions).toBeUndefined();
  });

  it("normalizes typed message content and removes output-only fields", () => {
    const { body } = translate({
      input: [{
        type: "message",
        role: "assistant",
        id: "msg_123",
        status: "completed",
        content: [
          { type: "output_text", text: "answer", annotations: [{ type: "url_citation" }] },
          { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" },
          { type: "unknown", text: "drop" },
        ],
        internal_chat_message_metadata_passthrough: { turn_id: "foreign" },
      }],
    });

    expect(body.input).toEqual([{
      type: "message",
      role: "assistant",
      content: [
        { type: "input_text", text: "answer" },
        { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" },
      ],
    }]);
  });

  it("normalizes string input and injects placeholder for empty input", () => {
    expect(translate({ input: "hello" }).body.input).toEqual([
      { type: "message", role: "user", content: "hello" },
    ]);
    expect(translate({ input: [] }).body.input).toEqual([
      { type: "message", role: "user", content: "..." },
    ]);
  });

  it("rejects unknown semantic input with an exact path", () => {
    expect(() => translate({
      input: [{ type: "future_semantic_item", payload: { encrypted: true } }],
    })).toThrowError(GrokCliCompatibilityError);

    try {
      translate({ input: [{ type: "future_semantic_item", payload: true }] });
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.path).toBe("input[0]");
      expect(error.message).toContain("future_semantic_item");
    }
  });
});
