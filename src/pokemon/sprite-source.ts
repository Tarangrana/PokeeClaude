import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cacheDir } from "../config.js";
import type { PokemonRef } from "./catalog.js";
import { VSCODE_POKEMON_REF } from "./vscode-index.js";

/**
 * Sprites are downloaded on the user's own machine; none are bundled.
 *
 * - "pixel" (default): the small overworld sprites from jakobhoeg/vscode-pokemon,
 *   which have separate idle and walk animations (Gen 1-5).
 * - "hd": bigger battle sprites from PokeAPI/sprites (Black/White animated,
 *   then Showdown animated, then a still), covering every dex number.
 */
export type SpriteStyle = "pixel" | "hd";

export const VSCODE_BASE = `https://raw.githubusercontent.com/jakobhoeg/vscode-pokemon/${VSCODE_POKEMON_REF}/media`;
export const POKEAPI_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/** Raw sprite files for one Pokémon, before they become a Codex atlas. */
export interface SpriteFiles {
  readonly label: string;
  readonly idle: Buffer;
  readonly walk?: Buffer;
  readonly walkLeft?: Buffer;
  /** Which way the sprites face when not flipped. */
  readonly facing: "left" | "right";
}

interface Plan {
  readonly label: string;
  readonly facing: "left" | "right";
  readonly urls: { readonly idle: string; readonly walk?: string; readonly walkLeft?: string };
}

export function spritePlans(ref: PokemonRef, style: SpriteStyle = "pixel", shiny = false): Plan[] {
  const plans: Plan[] = [];
  if (style === "pixel" && ref.key && ref.gen) {
    const color = shiny && ref.hasShiny ? "shiny" : "default";
    const dir = `${VSCODE_BASE}/gen${ref.gen}/${ref.key}/${color}`;
    plans.push({
      label: `vscode-pokemon pixel${color === "shiny" ? " (shiny)" : ""}`,
      facing: "right",
      urls: {
        idle: `${dir}_idle_8fps.gif`,
        walk: `${dir}_walk_8fps.gif`,
        ...(ref.hasWalkLeft ? { walkLeft: `${dir}_walk_left_8fps.gif` } : {}),
      },
    });
  }
  const shinyDir = shiny ? "/shiny" : "";
  if (ref.dex <= 649) {
    plans.push({ label: "PokeAPI Black/White animated", facing: "left", urls: { idle: `${POKEAPI_BASE}/versions/generation-v/black-white/animated${shinyDir}/${ref.dex}.gif` } });
  }
  plans.push({ label: "PokeAPI Showdown animated", facing: "left", urls: { idle: `${POKEAPI_BASE}/other/showdown${shinyDir}/${ref.dex}.gif` } });
  plans.push({ label: "PokeAPI still", facing: "left", urls: { idle: `${POKEAPI_BASE}${shinyDir}/${ref.dex}.png` } });
  return plans;
}

/** Try each source in order until one downloads completely. */
export async function downloadSprites(ref: PokemonRef, style: SpriteStyle = "pixel", shiny = false, fetchImpl: typeof fetch = fetch): Promise<SpriteFiles> {
  const errors: string[] = [];
  for (const plan of spritePlans(ref, style, shiny)) {
    try {
      const idle = await fetchCached(plan.urls.idle, fetchImpl);
      const walk = plan.urls.walk ? await fetchCached(plan.urls.walk, fetchImpl) : undefined;
      const walkLeft = plan.urls.walkLeft ? await fetchCached(plan.urls.walkLeft, fetchImpl).catch(() => undefined) : undefined;
      return { label: plan.label, idle, facing: plan.facing, ...(walk ? { walk } : {}), ...(walkLeft ? { walkLeft } : {}) };
    } catch (error) {
      errors.push(`${plan.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not download sprites for ${ref.name} (#${ref.dex}).\n  ${errors.join("\n  ")}\nTip: pass --file <gif-or-png> to build from a local image.`);
}

/** Download a file once and keep it in ~/.pokeeclaude/cache. */
export async function fetchCached(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const cached = join(cacheDir(), url.replace(/^https:\/\/raw\.githubusercontent\.com\//, "").replace(/[^a-z0-9.]+/gi, "_"));
  if (existsSync(cached)) return readFileSync(cached);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
}
