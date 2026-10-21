import assert from "node:assert/strict";
import { test } from "node:test";

import { ANIMATION_SPECS, ANIMATIONS, COLUMNS, frameAt, frameRect, SHEET_HEIGHT_V1, SHEET_WIDTH, validatePetMetadata } from "./pet-format.js";
import { clip, parsePetEvent, type PetEvent } from "./pet-event.js";
import { REACTION_ANIMATION, REACTIONS } from "./reactions.js";
import { formatDuration, SessionBoard, SESSION_TTL_MS, summarize } from "./session-board.js";

test("atlas matches the Codex 8x9 grid of 192x208 frames", () => {
  assert.equal(SHEET_WIDTH, 1536);
  assert.equal(SHEET_HEIGHT_V1, 1872);
  const rows = ANIMATIONS.map((a) => ANIMATION_SPECS[a].row);
  assert.deepEqual(rows, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const a of ANIMATIONS) assert.ok(ANIMATION_SPECS[a].frames <= COLUMNS);
  assert.deepEqual(frameRect("failed", 2), { x: 384, y: 1040, width: 192, height: 208 });
});

test("every reaction maps to a real animation row", () => {
  for (const reaction of REACTIONS) assert.ok(ANIMATIONS.includes(REACTION_ANIMATION[reaction]));
});

test("frameAt loops infinite rows and finishes one-shot rows", () => {
  assert.deepEqual(frameAt("idle", 0), { frame: 0, done: false });
  assert.equal(frameAt("idle", ANIMATION_SPECS.idle.durationMs * 3 + 1).done, false);
  const wave = ANIMATION_SPECS.waving;
  assert.equal(frameAt("waving", wave.durationMs * wave.iterations! - 1).done, false);
  assert.deepEqual(frameAt("waving", wave.durationMs * wave.iterations! + 1), { frame: wave.frames - 1, done: true });
});

test("pet.json validation accepts Codex pets and rejects bad ids/paths", () => {
  const ok = { id: "dewey", displayName: "Dewey", description: "A duck", spritesheetPath: "spritesheet.webp" };
  assert.equal(validatePetMetadata(ok).id, "dewey");
  assert.throws(() => validatePetMetadata({ ...ok, id: "../evil" }));
  assert.throws(() => validatePetMetadata({ ...ok, spritesheetPath: "../../etc/passwd" }));
  assert.throws(() => validatePetMetadata({ ...ok, spriteVersionNumber: 3 }));
});

test("clip flattens whitespace and control characters", () => {
  assert.equal(clip("a\n\tb   c"), "a b c");
  assert.equal(clip("x".repeat(100), 10), `${"x".repeat(9)}…`);
});

test("parsePetEvent rejects junk and fills defaults", () => {
  assert.equal(parsePetEvent({ reaction: "dance" }), null);
  assert.equal(parsePetEvent("hello"), null);
  const event = parsePetEvent({ reaction: "thinking", agent: "who" });
  assert.equal(event?.agent, "manual");
  assert.equal(event?.sessionId, "default");
});

const ev = (sessionId: string, reaction: PetEvent["reaction"], at: number, extra: Partial<PetEvent> = {}): PetEvent => ({
  agent: "claude",
  sessionId,
  project: sessionId,
  reaction,
  context: "",
  at,
  ...extra,
});

test("board focuses the session that needs the user", () => {
  const board = new SessionBoard();
  board.apply(ev("a", "editing", 1));
  board.apply(ev("b", "waiting", 2));
  const view = board.apply(ev("a", "running", 3));
  assert.equal(view.focus?.sessionId, "b");
  assert.equal(view.othersActive, 1);
});

test("board prefers busy sessions over finished ones", () => {
  const board = new SessionBoard();
  board.apply(ev("a", "editing", 1));
  const view = board.apply(ev("b", "success", 2));
  assert.equal(view.focus?.sessionId, "a");
  assert.equal(view.othersActive, 0);
});

test("board shows the latest finished session when nothing is busy", () => {
  const board = new SessionBoard();
  board.apply(ev("a", "success", 1));
  assert.equal(board.apply(ev("b", "success", 2)).focus?.sessionId, "b");
});

test("board drops ended and stale sessions", () => {
  const board = new SessionBoard();
  board.apply(ev("a", "editing", 1));
  assert.equal(board.apply(ev("a", "idle", 2, { ended: true })).sessions, 0);
  board.apply(ev("b", "editing", 0));
  assert.equal(board.view(SESSION_TTL_MS + 1).sessions, 0);
});

test("a finished turn is summarised with duration, files and commands", () => {
  const board = new SessionBoard();
  board.apply(ev("t", "thinking", 1_000, { phase: "start" }));
  board.apply(ev("t", "editing", 2_000, { file: "a.ts" }));
  board.apply(ev("t", "editing", 3_000, { file: "a.ts" }));
  board.apply(ev("t", "editing", 4_000, { file: "b.ts" }));
  board.apply(ev("t", "testing", 5_000));
  board.apply(ev("t", "running", 6_000));
  const view = board.apply(ev("t", "success", 135_000, { phase: "end", context: "All done!" }));
  assert.equal(view.focus?.context, "Done in 2m 14s · 2 files · 2 commands");
  assert.deepEqual(view.focus?.turn, { durationMs: 134_000, files: 2, commands: 2, ok: true });
  // The next turn starts counting from zero.
  board.apply(ev("t", "thinking", 140_000, { phase: "start" }));
  assert.equal(board.apply(ev("t", "success", 143_000, { phase: "end", context: "All done!" })).focus?.context, "Done in 3s");
});

test("turn summary keeps custom replies and handles a missing start", () => {
  assert.equal(summarize({ durationMs: null, files: 1, commands: 0, ok: true }, "All done!"), "All done! · 1 file");
  assert.equal(summarize({ durationMs: 5_000, files: 0, commands: 1, ok: true }, "Fixed the bug"), "Fixed the bug · 1 command");
  assert.equal(formatDuration(3_700_000), "1h 01m");
  const board = new SessionBoard();
  board.apply(ev("x", "thinking", 0, { phase: "start" }));
  const failed = board.apply(ev("x", "error", 9_000, { phase: "end", context: "Stopped · rate_limit" }));
  assert.equal(failed.focus?.context, "Stopped · rate_limit");
  assert.equal(failed.focus?.turn?.ok, false);
});
