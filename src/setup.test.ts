import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { hookLauncherPath, hookLauncherScript, hookRunner } from "./setup.js";

test("plain Node runs hooks with node + cli.js", () => {
  const [node, cli] = hookRunner();
  assert.equal(node, process.env.POKEECLAUDE_NODE ?? process.execPath);
  assert.match(cli ?? "", /cli\.js$/);
});

test("launcher paths per platform", () => {
  assert.match(hookLauncherPath("win32"), /pokeeclaude-hook\.cmd$/);
  assert.match(hookLauncherPath("darwin"), /bin[\\/]pokeeclaude-hook$/);
});

test("POSIX launcher runs the app binary as Node, even with awkward paths", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "pokee it's here "));
  // Fake "app binary": prints the env flag and its arguments.
  const fakeApp = join(dir, "Poke App");
  writeFileSync(fakeApp, '#!/bin/sh\necho "$ELECTRON_RUN_AS_NODE|$*"\n');
  chmodSync(fakeApp, 0o755);
  const launcher = join(dir, "pokeeclaude-hook");
  writeFileSync(launcher, hookLauncherScript(fakeApp, "/Applications/Pokee Claude.app/cli.js", "darwin"));
  chmodSync(launcher, 0o755);
  const out = execFileSync(launcher, ["hook", "--agent", "claude"]).toString().trim();
  assert.equal(out, "1|/Applications/Pokee Claude.app/cli.js hook --agent claude");
});

test("Windows launcher sets the flag and forwards arguments", () => {
  const script = hookLauncherScript("C:\\Program Files\\PokeeClaude\\PokeeClaude.exe", "C:\\app\\dist\\cli.js", "win32");
  assert.equal(script, '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\PokeeClaude\\PokeeClaude.exe" "C:\\app\\dist\\cli.js" %*\r\n');
});

test("hooks log one line per call, without prompt text", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "pokee-log-"));
  const out = execFileSync(process.execPath, ["--import", "tsx", join(import.meta.dirname, "cli.ts"), "hook", "--agent", "claude"], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s", cwd: "/w/demo", prompt: "my secret plan" }),
    env: { ...process.env, POKEECLAUDE_HOME: home, POKEECLAUDE_PORT: "1" },
  }).toString();
  assert.equal(out, ""); // hooks must print nothing
  const log = readFileSync(join(home, "activity.log"), "utf8");
  assert.match(log, /claude UserPromptSubmit project=demo -> thinking \(pet not running\)\n$/);
  assert.doesNotMatch(log, /secret/);
});

test("app start re-points old PokeeClaude hooks at this version, leaving others alone", async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { syncAgentHooks } = await import("./setup.js");
  const dir = mkdtempSync(join(tmpdir(), "pokee-sync-"));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const old = "/usr/local/bin/node /Users/me/old-PokeeClaude/dist/cli.js hook --agent claude --pokeeclaude";
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: old }] }, { hooks: [{ type: "command", command: "say done" }] }],
      },
    }));
    assert.deepEqual(syncAgentHooks(), { claude: true, codex: false });
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    const all = JSON.stringify(settings);
    assert.doesNotMatch(all, /old-PokeeClaude/);
    assert.match(all, /say done/);
    assert.ok(settings.hooks.SessionStart, "missing hook events are added too");
    // Already up to date: nothing to do.
    assert.deepEqual(syncAgentHooks(), { claude: false, codex: false });
    // Not installed at all: stays not installed.
    writeFileSync(join(dir, "settings.json"), "{}");
    assert.deepEqual(syncAgentHooks(), { claude: false, codex: false });
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});
