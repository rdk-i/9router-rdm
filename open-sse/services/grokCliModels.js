import {
  GROK_CLI_BASE_URL,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_MODEL,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../config/grokCli.js";
import { refreshProviderCredentials } from "./oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const MODELS_URL = `${GROK_CLI_BASE_URL}/models`;

function modelEntries(data) {
  const value = Array.isArray(data) ? data : data?.data ?? data?.models ?? data?.results ?? [];
  if (Array.isArray(value)) return value.map((item) => [null, item]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function firstValid(item, meta, keys, normalize) {
  for (const source of [item, meta]) {
    if (!source) continue;
    for (const key of keys) {
      if (!(key in source)) continue;
      const value = normalize(source[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function nonEmptyString(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : undefined;
}

function arrayValue(value) {
  return Array.isArray(value) ? structuredClone(value) : undefined;
}

function compactionValue(value) {
  if (typeof value === "boolean") return value;
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function assignCapability(model, item, meta, key, aliases, normalize) {
  const value = firstValid(item, meta, aliases, normalize);
  if (value !== undefined) model[key] = value;
}

export function parseGrokCliModels(data) {
  const seen = new Set();
  const models = [];

  for (const [key, raw] of modelEntries(data)) {
    const item = typeof raw === "string" ? { id: raw } : raw;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const meta = item._meta && typeof item._meta === "object" && !Array.isArray(item._meta)
      ? item._meta
      : null;
    const id = String(
      item.model ?? item.model_id ?? item.modelId ?? item.id ?? item.slug
        ?? meta?.model ?? meta?.modelId ?? key ?? item.name ?? "",
    ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const model = {
      ...item,
      id,
      name: item.display_name ?? item.displayName ?? item.name ?? id,
    };
    assignCapability(model, item, meta, "apiBackend", ["apiBackend", "api_backend"], nonEmptyString);
    assignCapability(
      model,
      item,
      meta,
      "contextWindow",
      ["contextWindow", "context_window", "contextLength", "context_length", "totalContextTokens"],
      positiveNumber,
    );
    if (model.contextWindow) model.contextLength = model.contextWindow;
    assignCapability(
      model,
      item,
      meta,
      "maxOutputTokens",
      ["maxOutputTokens", "max_output_tokens", "maxCompletionTokens", "max_completion_tokens"],
      positiveNumber,
    );
    assignCapability(
      model,
      item,
      meta,
      "supportsBackendSearch",
      ["supportsBackendSearch", "supports_backend_search"],
      booleanValue,
    );
    assignCapability(
      model,
      item,
      meta,
      "supportsReasoningEffort",
      ["supportsReasoningEffort", "supports_reasoning_effort"],
      booleanValue,
    );
    assignCapability(
      model,
      item,
      meta,
      "reasoningEffort",
      ["reasoningEffort", "reasoning_effort"],
      nonEmptyString,
    );
    assignCapability(
      model,
      item,
      meta,
      "reasoningEfforts",
      ["reasoningEfforts", "reasoning_efforts"],
      arrayValue,
    );
    assignCapability(
      model,
      item,
      meta,
      "compactionAtTokens",
      ["compactionAtTokens", "compaction_at_tokens"],
      compactionValue,
    );
    assignCapability(
      model,
      item,
      meta,
      "compactionsRemaining",
      ["compactionsRemaining", "compactions_remaining"],
      compactionValue,
    );
    assignCapability(
      model,
      item,
      meta,
      "streamToolCalls",
      ["streamToolCalls", "stream_tool_calls"],
      booleanValue,
    );
    if (id === GROK_CLI_MODEL) {
      model.contextWindow ||= 500000;
      model.contextLength ||= 500000;
      model.maxOutputTokens ||= 64000;
    }
    models.push(model);
  }

  return models;
}

function buildHeaders(accessToken, providerSpecificData = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-mode": "headless",
  };
  const email = providerSpecificData?.email;
  const userId = providerSpecificData?.userId || providerSpecificData?.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

export async function resolveGrokCliModels(credentials, options = {}) {
  const {
    fetchFn = proxyAwareFetch,
    log = console,
    proxyOptions = null,
    onCredentialsRefreshed,
  } = options;
  let accessToken = credentials?.accessToken;
  if (!accessToken) return { models: [], warning: "Grok CLI access token is missing." };

  const request = (token) => fetchFn(
    MODELS_URL,
    {
      method: "GET",
      headers: buildHeaders(token, credentials?.providerSpecificData),
    },
    proxyOptions,
  );

  try {
    let response = await request(accessToken);
    if ((response.status === 401 || response.status === 403) && credentials?.refreshToken) {
      const refreshed = await refreshProviderCredentials(
        "grok-cli",
        credentials,
        log,
        proxyOptions,
      );
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
        try {
          await onCredentialsRefreshed?.(refreshed);
        } catch (error) {
          log?.warn?.("Grok CLI credential persistence failed", error);
        }
        response = await request(accessToken);
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        models: [],
        warning: `Grok CLI model discovery failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }

    const models = parseGrokCliModels(await response.json());
    return models.length
      ? { models }
      : { models: [], warning: "Grok CLI returned no selectable models." };
  } catch (error) {
    return { models: [], warning: `Grok CLI model discovery failed: ${error.message}` };
  }
}
