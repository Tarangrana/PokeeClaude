import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ANIMATION_SPECS, ANIMATIONS, FRAME_HEIGHT, FRAME_WIDTH, frameRect, SHEET_HEIGHT_V1, SHEET_WIDTH, validatePetMetadata } from "../core/pet-format.js";
import { buildPet, composeSheet, decodeFrames, prepareFrames, ROW_POSES } from "./build-sheet.js";
import { listKnownPokemon, petIdFor, resolvePokemon } from "./catalog.js";
import { blank, flipX, rotate, sampleFrames, scale, unionBounds, type Image } from "./pixels.js";
import { spritePlans } from "./sprite-source.js";

function square(size: number, inset: number, rgb: [number, number, number] = [250, 200, 40]): Image {
  const img = blank(size, size);
  for (let y = inset; y < size - inset; y++) {
    for (let x = inset; x < size - inset; x++) img.data.set([...rgb, 255], (y * size + x) * 4);
  }
  return img;
}

/** A body with a "nose" on the side it faces, so the facing survives cropping. */
function halfSprite(side: "left" | "right"): Image {
  const img = blank(32, 32);
  const paint = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([200, 50, 50, 255], (y * 32 + x) * 4);
  };
  paint(8, 24, 4, 28);
  if (side === "right") paint(24, 31, 6, 12);
  else paint(1, 8, 6, 12);
  return img;
}

/** Centre of mass (x) of the opaque pixels inside one atlas cell, relative to the cell. */
function cellCentreX(sheet: Image, animation: (typeof ANIMATIONS)[number], column: number): number {
  const r = frameRect(animation, column);
  let sum = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      if (sheet.data[(y * sheet.width + x) * 4 + 3]! > 0) {
        sum += x - r.x;
        n++;
      }
    }
  }
  return n ? sum / n : NaN;
}

test("resolvePokemon uses the vscode-pokemon index for names, forms and numbers", () => {
  assert.equal(resolvePokemon("Pikachu").dex, 25);
  assert.equal(resolvePokemon("Pikachu").key, "pikachu");
  assert.equal(resolvePokemon("#006").name, "Charizard");
  assert.equal(resolvePokemon("mr-mime").name, "Mr. Mime");
  assert.equal(resolvePokemon("garchomp female").key, "garchomp_female");
  assert.equal(resolvePokemon("rotom-wash").hasWalkLeft, true);
  assert.equal(resolvePokemon("445").key, "garchomp"); // base form first
  const sprigatito = resolvePokemon("906", "Sprigatito");
  assert.deepEqual([sprigatito.dex, sprigatito.name, sprigatito.key], [906, "Sprigatito", undefined]);
  assert.throws(() => resolvePokemon("agumon"));
  assert.throws(() => resolvePokemon("2000"));
  assert.ok(listKnownPokemon().length > 600);
});

test("pet ids are stable, readable and mark shinies", () => {
  assert.equal(petIdFor(resolvePokemon("pikachu")), "pokemon-0025-pikachu");
  assert.equal(petIdFor(resolvePokemon("pikachu"), true), "pokemon-0025-pikachu-shiny");
  assert.equal(petIdFor({ dex: 29, name: "Nidoran♀" }), "pokemon-0029-nidoran-f");
});

test("sprite plans: vscode-pokemon pixel first, PokeAPI as fallback or --style hd", () => {
  const garchomp = resolvePokemon("garchomp");
  const [first] = spritePlans(garchomp);
  assert.match(first!.urls.idle, /jakobhoeg\/vscode-pokemon\/[0-9a-f]{40}\/media\/gen4\/garchomp\/default_idle_8fps\.gif$/);
  assert.match(first!.urls.walkLeft ?? "", /default_walk_left_8fps\.gif$/);
  assert.equal(first!.facing, "right");
  assert.match(spritePlans(garchomp, "pixel", true)[0]!.urls.walk ?? "", /shiny_walk_8fps\.gif$/);
  assert.match(spritePlans(garchomp, "hd")[0]!.label, /Black\/White/);
  assert.match(spritePlans({ dex: 906, name: "Sprigatito" })[0]!.label, /Showdown/);
});

test("pixel helpers", () => {
  const img = square(10, 3);
  assert.deepEqual(unionBounds([img]), { x: 3, y: 3, width: 4, height: 4 });
  assert.equal(scale(img, 3).width, 30);
  const half = blank(2, 1);
  half.data.set([255, 0, 0, 255], 0);
  assert.equal(flipX(half).data[4], 255);
  assert.ok(rotate(img, 45).width > img.width);
  assert.deepEqual(sampleFrames([1, 2, 3, 4], 2), [1, 3]);
  assert.deepEqual(sampleFrames(["a", "b"], 5), ["a", "b", "a", "b", "a"]); // short loops cycle
});

