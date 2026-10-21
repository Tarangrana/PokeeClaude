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
