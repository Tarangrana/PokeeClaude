import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { petsDir } from "../config.js";
import {
  ANIMATIONS,
  ANIMATION_SPECS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SHEET_HEIGHT_V1,
  SHEET_WIDTH,
  type Animation,
  type PetMetadata,
} from "../core/pet-format.js";
import { petIdFor, type PokemonRef } from "./catalog.js";
import type { SpriteFiles } from "./sprite-source.js";
import { blank, blit, crop, desaturate, flipX, rotate, sampleFrames, scale, unionBounds, type Image } from "./pixels.js";

/** Largest the sprite may be inside a 192x208 cell, leaving headroom for jumps. */
const FIT_BOX = 150;
/** Gap between the sprite's feet and the bottom of the cell. */
const FLOOR = 14;

/** How to draw one cell of the atlas from a source frame. */
export interface CellPose {
  /** Index into the evenly-sampled source frames for this row. */
  readonly frame: number;
  readonly dx?: number;
  readonly dy?: number;
  readonly rotate?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly flip?: boolean;
  readonly faded?: boolean;
}

const seq = (n: number, f: (i: number) => Omit<CellPose, "frame">): CellPose[] =>
  Array.from({ length: n }, (_, i) => ({ frame: i, ...f(i) }));

const hop = [0, -5, -9, -5, 0, -5, -9, -5];

/**
 * Codex rows rebuilt from a Pokémon's idle animation (plus its walk cycle
 * when the source has one). Direction comes from the frames chosen for each
 * row, so poses only add motion.
 */
export const ROW_POSES: Record<Animation, CellPose[]> = {
  idle: seq(6, () => ({})),
  "running-right": seq(8, (i) => ({ dy: hop[i], rotate: 5 })),
  "running-left": seq(8, (i) => ({ dy: hop[i], rotate: -5 })),
  waving: seq(4, (i) => ({ rotate: [-10, 0, 10, 0][i], dy: [-4, -8, -4, 0][i] })),
  jumping: [
    { frame: 0, sx: 1.1, sy: 0.88 },
    { frame: 1, dy: -24, sx: 0.94, sy: 1.08 },
    { frame: 2, dy: -40 },
    { frame: 3, dy: -24, sx: 0.96, sy: 1.04 },
    { frame: 4, sx: 1.08, sy: 0.9 },
  ],
  failed: seq(8, (i) => ({
    faded: true,
    dx: [-5, 5, -5, 5, -3, 3, 0, 0][i],
    dy: [0, 0, 0, 0, 2, 4, 6, 6][i],
    rotate: [0, 0, 0, 0, 4, 8, 12, 12][i],
    sy: i >= 6 ? 0.94 : 1,
  })),
  waiting: seq(6, (i) => ({ dy: [0, -2, -4, -4, -2, 0][i], rotate: [0, 0, -3, -3, 0, 0][i] })),
  running: seq(6, (i) => ({ dx: i % 2 ? 2 : -2, dy: i % 2 ? -3 : 0 })),
  review: seq(6, (i) => ({ rotate: [0, -5, -8, -8, -5, 0][i], dx: [0, -2, -3, -3, -2, 0][i] })),
};

/** A real walk cycle already steps, so it only needs a light bob. */
const WALK_POSES = seq(8, (i) => ({ dy: [0, -2, -3, -2, 0, -2, -3, -2][i] }));

/** Decoded animations for one Pokémon. */
export interface FrameSet {
  readonly idle: readonly Image[];
  /** Walk cycle facing the same way as `facing`. */
  readonly walk?: readonly Image[];
  /** Dedicated left-walking frames for asymmetric Pokémon. */
  readonly walkLeft?: readonly Image[];
  readonly facing: "left" | "right";
}

/** Crop every animation to one shared box and scale them all to fit a cell. */
export function prepareFrames(set: FrameSet): FrameSet {
  const all = [...set.idle, ...(set.walk ?? []), ...(set.walkLeft ?? [])];
  if (set.idle.length === 0) throw new Error("Sprite has no frames.");
  const box = unionBounds(all);
  const fit = Math.min(FIT_BOX / box.width, FIT_BOX / box.height);
  // Whole-number upscales keep pixel art crisp, unless rounding down would
  // leave the sprite much smaller than the others (e.g. 1.9x -> 1x).
  const whole = Math.min(4, Math.floor(fit));
  const factor = fit < 1 || whole / fit < 0.75 ? fit : whole;
  const fix = (frames: readonly Image[]) => frames.map((frame) => scale(crop(frame, box), factor));
  return {
    facing: set.facing,
    idle: fix(set.idle),
    ...(set.walk?.length ? { walk: fix(set.walk) } : {}),
    ...(set.walkLeft?.length ? { walkLeft: fix(set.walkLeft) } : {}),
  };
}

