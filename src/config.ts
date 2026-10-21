import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_PORT = 47823;

export interface PokeeConfig {
  /** Pet id currently on the desktop. */
  readonly activePet: string | null;
  /** Show the start of prompts / replies in the bubble. */
  readonly showPrompt: boolean;
  /** Show the speech bubble at all. */
  readonly showBubble: boolean;
  /** Let the pet walk around when idle. */
  readonly wander: boolean;
  /** Display scale of the 192x208 frame. */
  readonly scale: number;
  /** System notification when the agent finishes a longer turn. */
  readonly notifyDone: boolean;
}

export const DEFAULT_CONFIG: PokeeConfig = {
  activePet: null,
  showPrompt: false,
  showBubble: true,
  wander: true,
  scale: 0.75,
  notifyDone: true,
};

export function homeDir(): string {
  return process.env.POKEECLAUDE_HOME || join(homedir(), ".pokeeclaude");
}

export function petsDir(): string {
  return join(homeDir(), "pets");
}

/** Codex keeps its pets here; PokeeClaude can show them too. */
export function codexPetsDir(): string {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "pets");
}

export function cacheDir(): string {
  return join(homeDir(), "cache");
}

export function configPath(): string {
  return join(homeDir(), "config.json");
}

export function bridgePort(): number {
  const fromEnv = Number(process.env.POKEECLAUDE_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536 ? fromEnv : DEFAULT_PORT;
}

export function loadConfig(): PokeeConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<PokeeConfig>;
    return normalizeConfig(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(patch: Partial<PokeeConfig>): PokeeConfig {
  const next = normalizeConfig({ ...loadConfig(), ...patch });
  writeJsonAtomic(configPath(), next);
  return next;
}

export function normalizeConfig(raw: Partial<PokeeConfig>): PokeeConfig {
  const scale = typeof raw.scale === "number" && raw.scale >= 0.3 && raw.scale <= 2 ? raw.scale : DEFAULT_CONFIG.scale;
  return {
    activePet: typeof raw.activePet === "string" ? raw.activePet : null,
    showPrompt: typeof raw.showPrompt === "boolean" ? raw.showPrompt : DEFAULT_CONFIG.showPrompt,
    showBubble: typeof raw.showBubble === "boolean" ? raw.showBubble : DEFAULT_CONFIG.showBubble,
    wander: typeof raw.wander === "boolean" ? raw.wander : DEFAULT_CONFIG.wander,
    scale,
    notifyDone: typeof raw.notifyDone === "boolean" ? raw.notifyDone : DEFAULT_CONFIG.notifyDone,
  };
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
