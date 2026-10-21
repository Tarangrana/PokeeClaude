import { clip, type PetEvent } from "../core/pet-event.js";
import { mapClaudeHook, projectName, type AdapterOptions } from "./claude.js";

/**
 * Map a Codex payload to a pet event.
 *
 * Codex CLI calls its `notify` program with one JSON argument, e.g.
 *   {"type":"agent-turn-complete","thread-id":"…","turn-id":"…","cwd":"…",
 *    "input-messages":["…"],"last-assistant-message":"…"}
 *
 * Codex lifecycle hooks use the same payload shape as Claude Code
 * (hook_event_name, session_id, tool_name, …), so those are handed to the
 * Claude mapper and tagged as Codex.
 */
export function mapCodexPayload(payload: unknown, options: AdapterOptions = {}): PetEvent | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.hook_event_name === "string") {
    return mapClaudeHook(record, { ...options, agent: "codex" });
  }

  const type = typeof record.type === "string" ? record.type : "";
  const base = {
    agent: "codex" as const,
    sessionId: str(record["thread-id"]) || str(record["session-id"]) || "default",
    project: projectName(str(record.cwd)),
    at: options.now ?? Date.now(),
  };

  if (type === "agent-turn-complete") {
    const last = str(record["last-assistant-message"]);
    const context = options.showPrompt && last ? clip(last, 48) : "All done!";
    return { ...base, reaction: "success", context, phase: "end" };
  }
  if (type.includes("approval")) {
    return { ...base, reaction: "waiting", context: "Needs your OK" };
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
