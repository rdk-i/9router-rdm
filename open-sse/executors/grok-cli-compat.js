const KNOWN_TOP_LEVEL = new Set([
  "model",
  "input",
  "instructions",
  "reasoning",
  "reasoning_effort",
  "include",
  "tools",
  "tool_choice",
  "text",
  "max_output_tokens",
  "temperature",
  "top_p",
  "parallel_tool_calls",
]);

const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

export class GrokCliCompatibilityError extends Error {
  constructor(message, path = null) {
    super(message);
    this.name = "GrokCliCompatibilityError";
    this.status = 400;
    this.path = path;
  }
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const normalized = content.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    if (["input_text", "output_text", "text"].includes(part.type) && typeof part.text === "string") {
      return [{ type: "input_text", text: part.text }];
    }
    if (part.type !== "input_image") return [];

    const image = { type: "input_image" };
    if (typeof part.image_url === "string" && part.image_url) image.image_url = part.image_url;
    if (typeof part.file_id === "string" && part.file_id) image.file_id = part.file_id;
    if (!image.image_url && !image.file_id) return [];
    if (["auto", "low", "high"].includes(part.detail)) image.detail = part.detail;
    return [image];
  });

  return normalized.length ? normalized : null;
}

function normalizeMessage(item) {
  const rawRole = typeof item.role === "string" ? item.role.trim().toLowerCase() : "";
  const role = rawRole === "developer" ? "system" : rawRole;
  if (!MESSAGE_ROLES.has(role)) return null;

  const content = normalizeMessageContent(item.content);
  if (content === null) return null;
  return { type: "message", role, content };
}

function normalizeInput(input) {
  if (typeof input === "string") {
    return [{ type: "message", role: "user", content: input || "..." }];
  }
  if (!Array.isArray(input)) return [];

  return input.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const type = item.type || (item.role ? "message" : "");
    if (type === "message") {
      const message = normalizeMessage(item);
      return message ? [message] : [];
    }
    if (type === "item_reference") return [];
    throw new GrokCliCompatibilityError(
      `Unsupported Grok CLI input item type: ${type || "<missing>"}`,
      `input[${index}]`,
    );
  });
}

function sameSystemMessage(item, instructions) {
  if (item?.type !== "message" || item.role !== "system") return false;
  if (typeof item.content === "string") return item.content === instructions;
  return Array.isArray(item.content)
    && item.content.length === 1
    && item.content[0]?.type === "input_text"
    && item.content[0]?.text === instructions;
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function translateGrokCliResponsesRequest(source = {}, options = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new GrokCliCompatibilityError("Grok CLI request body must be an object", "body");
  }

  const droppedTopLevel = Object.keys(source).filter((key) => !KNOWN_TOP_LEVEL.has(key));
  const input = normalizeInput(source.input);
  const instructions = typeof source.instructions === "string" ? source.instructions.trim() : "";
  if (instructions && !sameSystemMessage(input[0], instructions)) {
    input.unshift({ type: "message", role: "system", content: instructions });
  }
  if (input.length === 0) input.push({ type: "message", role: "user", content: "..." });

  const providerBody = {
    model: options.model || source.model,
    input,
  };
  if (Number.isInteger(source.max_output_tokens) && source.max_output_tokens > 0) {
    providerBody.max_output_tokens = source.max_output_tokens;
  }
  if (validNumber(source.temperature)) providerBody.temperature = source.temperature;
  if (validNumber(source.top_p)) providerBody.top_p = source.top_p;
  if (typeof source.parallel_tool_calls === "boolean") {
    providerBody.parallel_tool_calls = source.parallel_tool_calls;
  }
  providerBody.stream = true;
  providerBody.store = false;

  return {
    body: providerBody,
    diagnostics: {
      droppedTopLevel,
      droppedInputTypes: [],
      droppedToolTypes: [],
      convertedCustomTools: 0,
      repairedHistory: 0,
    },
  };
}
