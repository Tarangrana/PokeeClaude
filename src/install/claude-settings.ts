import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CLAUDE_HOOK_EVENTS } from "../adapters/claude.js";
import { writeJsonAtomic } from "../config.js";

/** Flag appended to every hook command so we can find our hooks again. */
export const HOOK_FLAG = "--pokeeclaude";

type Json = Record<string, unknown>;

export function claudeSettingsPath(project?: string): string {
  if (project) return join(project, ".claude", "settings.local.json");
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}

/**
 * Build the hook command from the program that runs the CLI, e.g.
 * ["/usr/bin/node", "/path/dist/cli.js"] or ["~/.pokeeclaude/bin/pokeeclaude-hook"].
 * Absolute paths so it works from any directory.
 */
export function hookCommand(runner: readonly string[]): string {
  return `${runner.map(quote).join(" ")} hook --agent claude ${HOOK_FLAG}`;
}

/** The `hooks` block PokeeClaude adds to Claude Code settings. */
export function pokeeHooks(command: string): Json {
  const hooks: Json = {};
  for (const event of CLAUDE_HOOK_EVENTS) {
    const entry: Json = { hooks: [{ type: "command", command, timeout: 5 }] };
    if (event === "PreToolUse" || event === "PermissionRequest") entry.matcher = "*";
    hooks[event] = [entry];
  }
  return hooks;
}

/** Add PokeeClaude hooks, replacing any older PokeeClaude hooks. Never touches other hooks. */
export function addPokeeHooks(settings: Json, command: string): Json {
  const cleaned = removePokeeHooks(settings);
  const existing = isRecord(cleaned.hooks) ? cleaned.hooks : {};
  const merged: Json = { ...existing };
  for (const [event, entries] of Object.entries(pokeeHooks(command))) {
    const current = Array.isArray(merged[event]) ? (merged[event] as unknown[]) : [];
    merged[event] = [...current, ...(entries as unknown[])];
  }
  return { ...cleaned, hooks: merged };
}

/** Remove only PokeeClaude-managed hooks; drop entries/events left empty. */
export function removePokeeHooks(settings: Json): Json {
  if (!isRecord(settings.hooks)) return settings;
  const next: Json = {};
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) {
      next[event] = entries;
      continue;
    }
    const kept = entries
      .map((entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.hooks)) return entry;
        const hooks = entry.hooks.filter((hook) => !isPokeeHook(hook));
        return hooks.length ? { ...entry, hooks } : null;
      })
      .filter((entry) => entry !== null);
    if (kept.length) next[event] = kept;
  }
  const result: Json = { ...settings, hooks: next };
  if (Object.keys(next).length === 0) delete result.hooks;
  return result;
}

export function hasPokeeHooks(settings: Json): boolean {
  return JSON.stringify(settings) !== JSON.stringify(removePokeeHooks(settings));
}

/** Every PokeeClaude hook command found in the settings. */
export function findPokeeCommands(settings: Json): string[] {
  const found = new Set<string>();
  if (!isRecord(settings.hooks)) return [];
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
      for (const hook of entry.hooks) if (isPokeeHook(hook)) found.add((hook as Json).command as string);
    }
  }
  return [...found];
}

function isPokeeHook(hook: unknown): boolean {
  return isRecord(hook)
    && hook.type === "command"
    && typeof hook.command === "string"
    && hook.command.includes(HOOK_FLAG);
}

export interface SettingsChange {
  readonly path: string;
  readonly backup: string | null;
  readonly changed: boolean;
}

export function readSettings(path: string): Json {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object.`);
  return parsed;
}

/** Apply a settings transform with a timestamped backup of the old file. */
export function updateSettingsFile(path: string, transform: (settings: Json) => Json, dryRun = false): SettingsChange {
  const before = readSettings(path);
  const after = transform(before);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (!changed || dryRun) return { path, backup: null, changed };
  let backup: string | null = null;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeJsonAtomic(path, after);
  return { path, backup, changed };
}

function quote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