test("every row pose list matches the Codex frame count", () => {
  for (const animation of ANIMATIONS) assert.equal(ROW_POSES[animation].length, ANIMATION_SPECS[animation].frames, animation);
});

test("composed sheet fills each used cell and never bleeds into neighbours", () => {
  const sheet = composeSheet(prepareFrames({ facing: "left", idle: [square(60, 5), square(60, 6)] }));
  assert.equal(sheet.width, SHEET_WIDTH);
  assert.equal(sheet.height, SHEET_HEIGHT_V1);
  for (const animation of ANIMATIONS) {
    const spec = ANIMATION_SPECS[animation];
    for (let column = 0; column < 8; column++) {
      let opaque = 0;
      for (let y = spec.row * FRAME_HEIGHT; y < (spec.row + 1) * FRAME_HEIGHT; y++) {
        for (let x = column * FRAME_WIDTH; x < (column + 1) * FRAME_WIDTH; x++) {
          if (sheet.data[(y * sheet.width + x) * 4 + 3]! > 0) opaque++;
        }
      }
      if (column < spec.frames) assert.ok(opaque > 1000, `${animation} frame ${column} is empty`);
      else assert.equal(opaque, 0, `${animation} column ${column} should be blank`);
    }
  }
});

test("walk rows face the way they move, for left- and right-facing sources", () => {
  // Right-facing pixel sprite with a walk cycle (vscode-pokemon style).
  // The nose points forward, so the bulk of the body sits behind the cell
  // centre: left of it when walking right, right of it when walking left.
  const facesRight = (sheet: Image) => cellCentreX(sheet, "running-right", 0) < FRAME_WIDTH / 2 && cellCentreX(sheet, "running-left", 0) > FRAME_WIDTH / 2;
  assert.ok(facesRight(composeSheet(prepareFrames({ facing: "right", idle: [halfSprite("right")], walk: [halfSprite("right")] }))));
  // Left-facing battle sprite without a walk cycle (PokeAPI style).
  assert.ok(facesRight(composeSheet(prepareFrames({ facing: "left", idle: [halfSprite("left")] }))));
});

test("a dedicated walk-left animation is used instead of mirroring", () => {
  const blue = square(32, 4, [0, 0, 255]);
  const sheet = composeSheet(prepareFrames({ facing: "right", idle: [square(32, 4)], walk: [square(32, 4)], walkLeft: [blue] }));
  const r = frameRect("running-left", 0);
  const centre = ((r.y + 150) * sheet.width + r.x + 96) * 4;
  assert.deepEqual([...sheet.data.subarray(centre, centre + 3)], [0, 0, 255]);
});

test("mid-sized sprites are scaled up instead of rounded down to 1x", () => {
  const big = prepareFrames({ facing: "left", idle: [square(84, 2)] }).idle[0]!;
  assert.ok(big.width >= 140 && big.width <= 150, String(big.width));
  assert.equal(prepareFrames({ facing: "left", idle: [square(40, 0)] }).idle[0]!.width, 120); // clean 3x
  assert.equal(prepareFrames({ facing: "right", idle: [square(32, 0)] }).idle[0]!.width, 128); // vscode 32px -> 4x
});

test("buildPet writes a valid Codex pet folder from animated GIFs", async () => {
  const sharp = (await import("sharp")).default;
  const gif = async (a: Image, b: Image) => {
    const strip = Buffer.concat([Buffer.from(a.data), Buffer.from(b.data)]);
    return sharp(strip, { raw: { width: a.width, height: a.height * 2, channels: 4, pageHeight: a.height } as never }).gif().toBuffer();
  };
  const idle = await gif(square(32, 4, [255, 0, 0]), square(32, 5, [255, 0, 0]));
  const walk = await gif(square(32, 3, [0, 0, 255]), square(32, 6, [0, 0, 255]));
  assert.equal((await decodeFrames(idle)).length, 2);

  const root = mkdtempSync(join(tmpdir(), "pokee-pets-"));
  const pet = await buildPet(resolvePokemon("pikachu"), { label: "test", facing: "right", idle, walk }, { root, shiny: true });
  const metadata = validatePetMetadata(JSON.parse(readFileSync(join(pet.dir, "pet.json"), "utf8")));
  assert.equal(metadata.id, "pokemon-0025-pikachu-shiny");
  assert.equal(metadata.displayName, "Shiny Pikachu");
  const info = await sharp(readFileSync(join(pet.dir, "spritesheet.webp"))).metadata();
  assert.deepEqual([info.format, info.width, info.height], ["webp", SHEET_WIDTH, SHEET_HEIGHT_V1]);
});
