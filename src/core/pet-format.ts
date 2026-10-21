/**
 * Codex pet format, re-engineered.
 *
 * A Codex (ChatGPT) desktop pet is a folder with two files:
 *
 *   pet.json          { id, displayName, description, spritesheetPath }
 *   spritesheet.webp  an 8 x 9 grid of 192 x 208 px frames (1536 x 1872 px)
 *
 * Each row of the atlas is one animation. Codex v2 sheets add two extra rows
 * (9 and 10) for cursor-gaze frames; the first nine rows are identical, so a
 * v1 renderer can play either version.
 */

export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;
export const COLUMNS = 8;
export const ROWS_V1 = 9;
export const ROWS_V2 = 11;
export const SHEET_WIDTH = FRAME_WIDTH * COLUMNS; // 1536
export const SHEET_HEIGHT_V1 = FRAME_HEIGHT * ROWS_V1; // 1872
export const SHEET_HEIGHT_V2 = FRAME_HEIGHT * ROWS_V2; // 2288

/** The nine animations every Codex pet must provide. */
export const ANIMATIONS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

export type Animation = (typeof ANIMATIONS)[number];

export interface AnimationSpec {
  readonly row: number;
  readonly frames: number;
  /** Duration of one full loop of the row. */
  readonly durationMs: number;
  /** Loops before the animation is considered finished. Infinite when omitted. */
  readonly iterations?: number;
}

/** Row layout and timings used by Codex pets. */
export const ANIMATION_SPECS: Record<Animation, AnimationSpec> = {
  // Codex's own pets idle slowly (5.5s). Pokémon idle sprites are a breathing
  // loop, which reads better at roughly the original game speed.
  idle: { row: 0, frames: 6, durationMs: 1200 },
  "running-right": { row: 1, frames: 8, durationMs: 1060 },
  "running-left": { row: 2, frames: 8, durationMs: 1060 },
  waving: { row: 3, frames: 4, durationMs: 700, iterations: 2 },
  jumping: { row: 4, frames: 5, durationMs: 840, iterations: 2 },
  failed: { row: 5, frames: 8, durationMs: 1220, iterations: 2 },
  waiting: { row: 6, frames: 6, durationMs: 1500 },
  running: { row: 7, frames: 6, durationMs: 820 },
  review: { row: 8, frames: 6, durationMs: 1030 },
};

export type SpritesheetPath = "spritesheet.webp" | "spritesheet.png" | "spritesheet.svg";

export interface PetMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheetPath: SpritesheetPath;
  readonly spriteVersionNumber?: 2;
  /** PokeeClaude extension: where the sprite came from. Ignored by Codex. */
  readonly pokemon?: { readonly dex: number; readonly name: string; readonly source: string };
}

const PET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SPRITESHEET_PATHS = new Set<string>(["spritesheet.webp", "spritesheet.png", "spritesheet.svg"]);

export function isValidPetId(id: unknown): id is string {
  return typeof id === "string" && PET_ID.test(id);
}

/** Validate a parsed pet.json. Throws with a readable message on bad input. */
export function validatePetMetadata(value: unknown): PetMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pet.json must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (!isValidPetId(record.id)) {
    throw new Error("pet.json id must be lowercase letters, digits and dashes (max 64).");
  }
  for (const key of ["displayName", "description"] as const) {
    if (typeof record[key] !== "string" || (record[key] as string).length > 200) {
      throw new Error(`pet.json ${key} must be a string of at most 200 characters.`);
    }
  }
  if (typeof record.spritesheetPath !== "string" || !SPRITESHEET_PATHS.has(record.spritesheetPath)) {
    throw new Error("pet.json spritesheetPath must be spritesheet.webp, spritesheet.png or spritesheet.svg.");
  }
  if (record.spriteVersionNumber !== undefined && record.spriteVersionNumber !== 2) {
    throw new Error("pet.json spriteVersionNumber must be 2 when present.");
  }
  return record as unknown as PetMetadata;
}

export function sheetHeightFor(metadata: Pick<PetMetadata, "spriteVersionNumber">): number {
  return metadata.spriteVersionNumber === 2 ? SHEET_HEIGHT_V2 : SHEET_HEIGHT_V1;
}

/** Pixel rectangle of one frame inside the atlas. */
export function frameRect(animation: Animation, frame: number) {
  const spec = ANIMATION_SPECS[animation];
  const column = ((frame % spec.frames) + spec.frames) % spec.frames;
  return { x: column * FRAME_WIDTH, y: spec.row * FRAME_HEIGHT, width: FRAME_WIDTH, height: FRAME_HEIGHT };
}

/**
 * Which frame of an animation to show `elapsedMs` after it started, and whether
 * a finite animation has finished.
 */
export function frameAt(animation: Animation, elapsedMs: number): { frame: number; done: boolean } {
  const spec = ANIMATION_SPECS[animation];
  const frameMs = spec.durationMs / spec.frames;
  const index = Math.max(0, Math.floor(elapsedMs / frameMs));
  if (spec.iterations !== undefined && index >= spec.frames * spec.iterations) {
    return { frame: spec.frames - 1, done: true };
  }
  return { frame: index % spec.frames, done: false };
}
