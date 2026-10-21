import type { AgentName, PetEvent } from "./pet-event.js";
import { ATTENTION_REACTIONS, type Reaction } from "./reactions.js";

const RESTING_REACTIONS: ReadonlySet<Reaction> = new Set(["idle", "success", "waving"]);

/** What happened during one prompt → reply turn. */
export interface TurnSummary {
  /** Milliseconds from the prompt to the reply, when the start was seen. */
  readonly durationMs: number | null;
  /** Distinct files edited. */
  readonly files: number;
  /** Shell commands run. */
  readonly commands: number;
  readonly ok: boolean;
}

export interface SessionState {
  readonly agent: AgentName;
  readonly sessionId: string;
  readonly project: string;
  readonly reaction: Reaction;
  readonly context: string;
  readonly updatedAt: number;
  /** Set on the event that finished a turn. */
  readonly turn?: TurnSummary;
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
 * A "busy" session that has been silent this long no longer holds the pet.
 * Claude Code sends no event when you interrupt a turn (Esc), so without this
 * an interrupted session would hide every later "done" for half an hour.
 */
export const BUSY_STALE_MS = 5 * 60 * 1000;

interface TurnStats {
  startedAt: number | null;
  files: Set<string>;
  commands: number;
}

/**
 * Tracks every agent session that has talked to the pet and decides which one
 * the pet should show. Sessions that need the user (permission, errors) win,
 * then the most recently updated busy session.
 */
export class SessionBoard {
  private readonly sessions = new Map<string, SessionState>();
  private readonly stats = new Map<string, TurnStats>();

  apply(event: PetEvent): PetView {
    const key = `${event.agent}:${event.sessionId}`;
    if (event.ended) {
      this.sessions.delete(key);
      this.stats.delete(key);
      return this.view(event.at);
    }

    const stats = this.track(key, event);
    let context = event.context;
    let turn: TurnSummary | undefined;
    if (event.phase === "end") {
      turn = {
        durationMs: stats.startedAt === null ? null : Math.max(0, event.at - stats.startedAt),
        files: stats.files.size,
        commands: stats.commands,
        ok: event.reaction !== "error",
      };
      if (turn.ok) context = summarize(turn, event.context);
      this.stats.delete(key);
    }

    this.sessions.set(key, {
      agent: event.agent,
      sessionId: event.sessionId,
      project: event.project,
      reaction: event.reaction,
      context,
      updatedAt: event.at,
      ...(turn ? { turn } : {}),
    });
    return this.view(event.at);
  }

  /** Current state of one session, if it's on the board. */
  get(agent: AgentName, sessionId: string): SessionState | undefined {
    return this.sessions.get(`${agent}:${sessionId}`);
  }

  view(now = Date.now()): PetView {
    for (const [key, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(key);
        this.stats.delete(key);
      }
    }
    const all = [...this.sessions.values()];
    const busy = all.filter((s) => isBusy(s) && now - s.updatedAt <= BUSY_STALE_MS);
    const ranked = [...busy].sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt);
    const latest = [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const focus = ranked[0] ?? latest;
    return {
      focus,
      othersActive: Math.max(0, busy.length - (focus && busy.includes(focus) ? 1 : 0)),
      sessions: all.length,
    };
  }

  private track(key: string, event: PetEvent): TurnStats {
    let stats = this.stats.get(key);
    if (!stats || event.phase === "start") {
      stats = { startedAt: event.phase === "start" ? event.at : null, files: new Set(), commands: 0 };
      this.stats.set(key, stats);
    }
    if (event.file) stats.files.add(event.file);
    if (event.reaction === "running" || event.reaction === "testing") stats.commands++;
    return stats;
  }
}

/** "Done in 2m 14s · 3 files · 4 commands" (keeps a custom message if there is one). */
export function summarize(turn: TurnSummary, message = ""): string {
  const parts: string[] = [];
  const custom = message && message !== "All done!" ? message : "";
  parts.push(custom || (turn.durationMs !== null ? `Done in ${formatDuration(turn.durationMs)}` : "All done!"));
  if (turn.files) parts.push(`${turn.files} ${turn.files === 1 ? "file" : "files"}`);
  if (turn.commands) parts.push(`${turn.commands} ${turn.commands === 1 ? "command" : "commands"}`);
  return parts.join(" · ");
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${Math.max(1, total)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Finished sessions (idle, or a done/hello one-shot) don't compete for the pet. */
function isBusy(session: SessionState): boolean {
  return !RESTING_REACTIONS.has(session.reaction);
}

function rank(session: SessionState): number {
  return ATTENTION_REACTIONS.has(session.reaction) ? 1 : 0;
}
