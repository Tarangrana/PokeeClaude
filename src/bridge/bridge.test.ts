import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

process.env.POKEECLAUDE_HOME = mkdtempSync(join(tmpdir(), "pokee-home-"));
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "pokee-codex-"));
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "pokee-claude-"));

const { startBridge } = await import("./server.js");
const { postToBridge } = await import("./send.js");
type Bridge = Awaited<ReturnType<typeof startBridge>>;

let bridge: Bridge;
before(async () => {
  bridge = await startBridge(0);
});
after(() => bridge.close());

function http(method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: bridge.port, path, method, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("health check identifies the bridge", async () => {
  const res = await http("GET", "/api/health");
  assert.equal(JSON.parse(res.text).name, "pokeeclaude");
});

test("events update the board and reach SSE listeners", async () => {
  const received = new Promise<string>((resolve) => {
    const req = request({ host: "127.0.0.1", port: bridge.port, path: "/api/events" }, (res) => {
      res.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes("event: view")) {
          req.destroy();
          resolve(text);
        }
      });
    });
    req.end();
  });
  await new Promise((r) => setTimeout(r, 50));
  const status = await postToBridge("/api/event", { agent: "claude", sessionId: "s", project: "p", reaction: "editing", context: "Editing a.ts" }, 1000, bridge.port);
  assert.equal(status, 200);
  assert.match(await received, /Editing a\.ts/);
  const state = JSON.parse((await http("GET", "/api/state")).text);
  assert.equal(state.view.focus.reaction, "editing");
});

test("non-JSON posts, bad events and foreign hosts are refused", async () => {
  assert.equal((await http("POST", "/api/event", "{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await http("POST", "/api/event", '{"reaction":"nope"}', { "content-type": "application/json" })).status, 400);
  assert.equal((await http("GET", "/api/health", undefined, { host: "evil.example" })).status, 403);
});

test("static files are served and path traversal is blocked", async () => {
  assert.equal((await http("GET", "/")).status, 200);
  assert.equal((await http("GET", "/pet.js")).status, 200);
  assert.notEqual((await http("GET", "/..%2fpackage.json")).status, 200);
  assert.equal((await http("GET", "/api/pets/../../x/sheet")).status, 404);
});

test("postToBridge returns null when nothing is listening", async () => {
  assert.equal(await postToBridge("/api/event", {}, 200, 1), null);
});

const postJson = (path: string, body: unknown) => http("POST", path, JSON.stringify(body), { "content-type": "application/json" });

test("setup: pokedex lists pixel Pokémon with previews", async () => {
  const dex = JSON.parse((await http("GET", "/api/pokedex")).text) as { key: string; id: string; preview: string }[];
  assert.ok(dex.length > 600);
  const pikachu = dex.find((p) => p.key === "pikachu");
  assert.equal(pikachu?.id, "pokemon-0025-pikachu");
  assert.equal(pikachu?.preview, "/api/sprite/pikachu");
  assert.equal((await http("GET", "/api/sprite/not_a_pokemon")).status, 404);
});

test("setup: agents can be connected and disconnected from the window", async () => {
  const status = () => http("GET", "/api/setup/status").then((r) => JSON.parse(r.text));
  assert.equal((await status()).claude.installed, false);
  assert.equal((await postJson("/api/setup/agents", { claude: true })).status, 200);
  assert.equal((await status()).claude.installed, true);
  const settings = JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR!, "settings.json"), "utf8"));
  assert.match(settings.hooks.Stop[0].hooks[0].command, /cli\.js" hook --agent claude --pokeeclaude$|cli\.js hook --agent claude --pokeeclaude$/);
  await postJson("/api/setup/agents", { claude: false });
  assert.equal((await status()).claude.installed, false);
});

test("setup: bad requests get a readable error and need JSON", async () => {
  const res = await postJson("/api/setup/add", { key: "agumon" });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.text).error, /Unknown Pokémon/);
  assert.equal((await http("POST", "/api/setup/agents", "{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await http("GET", "/setup")).status, 200);
});
