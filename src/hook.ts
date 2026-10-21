import { mapClaudeHook } from "./adapters/claude.js";
import { mapCodexPayload } from "./adapters/codex.js";
import { postToBridge } from "./bridge/send.js";
import { loadConfig } from "./config.js";
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
    if (event) await postToBridge("/api/event", event);
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
