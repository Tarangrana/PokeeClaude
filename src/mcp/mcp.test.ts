import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { PetEvent } from "../core/pet-event.js";
import { addMcpServer, claudeDesktopConfigPath, getMcpServer, mcpEntry, removeMcpServer } from "../install/claude-desktop.js";
import { handleMessage, PetTools, TOOLS } from "./server.js";

const collect = () => {
  const events: PetEvent[] = [];
  return { events, post: async (e: PetEvent) => (events.push(e), 200) };
};

test("initialize negotiates the protocol and carries instructions", async () => {
  const tools = new PetTools(collect().post);
  const res = (await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, tools)) as {
    result: { protocolVersion: string; capabilities: object; instructions: string; serverInfo: { name: string } };
  };
  assert.equal(res.result.protocolVersion, "2025-03-26");
  assert.deepEqual(res.result.capabilities, { tools: {} });
  assert.match(res.result.instructions, /pet_working/);
  assert.equal(res.result.serverInfo.name, "pokeeclaude");
  const unknown = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, tools)) as {
    result: { protocolVersion: string };
  };
  assert.equal(unknown.result.protocolVersion, "2025-06-18");
});

test("lists three pet tools; unknown methods error; notifications get no reply", async () => {
  const tools = new PetTools(collect().post);
  const list = (await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, tools)) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ["pet_working", "pet_done", "pet_say"]);
  assert.equal(TOOLS.every((t) => t.inputSchema.type === "object"), true);
  const missing = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "resources/list" }, tools)) as { error: { code: number } };
  assert.equal(missing.error.code, -32601);
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, tools), null);
});

test("a reply becomes one turn: first pet_working starts it, pet_done ends it", async () => {
  const { events, post } = collect();
  const tools = new PetTools(post, "s", () => 1);
  await tools.call("pet_working", { status: "Reading your notes" });
  await tools.call("pet_working", { status: "Drafting the email" });
  await tools.call("pet_done", { summary: "Wrote the email" });
  await tools.call("pet_working", {});
  assert.deepEqual(
    events.map((e) => [e.agent, e.reaction, e.context, e.phase ?? ""]),
    [
      ["app", "thinking", "Reading your notes", "start"],
      ["app", "thinking", "Drafting the email", ""],
      ["app", "success", "Wrote the email", "end"],
      ["app", "thinking", "Thinking…", "start"],
    ],
  );
  await tools.call("pet_done", { ok: false });
  assert.deepEqual([events.at(-1)?.reaction, events.at(-1)?.context], ["error", "Couldn't finish"]);
});

test("tool calls never fail just because the pet isn't running", async () => {
  const tools = new PetTools(async () => null);
  const res = (await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pet_done", arguments: {} } },
    tools,
  )) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(res.result.isError, false);
  assert.match(res.result.content[0]!.text, /isn't running/);
  const bad = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope" } }, tools)) as {
    result: { isError: boolean };
  };
  assert.equal(bad.result.isError, true);
});

test("over real stdio, the Claude app's calls reach the pet bridge", async () => {
  process.env.POKEECLAUDE_HOME = mkdtempSync(join(tmpdir(), "pokee-mcp-"));
  const { startBridge } = await import("../bridge/server.js");
  const bridge = await startBridge(0);
  try {
    const child = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "..", "cli.ts"), "mcp"], {
      env: { ...process.env, POKEECLAUDE_PORT: String(bridge.port) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    const waitFor = async (id: number) => {
      for (let i = 0; i < 100; i++) {
        const hit = out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: number }).find((m) => m.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`no reply for ${id}: ${out}`);
    };
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } } });
    await waitFor(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pet_working", arguments: { status: "Planning your trip" } } });
    await waitFor(2);
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pet_done", arguments: { summary: "Planned a 3-day trip" } } });
    assert.deepEqual((await waitFor(3) as unknown as { result: { content: { text: string }[] } }).result.content[0]!.text, "ok");
    child.stdin.end();
    await new Promise((r) => child.on("close", r));
    // Every stdout line must be JSON-RPC (anything else breaks the Claude app's connection).
    for (const line of out.split("\n").filter(Boolean)) assert.equal(JSON.parse(line).jsonrpc, "2.0");
    const res = await fetch(`http://127.0.0.1:${bridge.port}/api/state`);
    const state = (await res.json()) as { lastEvent: PetEvent; view: { focus: { agent: string; reaction: string; context: string } } };
    assert.deepEqual([state.lastEvent.agent, state.lastEvent.phase], ["app", "end"]);
    assert.deepEqual(
      [state.view.focus.agent, state.view.focus.reaction, state.view.focus.context],
      ["app", "success", "Planned a 3-day trip"],
    );
  } finally {
    await bridge.close();
  }
});

test("Claude app config: add, update and remove only our server", () => {
  const entry = mcpEntry({ exec: "/Applications/PokeeClaude.app/Contents/MacOS/PokeeClaude", cli: "/x/dist/cli.js", asNode: true });
  assert.deepEqual(entry, {
    command: "/Applications/PokeeClaude.app/Contents/MacOS/PokeeClaude",
    args: ["/x/dist/cli.js", "mcp"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(mcpEntry({ exec: "/usr/bin/node", cli: "/x/cli.js", asNode: false }).env, undefined);
  const existing = { globalShortcut: "Ctrl+Space", mcpServers: { filesystem: { command: "npx", args: ["fs"] } } };
  const added = addMcpServer(existing, entry);
  assert.deepEqual(getMcpServer(added), entry);
  assert.deepEqual((added.mcpServers as Record<string, unknown>).filesystem, { command: "npx", args: ["fs"] });
  assert.equal(added.globalShortcut, "Ctrl+Space");
  assert.deepEqual(removeMcpServer(added), existing);
  assert.equal(getMcpServer({}), null);
  // join() uses the host separator, so this has to pass on Windows CI too.
  assert.match(claudeDesktopConfigPath("darwin", {}), /Library[\\/]Application Support[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(claudeDesktopConfigPath("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }), /Claude[\\/]claude_desktop_config\.json$/);
});
