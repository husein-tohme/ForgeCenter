// The Claude client shared by features that call the model directly: the developer
// API, AI Maker and Site Maker. (Forge Support and the mentor keep their own setup.)
import Anthropic from "@anthropic-ai/sdk";

let client;
const anthropic = (params, options) => (client ??= new Anthropic()).beta.messages.create(params, options);
let callModel = anthropic;

// Tests swap in a fake model; null puts the real one back.
export const setModel = fn => { callModel = fn ?? anthropic; };
export const aiEnabled = () => callModel !== anthropic || !!process.env.ANTHROPIC_API_KEY;
export const appsModel = () => process.env.AI_APPS_MODEL || "claude-opus-5-5";

// One request. If the model declines, Anthropic retries on its recommended fallback model.
// Callers check `stop_reason` ("refusal") before reading the text.
export function ask({ system, messages, maxTokens = 16000, effort = "medium", tools, model, timeoutMs = 120_000 }) {
  return callModel({
    model: model ?? appsModel(),
    max_tokens: maxTokens,
    output_config: { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    messages,
  }, { timeout: timeoutMs, maxRetries: 1 });
}

export const textOf = r => (r?.content ?? []).filter(b => b.type === "text").map(b => b.text).join("").trim();

// Chat history from the browser: user/assistant turns with text, newest last, starting with the user.
export function cleanHistory(list, { max = 20, maxChars = 8000 } = {}) {
  const messages = (Array.isArray(list) ? list : []).slice(-max)
    .filter(m => ["user", "assistant"].includes(m?.role) && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, maxChars) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages;
}
