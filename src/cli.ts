#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isReaction, REACTIONS } from "./core/reactions.js";
import { VERSION } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = realpathSync(fileURLToPath(import.meta.url));

const HELP = `PokeeClaude ${VERSION} — Pokémon desktop pets for Claude Code and Codex

Pets
  pokeeclaude add <pokemon> [--shiny] [--style hd]   Build a pet (e.g. "add pikachu", "add garchomp --shiny")
  pokeeclaude search [text]                         Find Pokémon with pixel sprites (629, Gen 1-5)
  pokeeclaude use <pet-id>                          Switch the pet on the desktop
  pokeeclaude list                                  List installed pets (yours + ~/.codex/pets)

Desktop
  pokeeclaude setup                                 Open the setup window (pick a Pokémon, connect agents)
  pokeeclaude start                                 Launch the desktop pet (Electron)
  pokeeclaude serve                                 Run the pet in your browser instead
  pokeeclaude say <reaction> [text]                 Send a test reaction (${REACTIONS.join(", ")})

Agents
  pokeeclaude install [--project] [--codex] [--dry-run]   Add hooks to Claude Code (and Codex)
  pokeeclaude uninstall [--project] [--codex]             Remove them again
  pokeeclaude doctor                                      Check the setup
  pokeeclaude config [key=value ...]                      showPrompt, showBubble, wander, scale

Internal
  pokeeclaude hook --agent claude|codex             Called by the agent; reads the event payload
  pokeeclaude mcp                                   MCP server for the Claude desktop app (started by the app)
`;

async function main(argv: string[]): Promise<number> {
  const [command = "help", ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const positional = positionalArgs(rest);

  switch (command) {
    case "mcp": {
      // Started by the Claude desktop app; speaks MCP on stdin/stdout.
      const { runMcpServer } = await import("./mcp/server.js");
      await runMcpServer();
      return 0;
    }
    case "hook": {
      const { runHook } = await import("./hook.js");
      return runHook(option(rest, "--agent") ?? "claude", rest);
    }
    case "add":
      return addPet(positional[0], {
        name: option(rest, "--name"),
        file: option(rest, "--file"),
        style: option(rest, "--style"),
        shiny: flags.has("--shiny"),
        activate: !flags.has("--no-activate"),
      });
    case "search":
      return searchPokemon(positional.join(" "));
    case "use":
      return usePet(positional[0]);
    case "list":
      return listCommand();
    case "start":
      return startDesktop();
    case "setup":
      return setup();
    case "serve":
      return serve();
    case "say":
      return say(positional[0], positional.slice(1).join(" "));
    case "install":
    case "uninstall":
      return installCommand(command === "install", option(rest, "--project") ?? (flags.has("--project") ? process.cwd() : undefined), flags.has("--codex"), flags.has("--dry-run"));
    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      return runDoctor(cliPath);
    }
    case "config":
      return configCommand(positional);
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    default:
      console.log(HELP);
      return command === "help" || command === "--help" || command === "-h" ? 0 : 1;
  }
}

interface AddOptions {
  readonly name?: string;
  readonly file?: string;
  readonly style?: string;
  readonly shiny: boolean;
  readonly activate: boolean;
}

