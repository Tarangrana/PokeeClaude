import type { AgentName, PetEvent } from "./pet-event.js";
import { ATTENTION_REACTIONS, type Reaction } from "./reactions.js";

const RESTING_REACTIONS: ReadonlySet<Reaction> = new Set(["idle", "success", "waving"]);

export interface SessionState {
  readonly agent: AgentName;
  readonly sessionId: string;
  readonly project: string;
  readonly reaction: Reaction;
  readonly context: string;
  readonly updatedAt: number;
}

/** What the pet should show right now. */
export interface PetView {
  /** The session the pet is showing, or null when nothing is running. */
  readonly focus: SessionState | null;
  /** Number of other sessions still doing something. */
  readonly othersActive: number;
  /** Total sessions on the board. */
  readonly sessions: number;
}

/** Sessions with no update for this long are dropped. */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Tracks every agent session that has talked to the pet and decides which one
 * the pet should show. Sessions that need the user (permission, errors) win,
 * then the most recently updated busy session.
 */
export class SessionBoard {
  private readonly sessions = new Map<string, SessionState>();

  apply(event: PetEvent): PetView {
    const key = `${event.agent}:${event.sessionId}`;
    if (event.ended) {
      this.sessions.delete(key);
    } else {
      this.sessions.set(key, {
        agent: event.agent,
        sessionId: event.sessionId,
        project: event.project,
        reaction: event.reaction,
        context: event.context,
        updatedAt: event.at,
      });
    }
    return this.view(event.at);
  }

  view(now = Date.now()): PetView {
    for (const [key, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_TTL_MS) this.sessions.delete(key);
    }
    const all = [...this.sessions.values()];
    const busy = all.filter(isBusy);
    const ranked = [...busy].sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt);
    const latest = [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const focus = ranked[0] ?? latest;
    return {
      focus,
      othersActive: Math.max(0, busy.length - (focus && isBusy(focus) ? 1 : 0)),
      sessions: all.length,
    };
  }
}

/** Finished sessions (idle, or a done/hello one-shot) don't compete for the pet. */
function isBusy(session: SessionState): boolean {
  return !RESTING_REACTIONS.has(session.reaction);
}

function rank(session: SessionState): number {
  return ATTENTION_REACTIONS.has(session.reaction) ? 1 : 0;
}
