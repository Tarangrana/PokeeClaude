import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { mapClaudeHook } from "./adapters/claude.js";
import { mapCodexPayload } from "./adapters/codex.js";
import { postToBridge } from "./bridge/send.js";
import { homeDir, loadConfig } from "./config.js";
import type { PetEvent } from "./core/pet-event.js";

const MAX_INPUT = 256 * 1024;

/**
 * Entry point for `pokeeclaude hook`. Claude Code pipes the hook payload on
 * stdin; Codex `notify` passes it as the last argument. Always exits 0 and
 * prints nothing on stdout (Claude would add stdout to the conversation).
 */
export async function runHook(agent: string, args: readonly string[]): Promise<number> {
  try {
    const argJson = args.find((arg) => arg.trimStart().startsWith("{"));
    const raw = argJson ?? (await readStdin(MAX_INPUT, 1500));
    const payload = raw.trim() ? (JSON.parse(raw) as unknown) : {};
    const { showPrompt } = loadConfig();
    const event: PetEvent | null =
      agent === "codex" ? mapCodexPayload(payload, { showPrompt }) : mapClaudeHook(payload, { showPrompt });
    const status = event ? await postToBridge("/api/event", event) : null;
    logActivity(agent, payload, event, status);
  } catch (error) {
    if (process.env.POKEECLAUDE_DEBUG) process.stderr.write(`pokeeclaude hook: ${String(error)}\n`);
  }
  return 0;
}

function readStdin(limit: number, timeoutMs: number): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = () => {
      clearTimeout(timer);
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) return finish();
      chunks.push(chunk);
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

/** Where hook activity is logged (event names only, no prompts or file contents). */
export function activityLogPath(): string {
  return join(homeDir(), "activity.log");
}

const MAX_LOG_BYTES = 64 * 1024;

/**
 * One line per hook call, so "the pet didn't react" can be checked:
 *   2026-10-21T22:01:02Z claude Stop project=my-app -> success (delivered)
 */
function logActivity(agent: string, payload: unknown, event: PetEvent | null, status: number | null): void {
  try {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const name = String(record.hook_event_name ?? record.type ?? "?");
    const tool = typeof record.tool_name === "string" ? ` tool=${record.tool_name}` : "";
    const project = event?.project ? ` project=${event.project}` : "";
    const outcome = !event ? "ignored" : `${event.reaction} (${status === 200 ? "delivered" : status === null ? "pet not running" : `HTTP ${status}`})`;
    const path = activityLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${new Date().toISOString()} ${agent} ${name}${tool}${project} -> ${outcome}\n`);
    if (statSync(path).size > MAX_LOG_BYTES) {
      const text = readFileSync(path, "utf8");
      writeFileSync(path, text.slice(text.indexOf("\n", text.length / 2) + 1));
    }
  } catch {
    // Logging must never break a hook.
  }
}
