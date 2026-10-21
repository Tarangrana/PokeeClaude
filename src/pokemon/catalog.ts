import { VSCODE_POKEMON } from "./vscode-index.js";

export const MAX_DEX = 1025;

export interface PokemonRef {
  readonly dex: number;
  readonly name: string;
  /** vscode-pokemon sprite folder, when that repo has this Pokémon. */
  readonly key?: string;
  readonly gen?: number;
  readonly hasShiny?: boolean;
  readonly hasWalkLeft?: boolean;
}

const BY_KEY = new Map(VSCODE_POKEMON.map(([key, dex, name, gen, flags]) => [key, toRef(key, dex, name, gen, flags)]));

/**
 * Resolve "pikachu", "25", "#025", "Mr. Mime", "garchomp-female" or
 * "rotom wash" to a Pokémon. Any National Dex number up to 1025 works; names
 * come from the vscode-pokemon index (Gen 1-5 plus forms).
 */
export function resolvePokemon(input: string, nameOverride?: string): PokemonRef {
  const trimmed = input.trim();
  const numeric = /^#?0*(\d{1,4})$/.exec(trimmed);
  let ref: PokemonRef | undefined;
  if (numeric) {
    const dex = Number(numeric[1]);
    if (dex < 1 || dex > MAX_DEX) throw new Error(`Dex number must be between 1 and ${MAX_DEX}.`);
    // First entry for a number is the base form.
    ref = [...BY_KEY.values()].find((r) => r.dex === dex) ?? { dex, name: `Pokémon #${dex}` };
  } else {
    const wanted = slug(trimmed);
    ref = BY_KEY.get(wanted.replace(/-/g, "_")) ?? [...BY_KEY.values()].find((r) => slug(r.name) === wanted || slug(r.key ?? "") === wanted);
  }
  if (!ref) {
    throw new Error(`Unknown Pokémon "${input}". Try a name like "garchomp" or a National Dex number, e.g. "pokeeclaude add 906 --name Sprigatito".`);
  }
  return nameOverride ? { ...ref, name: nameOverride } : ref;
}

/** Every Pokémon with vscode-pokemon sprites, base forms first by dex number. */
export function listKnownPokemon(): PokemonRef[] {
  return [...BY_KEY.values()];
}

export function petIdFor(ref: PokemonRef, shiny = false): string {
  const name = slug(ref.key ?? ref.name) || "pokemon";
  return `pokemon-${String(ref.dex).padStart(4, "0")}-${name}`.slice(0, shiny ? 58 : 64).replace(/-+$/, "") + (shiny ? "-shiny" : "");
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/♀/g, "-f")
    .replace(/♂/g, "-m")
    .replace(/_/g, "-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toRef(key: string, dex: number, name: string, gen: number, flags: number): PokemonRef {
  return { dex, name, key, gen, hasShiny: (flags & 1) === 1, hasWalkLeft: (flags & 2) === 2 };
}
