import assert from "node:assert/strict";
import { test } from "node:test";

import { describeTool, mapClaudeHook, programOf } from "./claude.js";
import { mapCodexPayload } from "./codex.js";

const base = { session_id: "s1", cwd: "/Users/ash/code/pallet-town/" };

test("Claude events map to reactions with short context", () => {
  const cases: [Record<string, unknown>, string, string][] = [
    [{ hook_event_name: "SessionStart", source: "startup" }, "waving", "Ready to help!"],
    [{ hook_event_name: "UserPromptSubmit", prompt: "secret plan" }, "thinking", "Thinking…"],
    [{ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/a/b/app.ts" } }, "editing", "Editing app.ts"],
    [{ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/a/b/new.ts" } }, "editing", "Writing new.ts"],
    [{ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/a/README.md" } }, "thinking", "Reading README.md"],
    [{ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm test --watch=false" } }, "testing", "Running tests"],
    [{ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status", description: "Show git status" } }, "running", "Show git status"],
    [{ hook_event_name: "PreToolUse", tool_name: "mcp__github__create_issue", tool_input: {} }, "working", "Using github · create_issue"],
    [{ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf dist" } }, "waiting", "Needs your OK · Running rm"],
    [{ hook_event_name: "Stop" }, "success", "All done!"],
    [{ hook_event_name: "StopFailure", error: "rate_limit" }, "error", "Stopped · rate_limit"],
  ];
  for (const [payload, reaction, context] of cases) {
    const event = mapClaudeHook({ ...base, ...payload }, { now: 1 });
    assert.equal(event?.reaction, reaction, JSON.stringify(payload));
    assert.equal(event?.context, context, JSON.stringify(payload));
    assert.equal(event?.project, "pallet-town");
    assert.equal(event?.sessionId, "s1");
  }
});

test("prompt text only shows when opted in", () => {
  const event = mapClaudeHook({ ...base, hook_event_name: "UserPromptSubmit", prompt: "catch them all" }, { showPrompt: true });
  assert.equal(event?.context, "“catch them all”");
});

test("the idle notice after a reply doesn't replace the done pill", () => {
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "Notification", notification_type: "idle_prompt" }), null);
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "Notification", message: "Claude is waiting for your input" }), null);
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "Notification", message: "Claude needs your permission to use Bash" })?.reaction, "waiting");
});

test("SessionEnd removes the session; unknown events are ignored", () => {
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "SessionEnd" })?.ended, true);
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "PostToolUse" }), null);
  assert.equal(mapClaudeHook("nope"), null);
  assert.equal(mapClaudeHook([1]), null);
});

test("Bash context never leaks full commands", () => {
  const { context } = describeTool("Bash", { command: "API_KEY=abc123 curl -H 'x: secret' https://x.dev" });
  assert.equal(context, "Running curl");
  assert.equal(programOf("sudo /usr/bin/apt install x"), "apt");
});

test("Codex notify payloads map to success; hook payloads reuse the Claude mapper", () => {
  const done = mapCodexPayload({ type: "agent-turn-complete", "thread-id": "t1", cwd: "/w/proj", "last-assistant-message": "Fixed it" });
  assert.deepEqual([done?.agent, done?.reaction, done?.context, done?.project, done?.sessionId], ["codex", "success", "All done!", "proj", "t1"]);
  const withText = mapCodexPayload({ type: "agent-turn-complete", "last-assistant-message": "Fixed it" }, { showPrompt: true });
  assert.equal(withText?.context, "Fixed it");
  const hook = mapCodexPayload({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cargo test" } });
  assert.deepEqual([hook?.agent, hook?.reaction], ["codex", "testing"]);
  assert.equal(mapCodexPayload({ type: "something-else" }), null);
});

test("prompts start a turn, Stop/StopFailure end it, edits carry the file name", () => {
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "UserPromptSubmit", prompt: "x" })?.phase, "start");
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "Stop" })?.phase, "end");
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "StopFailure" })?.phase, "end");
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/p/src/app.ts" } })?.file, "app.ts");
  assert.equal(mapClaudeHook({ ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/p/a.ts" } })?.file, undefined);
  const reply = { ...base, hook_event_name: "Stop", last_assistant_message: "Fixed the login bug" };
  assert.equal(mapClaudeHook(reply)?.context, "All done!");
  assert.equal(mapClaudeHook(reply, { showPrompt: true })?.context, "Fixed the login bug");
  assert.equal(mapCodexPayload({ type: "agent-turn-complete" })?.phase, "end");
});