/** Which source frames and poses feed each row. */
function rowSource(set: FrameSet, animation: Animation): { frames: readonly Image[]; poses: CellPose[] } {
  const toward = (frames: readonly Image[], dir: "left" | "right") => (set.facing === dir ? frames : frames.map(flipX));
  if (animation === "running-right" || animation === "running-left") {
    const dir = animation === "running-right" ? "right" : "left";
    if (!set.walk) return { frames: toward(set.idle, dir), poses: ROW_POSES[animation] };
    const frames = dir === "left" && set.walkLeft ? set.walkLeft : toward(set.walk, dir);
    return { frames, poses: WALK_POSES };
  }
  // "Working" is walking on the spot when there is a walk cycle.
  if (animation === "running" && set.walk) return { frames: set.walk, poses: ROW_POSES.running };
  return { frames: set.idle, poses: ROW_POSES[animation] };
}

/** Compose a full 1536 x 1872 Codex atlas (RGBA) from prepared frames. */
export function composeSheet(set: FrameSet): Image {
  const sheet = blank(SHEET_WIDTH, SHEET_HEIGHT_V1);
  for (const animation of ANIMATIONS) {
    const spec = ANIMATION_SPECS[animation];
    const { frames, poses } = rowSource(set, animation);
    // Busy rows step through the animation faster than idle does.
    const source = sampleFrames(frames, poses.length, animation === "running" ? 1 : 0);
    poses.forEach((pose, column) => {
      let img = source[pose.frame % source.length]!;
      if (pose.flip) img = flipX(img);
      if (pose.faded) img = desaturate(img);
      if ((pose.sx ?? 1) !== 1 || (pose.sy ?? 1) !== 1) img = scale(img, pose.sx ?? 1, pose.sy ?? 1);
      const rotated = rotate(img, pose.rotate ?? 0);
      const cell = { x: column * FRAME_WIDTH, y: spec.row * FRAME_HEIGHT, width: FRAME_WIDTH, height: FRAME_HEIGHT };
      // Anchor at bottom-centre; rotation grows the canvas around the centre.
      const centreX = cell.x + FRAME_WIDTH / 2 + (pose.dx ?? 0);
      const centreY = cell.y + FRAME_HEIGHT - FLOOR - img.height / 2 + (pose.dy ?? 0);
      blit(sheet, rotated, Math.round(centreX - rotated.width / 2), Math.round(centreY - rotated.height / 2), cell);
    });
  }
  return sheet;
}

/** Decode a GIF/PNG/WebP into RGBA frames. */
export async function decodeFrames(bytes: Buffer): Promise<Image[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(bytes, { animated: true }).metadata();
  const { data, info } = await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pages = meta.pages ?? 1;
  const pageHeight = meta.pageHeight ?? info.height;
  const frameBytes = info.width * pageHeight * 4;
  const frames: Image[] = [];
  for (let i = 0; i < pages; i++) {
    frames.push({ width: info.width, height: pageHeight, data: new Uint8Array(data.subarray(i * frameBytes, (i + 1) * frameBytes)) });
  }
  return frames.filter((f) => f.data.length === frameBytes);
}

export interface BuiltPet {
  readonly dir: string;
  readonly metadata: PetMetadata;
}

/** Decode downloaded sprite files into a frame set. */
export async function decodeSprites(files: SpriteFiles): Promise<FrameSet> {
  return {
    facing: files.facing,
    idle: await decodeFrames(files.idle),
    ...(files.walk ? { walk: await decodeFrames(files.walk) } : {}),
    ...(files.walkLeft ? { walkLeft: await decodeFrames(files.walkLeft) } : {}),
  };
}

/** Turn sprite files into an installed Codex-format pet folder. */
export async function buildPet(ref: PokemonRef, files: SpriteFiles, options: { root?: string; shiny?: boolean } = {}): Promise<BuiltPet> {
  const sharp = (await import("sharp")).default;
  const sheet = composeSheet(prepareFrames(await decodeSprites(files)));
  const webp = await sharp(Buffer.from(sheet.data), { raw: { width: sheet.width, height: sheet.height, channels: 4 } })
    .webp({ lossless: true })
    .toBuffer();

  const shiny = Boolean(options.shiny);
  const displayName = shiny ? `Shiny ${ref.name}` : ref.name;
  const metadata: PetMetadata = {
    id: petIdFor(ref, shiny),
    displayName,
    description: `${displayName} (#${String(ref.dex).padStart(3, "0")}) keeping an eye on your coding agent.`,
    spritesheetPath: "spritesheet.webp",
    pokemon: { dex: ref.dex, name: ref.name, source: files.label },
  };
  const dir = join(options.root ?? petsDir(), metadata.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spritesheet.webp"), webp);
  writeFileSync(join(dir, "pet.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return { dir, metadata };
}
