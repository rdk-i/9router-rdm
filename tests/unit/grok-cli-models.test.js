import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: vi.fn(),
}));

import { refreshProviderCredentials } from "../../open-sse/services/oauthCredentialManager.js";
import {
  parseGrokCliModels,
  resolveGrokCliModels,
} from "../../open-sse/services/grokCliModels.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Grok CLI live models", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes official model metadata", () => {
    expect(parseGrokCliModels({
      models: [{
        model_id: "grok-build",
        display_name: "Grok Build",
        apiBackend: "responses",
        contextWindow: 500000,
        maxOutputTokens: 64000,
        supportsBackendSearch: true,
        supportsReasoningEffort: true,
        reasoningEffort: "xhigh",
        reasoningEfforts: [{ id: "deep", value: "xhigh", label: "Deep" }],
        compactionAtTokens: 450000,
        compactionsRemaining: 2,
        streamToolCalls: true,
        supported_in_api: false,
        _meta: {
          apiBackend: "messages",
          contextWindow: 1,
          maxOutputTokens: 2,
          supportsBackendSearch: false,
          supportsReasoningEffort: false,
          reasoningEffort: "low",
          reasoningEfforts: ["low"],
          compactionAtTokens: false,
          compactionsRemaining: 0,
          streamToolCalls: false,
        },
      }],
    })).toEqual([
      expect.objectContaining({
        id: "grok-build",
        name: "Grok Build",
        apiBackend: "responses",
        contextWindow: 500000,
        contextLength: 500000,
        maxOutputTokens: 64000,
        supportsBackendSearch: true,
        supportsReasoningEffort: true,
        reasoningEffort: "xhigh",
        reasoningEfforts: [{ id: "deep", value: "xhigh", label: "Deep" }],
        compactionAtTokens: 450000,
        compactionsRemaining: 2,
        streamToolCalls: true,
        supported_in_api: false,
        _meta: expect.objectContaining({ apiBackend: "messages" }),
      }),
    ]);
  });

  it("normalizes capability metadata from _meta without inventing values", () => {
    const [metaModel, unknown] = parseGrokCliModels({
      data: [
        {
          name: "Meta Model",
          _meta: {
            model: "meta-model",
            apiBackend: "messages",
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsBackendSearch: false,
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: ["low", { value: "high" }],
            compactionAtTokens: true,
            compactionsRemaining: false,
            streamToolCalls: false,
          },
        },
        { model: "unknown-model", context_window: 131072 },
      ],
    });

    expect(metaModel).toEqual(expect.objectContaining({
      id: "meta-model",
      name: "Meta Model",
      apiBackend: "messages",
      contextWindow: 262144,
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsBackendSearch: false,
      supportsReasoningEffort: true,
      reasoningEffort: "high",
      reasoningEfforts: ["low", { value: "high" }],
      compactionAtTokens: true,
      compactionsRemaining: false,
      streamToolCalls: false,
    }));
    expect(unknown).toEqual(expect.objectContaining({
      id: "unknown-model",
      contextWindow: 131072,
      contextLength: 131072,
    }));
    expect(unknown).not.toHaveProperty("supportsReasoningEffort");
    expect(unknown).not.toHaveProperty("reasoningEffort");
    expect(unknown).not.toHaveProperty("reasoningEfforts");
  });

  it("refreshes and retries through selected proxy", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "grok-build" }] }));
    const onCredentialsRefreshed = vi.fn();
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    };
    refreshProviderCredentials.mockResolvedValue({ accessToken: "new-token" });

    const result = await resolveGrokCliModels({
      accessToken: "old-token",
      refreshToken: "refresh-token",
      providerSpecificData: { email: "user@example.com" },
    }, { fetchFn, proxyOptions, onCredentialsRefreshed });

    expect(result.models).toEqual([
      expect.objectContaining({
        id: "grok-build",
        contextLength: 500000,
        maxOutputTokens: 64000,
      }),
    ]);
    expect(refreshProviderCredentials).toHaveBeenCalledWith(
      "grok-cli",
      expect.any(Object),
      expect.anything(),
      proxyOptions,
    );
    expect(onCredentialsRefreshed).toHaveBeenCalledWith({ accessToken: "new-token" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][2]).toBe(proxyOptions);
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe("Bearer new-token");
    expect(fetchFn.mock.calls[1][1].headers["x-grok-client-version"]).toBe("0.2.99");
  });
});
