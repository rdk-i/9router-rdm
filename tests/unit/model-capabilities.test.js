import { describe, expect, it } from "vitest";
import {
  capabilityKey,
  normalizeCapabilityOverrides,
  resolveEffectiveCapabilities,
  setRuntimeCapabilityOverrides,
} from "../../open-sse/providers/modelCapabilities.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { augmentModelsWithCapacityAdapter } from "../../open-sse/services/capacityAdapter.js";

describe("dynamic model input capabilities", () => {
  it("builds a stable provider/model key", () => {
    expect(capabilityKey("9router", "openrouter/stealth/ox-alpha")).toBe(
      "9router/openrouter/stealth/ox-alpha",
    );
  });

  it("keeps detected capabilities when no manual override exists", () => {
    const detected = { text: true, vision: true, videoInput: true };
    expect(resolveEffectiveCapabilities(detected, {})).toMatchObject(detected);
  });

  it("lets manual overrides change only selected input modalities", () => {
    const detected = { text: true, vision: false, videoInput: false };
    const overrides = normalizeCapabilityOverrides({ vision: true });
    expect(resolveEffectiveCapabilities(detected, overrides)).toMatchObject({
      text: true,
      vision: true,
      videoInput: false,
    });
  });

  it("normalizes null and unknown override values", () => {
    expect(normalizeCapabilityOverrides({ vision: null, videoInput: "true", nope: true })).toEqual({
      vision: null,
    });
  });

  it("applies a persisted override to runtime capability resolution", () => {
    setRuntimeCapabilityOverrides({
      "9router/openrouter/stealth/ox-alpha": { vision: true, videoInput: true },
    });
    expect(getCapabilitiesForModel("9router", "openrouter/stealth/ox-alpha")).toMatchObject({
      vision: true,
      videoInput: true,
    });
    expect(augmentModelsWithCapacityAdapter(
      ["9router/openrouter/stealth/ox-alpha"],
      new Set(["vision"]),
      { capacityAdapter: { vision: { enabled: true, models: ["cx/gpt-5.6-luna"] } } },
    )).toEqual(["9router/openrouter/stealth/ox-alpha"]);
    setRuntimeCapabilityOverrides({});
  });
});