async function addPet(input: string | undefined, options: AddOptions) {
  if (!input) {
    console.error("Usage: pokeeclaude add <pokemon> [--shiny] [--style pixel|hd] [--name N] [--file F]");
    return 1;
  }
  if (options.style && options.style !== "pixel" && options.style !== "hd") {
    console.error('--style must be "pixel" (default) or "hd".');
    return 1;
  }
  const { resolvePokemon } = await import("./pokemon/catalog.js");
  const { downloadSprites } = await import("./pokemon/sprite-source.js");
  const { buildPet } = await import("./pokemon/build-sheet.js");
  const ref = resolvePokemon(input, options.name);
  if (options.shiny && options.style !== "hd" && ref.key && !ref.hasShiny) {
    console.log(`  note: no shiny pixel sprite for ${ref.name}; using the HD shiny sprite instead.`);
  }
  console.log(`Building ${options.shiny ? "shiny " : ""}${ref.name} (#${ref.dex})…`);
  const style = options.style === "hd" || (options.shiny && ref.key && !ref.hasShiny) ? "hd" : "pixel";
  const files = options.file
    ? { label: "local file", idle: readFileSync(options.file), facing: "left" as const }
    : await downloadSprites(ref, style, options.shiny);
  console.log(`  sprite: ${files.label}`);
  const pet = await buildPet(ref, files, { shiny: options.shiny });
  console.log(`  saved:  ${pet.dir}`);
  if (options.activate) await setActive(pet.metadata.id);
  return 0;
}

async function searchPokemon(query: string) {
  const { listKnownPokemon, slug } = await import("./pokemon/catalog.js");
  const wanted = slug(query);
  const matches = listKnownPokemon().filter((p) => !wanted || slug(p.name).includes(wanted) || slug(p.key ?? "").includes(wanted) || String(p.dex) === query);
  for (const p of matches.slice(0, 60)) {
    console.log(`#${String(p.dex).padStart(3, "0")}  ${(p.key ?? "").padEnd(22)} ${p.name}${p.hasShiny ? "  ✨" : ""}`);
  }
  if (matches.length > 60) console.log(`… and ${matches.length - 60} more. Narrow it down, e.g. "pokeeclaude search char".`);
  if (matches.length === 0) console.log("No pixel sprite for that. Any dex number still works with --style hd.");
  return 0;
}

async function usePet(id: string | undefined) {
  const { findPet, listPets } = await import("./pets.js");
  const pet = findPet(id ?? null) ?? listPets().find((p) => p.metadata.displayName.toLowerCase() === id?.toLowerCase());
  if (!pet) {
    console.error(`No installed pet "${id ?? ""}". Run "pokeeclaude list" or "pokeeclaude add <pokemon>".`);
    return 1;
  }
  await setActive(pet.metadata.id);
  return 0;
}

async function setActive(id: string) {
  const { saveConfig } = await import("./config.js");
  const { postToBridge } = await import("./bridge/send.js");
  saveConfig({ activePet: id });
  // Tell a running desktop pet to switch right away.
  await postToBridge("/api/config", { activePet: id });
  console.log(`Active pet: ${id}`);
}

async function listCommand() {
  const { listPets } = await import("./pets.js");
  const { loadConfig } = await import("./config.js");
  const active = loadConfig().activePet;
  const pets = listPets();
  if (pets.length === 0) console.log('No pets yet. Try "pokeeclaude add pikachu".');
  for (const pet of pets) {
    const mark = pet.metadata.id === active ? "*" : " ";
    console.log(`${mark} ${pet.metadata.id.padEnd(36)} ${pet.metadata.displayName.padEnd(16)} ${pet.source}`);
  }
  return 0;
}

function electronBinary(): string | null {
  try {
    return createRequire(import.meta.url)("electron") as unknown as string;
  } catch {
    return null;
  }
}

function launchElectron(electronPath: string, extraArgs: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env, POKEECLAUDE_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [join(here, "..", "desktop", "main.mjs"), ...extraArgs], { detached: true, stdio: "ignore", env });
  child.unref();
}

function startDesktop(): Promise<number> {
  const electronPath = electronBinary();
  if (!electronPath) {
    console.error('Electron is not installed. Run "npm install electron" in the PokeeClaude folder, or use "pokeeclaude serve".');
    return Promise.resolve(1);
  }
  launchElectron(electronPath);
  console.log("Desktop pet started. Use the tray icon to switch Pokémon or quit.");
  return Promise.resolve(0);
}

