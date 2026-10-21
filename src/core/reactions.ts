import type { Animation } from "./pet-format.js";

/**
 * What the agent is doing, independent of how a pet draws it.
 * Same vocabulary as Codex pets / OpenPets so pets stay interchangeable.
 */
export const REACTIONS = [
  "idle",
  "thinking",
  "working",
  "editing",
  "running",
  "testing",
  "waiting",
  "waving",
  "success",
  "error",
] as const;

export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: unknown): value is Reaction {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}

/** Codex's default reaction → spritesheet row mapping. */
export const REACTION_ANIMATION: Record<Reaction, Animation> = {
  idle: "idle",
  thinking: "review",
  working: "running",
  editing: "running",
  running: "running",
  testing: "waiting",
  waiting: "waiting",
  waving: "waving",
  success: "jumping",
  error: "failed",
};

/** Reactions that play once and then fall back to idle. */
export const ONE_SHOT_REACTIONS: ReadonlySet<Reaction> = new Set(["waving", "success", "error"]);

/** Reactions that mean "the human needs to look at this". */
export const ATTENTION_REACTIONS: ReadonlySet<Reaction> = new Set(["waiting", "error"]);

export const REACTION_ICON: Record<Reaction, string> = {
  idle: "💤",
  thinking: "💭",
  working: "⚙️",
  editing: "✏️",
  running: "▶️",
  testing: "🧪",
  waiting: "✋",
  waving: "👋",
  success: "✅",
  error: "❌",
};
