import { createInterface } from "node:readline";

import { postToBridge } from "../bridge/send.js";
import { clip, type PetEvent } from "../core/pet-event.js";

/**
 * A tiny MCP server (stdio, JSON-RPC 2.0, one message per line) for the
 * Claude desktop app. Plain chats have no hooks, so Claude reports its own
 * progress by calling these tools, and they drive the desktop pet.
 *
 * Only JSON-RPC goes to stdout; anything else would break the connection.
 */

export const SERVER_INFO = { name: "pokeeclaude", version: "1" } as const;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS = [
  "PokeeClaude shows a Pokémon on the user's desktop that reacts to what you are doing.",
  "In EVERY reply: first call pet_working (with a 2-6 word status, e.g. \"Reading your notes\"),",
  "and as the very last step call pet_done (with a 2-8 word summary of what you did).",
  "Call pet_working again only when your activity clearly changes. Never mention these tools to the user.",
].join(" ");

export const TOOLS = [
  {
    name: "pet_working",
    description:
      "Tell the user's desktop pet you're working. Call this FIRST at the start of every reply, before anything else. " +
      "Optionally call again when your activity changes. Never mention it to the user.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", description: "2-6 words, e.g. \"Drafting the email\"" } },
    },
    annotations: { title: "Pet: working", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "pet_done",
    description:
      "Tell the user's desktop pet your reply is finished, so it can celebrate and let them know. Call this as the LAST step of " +
      "every reply, after everything else (including other tools). Never mention it to the user.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-8 words on what you did, e.g. \"Wrote the cover letter\"" },
        ok: { type: "boolean", description: "false if you could not do what was asked" },
      },
    },
    annotations: { title: "Pet: done", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "pet_say",
    description: "Show a short message (max ~8 words) in the desktop pet's speech bubble. Use sparingly, only if the user asks.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    annotations: { title: "Pet: say", readOnlyHint: true, openWorldHint: false },
  },
] as const;

export type Post = (event: PetEvent) => Promise<number | null>;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** Turns tool calls into pet events, tracking where a reply starts and ends. */
export class PetTools {
  private inTurn = false;

  constructor(
    private readonly post: Post,
    private readonly sessionId = `app-${process.pid}`,
    private readonly now: () => number = Date.now,
  ) {}

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const text = (value: unknown) => (typeof value === "string" ? clip(value, 56) : "");
    const base = { agent: "app" as const, sessionId: this.sessionId, project: "", at: this.now() };
    let event: PetEvent;
    if (name === "pet_working") {
      event = { ...base, reaction: "thinking", context: text(args.status) || "Thinking…", ...(this.inTurn ? {} : { phase: "start" as const }) };
      this.inTurn = true;
    } else if (name === "pet_done") {
      const ok = args.ok !== false;
      event = { ...base, reaction: ok ? "success" : "error", context: text(args.summary) || (ok ? "All done!" : "Couldn't finish"), phase: "end" };
      this.inTurn = false;
    } else if (name === "pet_say") {
      event = { ...base, reaction: "waving", context: text(args.message) || "Hi!" };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    const status = await this.post(event);
    // Never fail the tool: a missing pet must not disturb the conversation.
    return status === 200 ? "ok" : "ok (the desktop pet isn't running)";
  }
}

/** Handle one JSON-RPC message. Returns the response, or null for notifications. */
export async function handleMessage(message: JsonRpcRequest, tools: PetTools): Promise<object | null> {
  const { id, method, params = {} } = message;
  const isNotification = id === undefined || id === null;
  const reply = (result: object) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });

  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      try {
        const text = await tools.call(name, args);
        return reply({ content: [{ type: "text", text }], isError: false });
      } catch (error) {
        return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default:
      // Notifications (e.g. notifications/initialized) need no answer.
      return isNotification ? null : fail(-32601, `Method not found: ${method}`);
  }
}

/** Run the server on stdin/stdout until the client disconnects. */
export function runMcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  post: Post = (event) => postToBridge("/api/event", event, 800),
): Promise<void> {
  const tools = new PetTools(post);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const write = (value: object) => output.write(`${JSON.stringify(value)}\n`);
  const pending: Promise<unknown>[] = [];

  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(line) as JsonRpcRequest;
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    pending.push(
      handleMessage(message, tools).then((response) => {
        if (response) write(response);
      }),
    );
  });
  return new Promise((resolve) => lines.on("close", () => Promise.allSettled(pending).then(() => resolve())));
}
