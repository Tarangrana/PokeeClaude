import { basename } from "node:path";

import { clip, type AgentName, type PetEvent } from "../core/pet-event.js";
import type { Reaction } from "../core/reactions.js";

export interface AdapterOptions {
  /** Show the start of the user's prompt in the bubble. Off by default. */
  readonly showPrompt?: boolean;
  readonly now?: number;
  readonly agent?: AgentName;
}

/** Hook events PokeeClaude registers in Claude Code settings. */
export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const;

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const TEST_COMMAND =
  /(^|[\s;&|(])((npm|pnpm|yarn|bun)\s+(run\s+)?test|bun test|vitest|jest|pytest|go test|cargo test|mvn test|gradle(w)? test|phpunit|rspec|mocha|playwright test|deno test|dotnet test|ctest|tox|make (test|check))\b/i;

/**
 * Turn a Claude Code hook payload (the JSON Claude writes to the hook's stdin)
 * into a pet event. Returns null for events the pet doesn't care about.
 */
export function mapClaudeHook(payload: unknown, options: AdapterOptions = {}): PetEvent | null {
  if (!isRecord(payload)) return null;
  const hook = str(payload.hook_event_name);
  const toolName = str(payload.tool_name);
  const toolInput = isRecord(payload.tool_input) ? payload.tool_input : {};

  const base = {
    agent: options.agent ?? "claude",
    sessionId: str(payload.session_id) || "default",
    project: projectName(str(payload.cwd)),
    at: options.now ?? Date.now(),
  } as const;
  const event = (reaction: Reaction, context: string, extra: Pick<PetEvent, "ended" | "phase" | "file"> = {}): PetEvent => ({
    ...base,
    reaction,
    context: clip(context),
    ...extra,
  });

  switch (hook) {
    case "SessionStart":
      return event("waving", str(payload.source) === "resume" ? "Back again!" : "Ready to help!");
    case "UserPromptSubmit": {
      const prompt = str(payload.prompt);
      return event("thinking", options.showPrompt && prompt ? `“${clip(prompt, 44)}”` : "Thinking…", { phase: "start" });
    }
    case "PreToolUse": {
      const { reaction, context } = describeTool(toolName, toolInput);
      const file = reaction === "editing" ? fileLabel(toolInput.file_path) || fileLabel(toolInput.notebook_path) : "";
      return event(reaction, context, file ? { file } : {});
    }
    case "PermissionRequest": {
      const { context } = describeTool(toolName, toolInput);
      return event("waiting", `Needs your OK · ${context}`);
    }
    case "Notification": {
      const type = str(payload.notification_type);
      // Claude Code sends this ~60s after finishing; the "done" pill already covers it.
      // Older versions send it without a type, just the message.
      if (type === "idle_prompt" || /waiting for your input/i.test(str(payload.message))) return null;
      if (type === "permission_prompt") return event("waiting", "Needs your permission");
      if (type === "auth_success") return null;
      return event("waiting", str(payload.message) || "Needs your attention");
    }
    case "Stop": {
      // Newer Claude Code versions include the final reply; only shown when opted in.
      const reply = str(payload.last_assistant_message);
      return event("success", options.showPrompt && reply ? clip(reply, 56) : "All done!", { phase: "end" });
    }
    case "StopFailure": {
      const reason = str(payload.error) || str(payload.error_type) || str(payload.reason);
      return event("error", reason ? `Stopped · ${reason}` : "Something went wrong", { phase: "end" });
    }
    case "SessionEnd":
      return event("idle", "Bye!", { ended: true });
    default:
      return null;
  }
}

/** Reaction + bubble text for a tool call. Never includes full paths or file contents. */
export function describeTool(toolName: string, input: Record<string, unknown>): { reaction: Reaction; context: string } {
  const file = fileLabel(input.file_path) || fileLabel(input.notebook_path) || fileLabel(input.path);

  if (EDIT_TOOLS.has(toolName)) return { reaction: "editing", context: file ? `Editing ${file}` : "Editing files" };
  if (toolName === "Write") return { reaction: "editing", context: file ? `Writing ${file}` : "Writing a file" };
  if (toolName === "Read") return { reaction: "thinking", context: file ? `Reading ${file}` : "Reading files" };
  if (toolName === "Grep") return { reaction: "thinking", context: `Searching “${clip(str(input.pattern), 24)}”` };
  if (toolName === "Glob") return { reaction: "thinking", context: `Looking for ${clip(str(input.pattern), 30)}` };
  if (toolName === "WebSearch") return { reaction: "thinking", context: "Searching the web" };
  if (toolName === "WebFetch") return { reaction: "thinking", context: `Reading ${hostOf(str(input.url)) || "a web page"}` };
  if (toolName === "TodoWrite") return { reaction: "thinking", context: "Planning next steps" };
  if (toolName === "Task" || toolName === "Agent") {
    const description = str(input.description);
    return { reaction: "working", context: description ? `Delegating · ${description}` : "Delegating to a helper" };
  }
  if (toolName === "Bash") {
    const command = str(input.command);
    const description = str(input.description);
    const testing = TEST_COMMAND.test(command);
    const fallback = testing ? "Running tests" : `Running ${programOf(command) || "a command"}`;
    return { reaction: testing ? "testing" : "running", context: description || fallback };
  }
  if (toolName.startsWith("mcp__")) {
    const [, server = "", tool = ""] = toolName.split("__");
    return { reaction: "working", context: `Using ${server}${tool ? ` · ${tool}` : ""}` };
  }
  return { reaction: "working", context: toolName ? `Using ${toolName}` : "Working…" };
}

/** First program name in a shell command, without its path or arguments. */
export function programOf(command: string): string {
  const tokens = command.trim().split(/\s+/);
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // FOO=bar env prefix
    if (token === "sudo" || token === "env" || token === "time") continue;
    return basename(token.replace(/^['"]|['"]$/g, ""));
  }
  return "";
}

export function projectName(cwd: string): string {
  return cwd ? basename(cwd.replace(/[\\/]+$/, "")) : "";
}

function fileLabel(value: unknown): string {
  return typeof value === "string" && value ? basename(value) : "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
