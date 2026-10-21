import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { bridgePort, loadConfig, saveConfig, type PokeeConfig } from "../config.js";
import { parsePetEvent, type PetEvent } from "../core/pet-event.js";
import { SessionBoard, type PetView, type SessionState } from "../core/session-board.js";
import { findPet, listPets, spritesheetFile } from "../pets.js";
import { VERSION } from "../version.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..");
const rendererDir = join(packageRoot, "renderer");
const libDir = join(here, "..", "core");
const MAX_BODY = 64 * 1024;
const SETUP_POSTS = new Set(["/api/setup/add", "/api/setup/agents"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export interface Bridge {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  /** Feed an event in directly (used by the desktop app and tests). */
  push(event: PetEvent): PetView;
  close(): Promise<void>;
}

export interface BridgeOptions {
  /** Called after every event, with the session's updated state (e.g. to notify when a turn ends). */
  readonly onEvent?: (event: PetEvent, session: SessionState | undefined) => void;
}

/** Start the local bridge on 127.0.0.1. Rejects with EADDRINUSE if one is already running. */
export function startBridge(port = bridgePort(), options: BridgeOptions = {}): Promise<Bridge> {
  const board = new SessionBoard();
  const clients = new Set<ServerResponse>();
  let lastEvent: PetEvent | null = null;

  const broadcast = (type: string, data: unknown) => {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(message);
  };

  const petPayload = (config: PokeeConfig) => {
    const pet = findPet(config.activePet) ?? listPets()[0] ?? null;
    return pet
      ? { id: pet.metadata.id, displayName: pet.metadata.displayName, source: pet.source, sheet: `/api/pets/${pet.metadata.id}/sheet` }
      : null;
  };

  const push = (event: PetEvent) => {
    lastEvent = event;
    const view = board.apply(event);
    broadcast("view", { view, event, session: board.get(event.agent, event.sessionId) ?? null });
    try {
      options.onEvent?.(event, board.get(event.agent, event.sessionId));
    } catch {
      // A listener must never break the bridge.
    }
    return view;
  };

  const server = createServer(async (req, res) => {
    try {
      if (!isLocalHost(req.headers.host)) return send(res, 403, "Forbidden");
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;

      if (req.method === "GET" && path === "/api/health") {
        return json(res, 200, { ok: true, name: "pokeeclaude", version: VERSION });
      }
      if (req.method === "GET" && path === "/api/state") {
        const config = loadConfig();
        return json(res, 200, { config, pet: petPayload(config), view: board.view(), lastEvent });
      }
      if (req.method === "GET" && path === "/api/pets") {
        return json(res, 200, listPets().map((p) => ({ id: p.metadata.id, displayName: p.metadata.displayName, source: p.source })));
      }
      const sheet = /^\/api\/pets\/([a-z0-9-]+)\/sheet$/.exec(path);
      if (req.method === "GET" && sheet) {
        const pet = findPet(sheet[1] ?? null);
        if (!pet) return send(res, 404, "No such pet");
        return file(res, spritesheetFile(pet));
      }
      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": hello\n\n");
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (req.method === "GET" && path === "/api/pokedex") {
        const { pokedex } = await import("../setup.js");
        return json(res, 200, pokedex());
      }
      const sprite = /^\/api\/sprite\/([a-z0-9_]+)$/.exec(path);
      if (req.method === "GET" && sprite) {
        const { spritePreview } = await import("../setup.js");
        const bytes = await spritePreview(sprite[1]!, url.searchParams.get("shiny") === "1").catch(() => null);
        if (!bytes) return send(res, 404, "No sprite");
        res.writeHead(200, { "content-type": "image/gif", "cache-control": "max-age=86400" });
        return res.end(bytes);
      }
      if (req.method === "GET" && path === "/api/setup/status") {
        const { setupStatus } = await import("../setup.js");
        return json(res, 200, setupStatus());
      }
      if (req.method === "POST" && SETUP_POSTS.has(path)) {
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return send(res, 415, "Expected application/json");
        }
        const body = ((await readBody(req)) ?? {}) as Record<string, unknown>;
        const setup = await import("../setup.js");
        try {
          if (path === "/api/setup/add") {
            const pet = await setup.addPokemon(body);
            const config = loadConfig();
            broadcast("config", { config, pet: petPayload(config) });
            return json(res, 200, pet);
          }
          return json(res, 200, setup.setAgents(body));
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (req.method === "POST" && (path === "/api/event" || path === "/api/config")) {
        // Requiring JSON makes browsers send a CORS preflight, which we never
        // approve, so random web pages can't drive the pet.
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return send(res, 415, "Expected application/json");
        }
        const body = await readBody(req);
        if (path === "/api/event") {
          const event = parsePetEvent(body);
          if (!event) return send(res, 400, "Bad event");
          return json(res, 200, push(event));
        }
        const config = saveConfig(pickConfig(body));
        broadcast("config", { config, pet: petPayload(config) });
        return json(res, 200, config);
      }
      if (req.method === "GET") return serveStatic(res, path);
      return send(res, 405, "Method not allowed");
    } catch (error) {
      return send(res, 500, error instanceof Error ? error.message : "Server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/`,
        push,
        close: () =>
          new Promise<void>((done) => {
            for (const client of clients) client.end();
            server.close(() => done());
          }),
      });
    });
  });
}

function serveStatic(res: ServerResponse, path: string) {
  if (path === "/") return file(res, join(rendererDir, "index.html"));
  if (path === "/setup") return file(res, join(rendererDir, "setup.html"));
  if (path === "/icon.png") return file(res, join(packageRoot, "desktop", "icon.png"));
  if (path.startsWith("/lib/")) return safeFile(res, libDir, path.slice("/lib/".length));
  return safeFile(res, rendererDir, path.slice(1));
}

function safeFile(res: ServerResponse, root: string, relative: string) {
  const target = normalize(join(root, relative));
  if (!target.startsWith(root + sep)) return send(res, 403, "Forbidden");
  return file(res, target);
}

function file(res: ServerResponse, path: string) {
  if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, "Not found");
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
}

function pickConfig(body: unknown): Partial<PokeeConfig> {
  if (!body || typeof body !== "object") return {};
  const r = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of ["activePet", "showPrompt", "showBubble", "wander", "scale", "notifyDone", "soundDone"]) if (key in r) patch[key] = r[key];
  return patch as Partial<PokeeConfig>;
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "");
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function send(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}
