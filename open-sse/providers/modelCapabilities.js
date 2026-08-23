const INPUT_CAPABILITIES = ["text", "vision", "videoInput"];

export function capabilityKey(provider, model) {
  return `${provider}/${model}`;
}

export function normalizeCapabilityOverrides(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const key of INPUT_CAPABILITIES) {
    if (value[key] === true || value[key] === false || value[key] === null) {
      out[key] = value[key];
    }
  }
  return out;
}

export function resolveEffectiveCapabilities(detected, overrides) {
  const normalized = normalizeCapabilityOverrides(overrides);
  const result = { ...(detected || {}) };
  for (const key of INPUT_CAPABILITIES) {
    if (normalized[key] === true || normalized[key] === false) {
      result[key] = normalized[key];
    }
  }
  return result;
}

let runtimeOverrides = {};

export function setRuntimeCapabilityOverrides(overrides) {
  runtimeOverrides = overrides && typeof overrides === "object" ? overrides : {};
}

export function getRuntimeCapabilityOverride(provider, model) {
  const direct = runtimeOverrides[capabilityKey(provider, model)];
  if (direct) return normalizeCapabilityOverrides(direct);
  return {};
}

export function getInputCapabilities() {
  return [...INPUT_CAPABILITIES];
}
