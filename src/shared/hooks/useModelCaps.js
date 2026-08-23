"use client";

import { useState, useEffect, useCallback } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { capabilityKey, normalizeCapabilityOverrides, resolveEffectiveCapabilities } from "open-sse/providers/modelCapabilities.js";

// Module cache: one /api/models and capability override fetch shared by every instance.
let cache = null; // { byFull, byId, overrides }
let inflight = null;

function buildMaps(models) {
  const byFull = {};
  const byId = {};
  for (const m of models || []) {
    if (!m.caps) continue;
    if (m.fullModel) byFull[m.fullModel] = m.caps;
    if (m.routedModel) byFull[m.routedModel] = m.caps;
    if (m.model) byId[m.model] = m.caps;
  }
  return { byFull, byId };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function loadModelCaps() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = Promise.all([
    fetchJson("/api/models"),
    fetchJson("/api/models/capabilities"),
  ])
    .then(([modelsData, capabilityData]) => {
      cache = {
        ...buildMaps(modelsData.models),
        overrides: capabilityData.overrides || {},
      };
      return cache;
    })
    .catch(() => {
      // Keep null so a later mount can retry.
      return { byFull: {}, byId: {}, overrides: {} };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

function splitModelKey(key) {
  if (!key || !key.includes("/")) return { provider: null, model: key };
  const index = key.indexOf("/");
  return { provider: key.slice(0, index), model: key.slice(index + 1) };
}

function resolveOverride(overrides, key) {
  const { provider, model } = splitModelKey(key);
  if (!provider || !model) return {};
  return normalizeCapabilityOverrides(overrides[capabilityKey(provider, model)]);
}

// Resolve caps from a "provider/model" string or a bare model id.
function resolveCaps(byFull, byId, overrides, key) {
  if (!key) return null;
  let detected = byFull[key] ? { text: true, ...byFull[key] } : null;
  if (!detected) {
    const { provider, model } = splitModelKey(key);
    detected = byId[model] ? { text: true, ...byId[model] } : null;
    if (!detected) {
      const c = getCapabilitiesForModel(provider, model);
      detected = {
        text: true,
        vision: c.vision,
        videoInput: c.videoInput,
        search: c.search,
        reasoning: c.reasoning,
        contextWindow: c.contextWindow,
        maxOutput: c.maxOutput,
      };
    }
  }
  return resolveEffectiveCapabilities(detected, resolveOverride(overrides, key));
}

export function useModelCaps() {
  const [state, setState] = useState(() => cache || { byFull: {}, byId: {}, overrides: {} });

  useEffect(() => {
    let alive = true;
    loadModelCaps().then((next) => {
      if (alive) setState(next);
    });
    return () => { alive = false; };
  }, []);

  const getCaps = useCallback(
    (key) => resolveCaps(state.byFull, state.byId, state.overrides, key),
    [state],
  );

  const getOverride = useCallback(
    (key) => resolveOverride(state.overrides, key),
    [state],
  );

  const setOverride = useCallback(async (key, nextOverrides) => {
    const { provider, model } = splitModelKey(key);
    if (!provider || !model) return;
    const normalized = normalizeCapabilityOverrides(nextOverrides);
    const response = await fetch("/api/models/capabilities", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: provider, id: model, overrides: normalized }),
    });
    if (!response.ok) throw new Error(`capabilities ${response.status}`);
    const data = await response.json();
    const nextMap = { ...state.overrides };
    const storageKey = capabilityKey(provider, model);
    if (Object.keys(data.overrides || {}).length === 0 || Object.values(data.overrides || {}).every((value) => value === null)) {
      delete nextMap[storageKey];
    } else {
      nextMap[storageKey] = data.overrides;
    }
    const nextState = { ...state, overrides: nextMap };
    cache = nextState;
    setState(nextState);
  }, [state]);

  return { getCaps, getOverride, setOverride };
}