/** Open the setup window: in the desktop app if possible, otherwise in the browser. */
async function setup(): Promise<number> {
  const electronPath = electronBinary();
  if (electronPath) {
    launchElectron(electronPath, ["--setup"]);
    console.log("Opening PokeeClaude setup…");
    return 0;
  }
  const { startBridge } = await import("./bridge/server.js");
  const { bridgePort } = await import("./config.js");
  let url = `http://127.0.0.1:${bridgePort()}/`;
  try {
    url = (await startBridge()).url;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  }
  openInBrowser(`${url}setup`);
  console.log(`Setup is open in your browser: ${url}setup\nThe pet runs at ${url} — keep this window open (Ctrl+C to stop).`);
  await new Promise(() => {});
  return 0;
}

function openInBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // The URL is printed too.
  }
}

async function serve() {
  const { startBridge } = await import("./bridge/server.js");
  try {
    const bridge = await startBridge();
    console.log(`Pet running at ${bridge.url}  ·  setup at ${bridge.url}setup  (Ctrl+C to stop)`);
    await new Promise(() => {});
    return 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error("A PokeeClaude pet is already running (port in use).");
      return 1;
    }
    throw error;
  }
}

async function say(reaction: string | undefined, text: string) {
  if (!isReaction(reaction)) {
    console.error(`Reaction must be one of: ${REACTIONS.join(", ")}`);
    return 1;
  }
  const { postToBridge } = await import("./bridge/send.js");
  const status = await postToBridge("/api/event", { agent: "manual", sessionId: "manual", project: "", reaction, context: text, at: Date.now() });
  if (status === null) {
    console.error('Pet is not running. Start it with "pokeeclaude start" or "pokeeclaude serve".');
    return 1;
  }
  return 0;
}

async function installCommand(install: boolean, project: string | undefined, codex: boolean, dryRun: boolean) {
  const claude = await import("./install/claude-settings.js");
  const path = claude.claudeSettingsPath(project);
  const command = claude.hookCommand([process.execPath, cliPath]);
  const result = claude.updateSettingsFile(path, (s) => (install ? claude.addPokeeHooks(s, command) : claude.removePokeeHooks(s)), dryRun);
  report("Claude Code", result, dryRun);
  if (install && !dryRun) console.log(`  hook:   ${command}`);

  if (codex) {
    const cfg = await import("./install/codex-config.js");
    const line = cfg.notifyLine([process.execPath, cliPath]);
    const codexResult = cfg.updateCodexConfig((t) => (install ? cfg.addNotify(t, line) : cfg.removeNotify(t)), dryRun);
    report("Codex", codexResult, dryRun);
  }
  if (install && !dryRun) console.log('\nNext: "pokeeclaude add pikachu" then "pokeeclaude start". Restart Claude Code to load the hooks.');
  return 0;
}

function report(name: string, result: { path: string; backup: string | null; changed: boolean }, dryRun: boolean) {
  const verb = !result.changed ? "already up to date" : dryRun ? "would be updated" : "updated";
  console.log(`${name}: ${result.path} ${verb}`);
  if (result.backup) console.log(`  backup: ${result.backup}`);
}

async function configCommand(pairs: string[]) {
  const { loadConfig, saveConfig } = await import("./config.js");
  if (pairs.length === 0) {
    console.log(JSON.stringify(loadConfig(), null, 2));
    return 0;
  }
  const patch: Record<string, unknown> = {};
  for (const pair of pairs) {
    const [key = "", value = ""] = pair.split("=");
    patch[key] = value === "true" ? true : value === "false" ? false : Number.isNaN(Number(value)) ? value : Number(value);
  }
  const next = saveConfig(patch);
  const { postToBridge } = await import("./bridge/send.js");
  await postToBridge("/api/config", next);
  console.log(JSON.stringify(next, null, 2));
  return 0;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function positionalArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      if (["--name", "--file", "--agent", "--project", "--style"].includes(arg) && args[i + 1] && !args[i + 1]!.startsWith("--")) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
    // Hooks must return quickly; don't wait on stray handles (e.g. stdin).
    if (process.argv[2] === "hook") process.exit(code);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
