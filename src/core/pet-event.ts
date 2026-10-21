import { isReaction, type Reaction } from "./reactions.js";

export type AgentName = "claude" | "codex" | "manual";

/**
 * One update sent from an agent hook to the desktop pet.
 * Deliberately small: no prompts, file contents or full paths unless the
 * user opts in (see config.showPrompt).
 */
export interface PetEvent {
  readonly agent: AgentName;
  /** Agent session / thread id, used to track several sessions at once. */
  readonly sessionId: string;
  /** Folder name of the project the agent runs in. */
  readonly project: string;
  readonly reaction: Reaction;
  /** Short human-readable context shown in the speech bubble. */
  readonly context: string;
  /** Session ended: drop it from the board. */
  readonly ended?: boolean;
  /** "start": the user sent a prompt. "end": the agent finished its reply. */
  readonly phase?: "start" | "end";
  /** File name (no path) the agent is changing, for the end-of-turn summary. */
  readonly file?: string;
  readonly at: number;
}

export const MAX_CONTEXT_LENGTH = 60;

/** Collapse whitespace and cut to a bubble-friendly length. */
export function clip(text: string, max = MAX_CONTEXT_LENGTH): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Validate an event received over the wire. Returns null for junk. */
export function parsePetEvent(value: unknown): PetEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!isReaction(r.reaction)) return null;
  const agent = r.agent === "claude" || r.agent === "codex" || r.agent === "manual" ? r.agent : "manual";
  return {
    agent,
    sessionId: typeof r.sessionId === "string" && r.sessionId ? clip(r.sessionId, 80) : "default",
    project: typeof r.project === "string" ? clip(r.project, 40) : "",
    reaction: r.reaction,
    context: typeof r.context === "string" ? clip(r.context) : "",
    ...(r.ended === true ? { ended: true } : {}),
    ...(r.phase === "start" || r.phase === "end" ? { phase: r.phase } : {}),
    ...(typeof r.file === "string" && r.file ? { file: clip(r.file, 80) } : {}),
    at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : Date.now(),
  };
}
