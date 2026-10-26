import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeDir, loadConfig, saveConfig } from "./config.js";
import { claudeSettingsPath, addPokeeHooks, findPokeeCommands, hookCommand, readSettings, removePokeeHooks, updateSettingsFile } from "./install/claude-settings.js";
import { addNotify, codexConfigPath, hasForeignNotify, hasManagedNotify, notifyLine, removeNotify, updateCodexConfig } from "./install/codex-config.js";
import { addMcpServer, claudeDesktopConfigPath, getMcpServer, mcpEntry, removeMcpServer } from "./install/claude-desktop.js";
import { findPet, listPets } from "./pets.js";
import { listKnownPokemon, petIdFor, resolvePokemon } from "./pokemon/catalog.js";
import { fetchCached, VSCODE_BASE } from "./pokemon/sprite-source.js";

/**
 * Everything the setup window needs, shared by the CLI and the local server
 * so the window and `pokeeclaude install` behave the same.
 */

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");

/** Where the hook launcher script lives when running from the installed app. */
export function hookLauncherPath(platform = process.platform): string {
  return join(homeDir(), "bin", platform === "win32" ? "pokeeclaude-hook.cmd" : "pokeeclaude-hook");
}

/** Contents of the launcher: run the app's own binary as Node, on the CLI. */
export function hookLauncherScript(execPath: string, cli: string, platform = process.platform): string {
  if (platform === "win32") {
    return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" "${cli}" %*\r\n`;
  }
  const q = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
  return `#!/bin/sh\n# Written by PokeeClaude: runs Claude Code / Codex hooks with the app's built-in runtime.\nELECTRON_RUN_AS_NODE=1 exec ${q(execPath)} ${q(cli)} "$@"\n`;
}

/**
 * The program that runs `cli.js` for hooks.
 *
 * - Plain Node (CLI, `serve`, tests): node + cli.js.
 * - Desktop app started from a source checkout: the node that launched it.
 * - Installed app (.dmg/.exe/AppImage): users may not have Node at all, and
 *   GUI apps on macOS don't see your shell PATH. So a small launcher script
 *   runs the app binary itself in Node mode (ELECTRON_RUN_AS_NODE).
 */
export function hookRunner(): string[] {
  if (process.env.POKEECLAUDE_NODE) return [process.env.POKEECLAUDE_NODE, cliPath];
  if (!process.versions.electron) return [process.execPath, cliPath];
  writeHookLauncher();
  return [hookLauncherPath()];
}

/** How the Claude desktop app should start our MCP server (see install/claude-desktop.ts). */
export function mcpRunner(): { exec: string; cli: string; asNode: boolean } {
  if (process.env.POKEECLAUDE_NODE) return { exec: process.env.POKEECLAUDE_NODE, cli: cliPath, asNode: false };
  return { exec: process.execPath, cli: cliPath, asNode: Boolean(process.versions.electron) };
}

function writeHookLauncher(): void {
  const path = hookLauncherPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, hookLauncherScript(process.execPath, cliPath));
  if (process.platform !== "win32") chmodSync(path, 0o755);
}

/**
 * Keep the launcher pointing at the current app binary (it moves when the app
 * is updated or dragged to another folder). Called on every app start.
 */
export function refreshHookLauncher(): void {
  if (process.versions.electron && !process.env.POKEECLAUDE_NODE && existsSync(hookLauncherPath())) writeHookLauncher();
}

export interface PokedexEntry {
  readonly key: string;
  /** Pet ids this entry installs as (normal / shiny). */
  readonly id: string;
  readonly shinyId: string;
  readonly dex: number;
  readonly name: string;
  readonly gen: number;
  readonly shiny: boolean;
  readonly preview: string;
  readonly previewShiny: string | null;
  readonly installed: boolean;
  readonly installedShiny: boolean;
}

export function pokedex(): PokedexEntry[] {
  const installed = new Set(listPets().map((p) => p.metadata.id));
  return listKnownPokemon().map((ref) => {
    // Served (and cached) by the local server, so the page never talks to GitHub directly.
    const preview = `/api/sprite/${ref.key}`;
    return {
      key: ref.key!,
      id: petIdFor(ref),
      shinyId: petIdFor(ref, true),
      dex: ref.dex,
      name: ref.name,
      gen: ref.gen!,
      shiny: Boolean(ref.hasShiny),
      preview,
      previewShiny: ref.hasShiny ? `${preview}?shiny=1` : null,
      installed: installed.has(petIdFor(ref)),
      installedShiny: installed.has(petIdFor(ref, true)),
    };
  });
}

/** Idle GIF for the setup grid, downloaded once and then served from cache. */
export async function spritePreview(key: string, shiny: boolean): Promise<Buffer | null> {
  const ref = listKnownPokemon().find((p) => p.key === key);
  if (!ref) return null;
  const color = shiny && ref.hasShiny ? "shiny" : "default";
  return fetchCached(`${VSCODE_BASE}/gen${ref.gen}/${ref.key}/${color}_idle_8fps.gif`, fetch);
}

