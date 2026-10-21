import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { codexPetsDir, petsDir } from "./config.js";
import { isValidPetId, validatePetMetadata, type PetMetadata } from "./core/pet-format.js";

export type PetSource = "pokee" | "codex";

export interface InstalledPet {
  readonly source: PetSource;
  readonly dir: string;
  readonly metadata: PetMetadata;
}

/** All valid pets: PokeeClaude's own first, then any Codex pets the user has. */
export function listPets(): InstalledPet[] {
  return [...scan(petsDir(), "pokee"), ...scan(codexPetsDir(), "codex")];
}

export function findPet(id: string | null): InstalledPet | null {
  if (!id || !isValidPetId(id)) return null;
  return listPets().find((pet) => pet.metadata.id === id) ?? null;
}

export function spritesheetFile(pet: InstalledPet): string {
  return join(pet.dir, pet.metadata.spritesheetPath);
}

function scan(root: string, source: PetSource): InstalledPet[] {
  if (!existsSync(root)) return [];
  const pets: InstalledPet[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidPetId(entry.name)) continue;
    const dir = join(root, entry.name);
    try {
      const metadata = validatePetMetadata(JSON.parse(readFileSync(join(dir, "pet.json"), "utf8")));
      if (metadata.id !== entry.name || !existsSync(join(dir, metadata.spritesheetPath))) continue;
      pets.push({ source, dir, metadata });
    } catch {
      // Skip broken pets instead of failing the whole list.
    }
  }
  return pets.sort((a, b) => a.metadata.displayName.localeCompare(b.metadata.displayName));
}
