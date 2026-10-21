import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Codex CLI reads `notify = [...]` from ~/.codex/config.toml and runs that
 * program with a JSON payload whenever a turn completes.
 */

const BEGIN = "# >>> pokeeclaude >>>";
const END = "# <<< pokeeclaude <<<";

export function codexConfigPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");
}

/** `runner` is the program that runs the CLI, as for hookCommand(). */
export function notifyLine(runner: readonly string[]): string {
  const parts = [...runner, "hook", "--agent", "codex", "--pokeeclaude"].map((part) => JSON.stringify(part));
  return `notify = [${parts.join(", ")}]`;
}

/** Top-level `notify` key that we did not write. TOML forbids defining it twice. */
export function hasForeignNotify(toml: string): boolean {
  return topLevel(stripManaged(toml)).some((line) => /^\s*notify\s*=/.test(line));
}

export function addNotify(toml: string, line: string): string {
  if (hasForeignNotify(toml)) {
    throw new Error("Codex config already has a `notify` setting. Remove it or merge it by hand, then run install again.");
  }
  const body = stripManaged(toml);
  const block = `${BEGIN}\n${line}\n${END}\n`;
  // Top-level keys must come before the first [table] header.
  const lines = body.split("\n");
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  if (firstTable === -1) return `${body.replace(/\n*$/, body.trim() ? "\n\n" : "")}${block}`;
  const head = lines.slice(0, firstTable).join("\n").replace(/\n*$/, "");
  const tail = lines.slice(firstTable).join("\n");
  return `${head ? `${head}\n\n` : ""}${block}\n${tail}`;
}

export function removeNotify(toml: string): string {
  return stripManaged(toml).replace(/\n{3,}/g, "\n\n");
}

export function hasManagedNotify(toml: string): boolean {
  return toml.includes(BEGIN);
}

export function updateCodexConfig(transform: (toml: string) => string, dryRun = false) {
  const path = codexConfigPath();
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = transform(before);
  const changed = before !== after;
  let backup: string | null = null;
  if (changed && !dryRun) {
    if (existsSync(path)) {
      backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      copyFileSync(path, backup);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, after);
  }
  return { path, backup, changed };
}

function stripManaged(toml: string): string {
  const pattern = new RegExp(`${escape(BEGIN)}[\\s\\S]*?${escape(END)}\\n?`, "g");
  return toml.replace(pattern, "");
}

function topLevel(toml: string): string[] {
  const lines = toml.split("\n");
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  return firstTable === -1 ? lines : lines.slice(0, firstTable);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
