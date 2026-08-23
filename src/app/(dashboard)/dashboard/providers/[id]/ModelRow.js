import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";
import { useModelCaps } from "@/shared/hooks/useModelCaps";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }) {
  const { getCaps, getOverride, setOverride } = useModelCaps();
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  const effectiveCaps = caps || getCaps(fullModel) || {};
  const overrides = getOverride(fullModel);
  const inputCapabilities = [
    { key: "text", icon: "text_fields", label: "Text input" },
    { key: "vision", icon: "image", label: "Image input" },
    { key: "videoInput", icon: "movie", label: "Video input" },
  ];

  const toggleInputCapability = async (event, capability) => {
    event.preventDefault();
    event.stopPropagation();
    const current = effectiveCaps[capability] === true;
    await setOverride(fullModel, { ...overrides, [capability]: !current });
  };

  const resetInputCapabilities = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await setOverride(fullModel, { text: null, vision: null, videoInput: null });
  };

  const hasOverride = Object.values(overrides).some((value) => value === true || value === false);

  return (
    <div className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          className="material-symbols-outlined shrink-0 text-base"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">{displayModel}</code>
          <span className="flex min-w-0 items-center text-[9px] gap-1 pl-1">
            {model.name && <span className="truncate text-[9px] italic text-text-muted/70">{model.name}</span>}
            <CapacityBadges caps={effectiveCaps} colorOverride="text-text-muted/70" size={12} />
            <span className="inline-flex items-center gap-0.5 ml-1" aria-label="Input capabilities">
              {inputCapabilities.map((item) => {
                const active = effectiveCaps[item.key] === true;
                const manual = overrides[item.key] === true || overrides[item.key] === false;
                return (
                  <span
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    title={`${item.label}: ${active ? "enabled" : "disabled"}${manual ? " (manual override)" : " (detected/default)"}. Click to toggle.`}
                    aria-label={`${item.label} ${active ? "enabled" : "disabled"}`}
                    onClick={(event) => toggleInputCapability(event, item.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") toggleInputCapability(event, item.key);
                    }}
                    className={`material-symbols-outlined leading-none rounded px-0.5 transition-colors ${active ? "text-primary" : "text-text-muted/35"} ${manual ? "ring-1 ring-primary/40" : ""}`}
                    style={{ fontSize: "12px" }}
                  >
                    {item.icon}
                  </span>
                );
              })}
              {hasOverride && (
                <span
                  role="button"
                  tabIndex={0}
                  title="Reset input capabilities to detected/default"
                  aria-label="Reset input capabilities"
                  onClick={resetInputCapabilities}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") resetInputCapabilities(event);
                  }}
                  className="material-symbols-outlined leading-none text-text-muted hover:text-primary rounded px-0.5"
                  style={{ fontSize: "11px" }}
                >
                  restart_alt
                </span>
              )}
            </span>
          </span>
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <button
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom ? (
          <button
            onClick={onDeleteAlias}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : onDisable ? (
          <button
            onClick={onDisable}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Disable this model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