export function setupStatus() {
  let claudeInstalled = false;
  let claudeError: string | null = null;
  try {
    claudeInstalled = findPokeeCommands(readSettings(claudeSettingsPath())).length > 0;
  } catch (error) {
    claudeError = error instanceof Error ? error.message : String(error);
  }
  const codexPath = codexConfigPath();
  const codexToml = existsSync(codexPath) ? readFileSync(codexPath, "utf8") : "";
  const config = loadConfig();
  const active = findPet(config.activePet) ?? listPets()[0] ?? null;
  const desktopPath = claudeDesktopConfigPath();
  let appInstalled = false;
  let appError: string | null = null;
  try {
    appInstalled = getMcpServer(readSettings(desktopPath)) !== null;
  } catch (error) {
    appError = error instanceof Error ? error.message : String(error);
  }
  return {
    claude: { installed: claudeInstalled, path: claudeSettingsPath(), error: claudeError },
    claudeApp: { installed: appInstalled, path: desktopPath, error: appError },
    codex: { installed: hasManagedNotify(codexToml), path: codexPath, blocked: hasForeignNotify(codexToml) },
    activePet: active?.metadata.id ?? null,
    pets: listPets().map((p) => ({ id: p.metadata.id, displayName: p.metadata.displayName, source: p.source })),
  };
}

/** Download, build and activate a Pokémon pet. */
export async function addPokemon(input: { key?: unknown; dex?: unknown; shiny?: unknown }) {
  const query = typeof input.key === "string" ? input.key : typeof input.dex === "number" ? String(input.dex) : "";
  if (!query) throw new Error("Pick a Pokémon first.");
  const ref = resolvePokemon(query);
  const shiny = input.shiny === true;
  const { downloadSprites } = await import("./pokemon/sprite-source.js");
  const { buildPet } = await import("./pokemon/build-sheet.js");
  const style = shiny && !ref.hasShiny ? "hd" : "pixel";
  const pet = await buildPet(ref, await downloadSprites(ref, style, shiny), { shiny });
  saveConfig({ activePet: pet.metadata.id });
  return { id: pet.metadata.id, displayName: pet.metadata.displayName };
}

/**
 * Point any installed PokeeClaude hooks at *this* copy of the app. Called on
 * every app start: without it, hooks written by an older version (or a source
 * checkout) keep running that old code after an update.
 */
export function syncAgentHooks(): { claude: boolean; codex: boolean; claudeApp: boolean } {
  const runner = hookRunner();
  const changed = { claude: false, codex: false, claudeApp: false };
  try {
    const path = claudeDesktopConfigPath();
    const current = existsSync(path) ? getMcpServer(readSettings(path)) : null;
    const expected = mcpEntry(mcpRunner());
    if (current && JSON.stringify(current) !== JSON.stringify(expected)) {
      changed.claudeApp = updateSettingsFile(path, (s) => addMcpServer(s, expected)).changed;
    }
  } catch {
    // Unreadable app config: leave it alone.
  }
  try {
    const path = claudeSettingsPath();
    const commands = findPokeeCommands(readSettings(path));
    const expected = hookCommand(runner);
    if (commands.length > 0 && (commands.length !== 1 || commands[0] !== expected)) {
      changed.claude = updateSettingsFile(path, (s) => addPokeeHooks(s, expected)).changed;
    }
  } catch {
    // Unreadable settings: leave them alone; setup shows the error.
  }
  try {
    const path = codexConfigPath();
    if (existsSync(path)) {
      const toml = readFileSync(path, "utf8");
      const line = notifyLine(runner);
      if (hasManagedNotify(toml) && !toml.includes(line)) {
        changed.codex = updateCodexConfig((t) => addNotify(t, line)).changed;
      }
    }
  } catch {
    // Same as above.
  }
  return changed;
}

/** Turn Claude Code / Codex hooks on or off. Missing keys are left alone. */
export function setAgents(input: { claude?: unknown; codex?: unknown; claudeApp?: unknown }) {
  const results: Record<string, { changed: boolean; backup: string | null; path: string }> = {};
  const runner = hookRunner();
  if (typeof input.claude === "boolean") {
    const command = hookCommand(runner);
    const on = input.claude;
    results.claude = updateSettingsFile(claudeSettingsPath(), (s) => (on ? addPokeeHooks(s, command) : removePokeeHooks(s)));
  }
  if (typeof input.codex === "boolean") {
    const line = notifyLine(runner);
    const on = input.codex;
    results.codex = updateCodexConfig((t) => (on ? addNotify(t, line) : removeNotify(t)));
  }
  if (typeof input.claudeApp === "boolean") {
    const entry = mcpEntry(mcpRunner());
    const on = input.claudeApp;
    results.claudeApp = updateSettingsFile(claudeDesktopConfigPath(), (s) => (on ? addMcpServer(s, entry) : removeMcpServer(s)));
  }
  return results;
}
