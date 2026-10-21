import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CLAUDE_HOOK_EVENTS } from "../adapters/claude.js";
import { addPokeeHooks, findPokeeCommands, hasPokeeHooks, hookCommand, removePokeeHooks, updateSettingsFile } from "./claude-settings.js";
import { addNotify, hasForeignNotify, notifyLine, removeNotify } from "./codex-config.js";

const command = hookCommand(["/usr/bin/node", "/opt/My Tools/pokee/dist/cli.js"]);

test("hook command quotes paths with spaces and carries the marker", () => {
  assert.equal(command, '/usr/bin/node "/opt/My Tools/pokee/dist/cli.js" hook --agent claude --pokeeclaude');
});

test("install adds every hook event and keeps foreign hooks", () => {
  const existing = {
    model: "opus",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
  };
  const next = addPokeeHooks(existing, command) as { model: string; hooks: Record<string, unknown[]> };
  assert.equal(next.model, "opus");
  for (const event of CLAUDE_HOOK_EVENTS) assert.ok(next.hooks[event], event);
  assert.equal(next.hooks.Stop!.length, 2);
  assert.deepEqual(findPokeeCommands(next), [command]);
});

test("install is idempotent and replaces older PokeeClaude hooks", () => {
  const once = addPokeeHooks({}, "old/cli.js hook --pokeeclaude");
  const twice = addPokeeHooks(addPokeeHooks(once, command), command);
  assert.deepEqual(findPokeeCommands(twice), [command]);
  assert.equal((twice.hooks as Record<string, unknown[]>).Stop!.length, 1);
});

test("uninstall removes only PokeeClaude hooks", () => {
  const foreign = { hooks: [{ type: "command", command: "say done" }] };
  const installed = addPokeeHooks({ hooks: { Stop: [foreign] } }, command);
  const removed = removePokeeHooks(installed);
  assert.deepEqual(removed, { hooks: { Stop: [foreign] } });
  assert.equal(hasPokeeHooks(removed), false);
  assert.deepEqual(removePokeeHooks(addPokeeHooks({}, command)), {});
});

test("settings file update writes a backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "pokee-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify({ theme: "dark" }));
  const result = updateSettingsFile(path, (s) => addPokeeHooks(s, command));
  assert.equal(result.changed, true);
  assert.ok(result.backup && readdirSync(dir).some((f) => f.startsWith("settings.json.bak-")));
  assert.equal(JSON.parse(readFileSync(path, "utf8")).theme, "dark");
  assert.equal(updateSettingsFile(path, (s) => addPokeeHooks(s, command)).changed, false);
});

test("codex notify goes above the first table and can be removed", () => {
  const line = notifyLine(["/usr/bin/node", "/x/cli.js"]);
  const toml = 'model = "gpt-5"\n\n[mcp_servers.x]\ncommand = "y"\n';
  const added = addNotify(toml, line);
  assert.ok(added.indexOf("notify") < added.indexOf("[mcp_servers.x]"));
  assert.equal(addNotify(added, line), added);
  assert.equal(removeNotify(added).trim(), toml.trim());
  assert.ok(addNotify("", line).includes('"--pokeeclaude"'));
});

test("codex install refuses to clobber an existing notify", () => {
  const toml = 'notify = ["terminal-notifier"]\n';
  assert.equal(hasForeignNotify(toml), true);
  assert.throws(() => addNotify(toml, "notify = []"));
  assert.equal(hasForeignNotify('[tui]\nnotify = true\n'), false);
});
