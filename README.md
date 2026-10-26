# PokeeClaude

**Pokémon desktop pets for Claude Code — and for Claude app chats.**

[![CI](https://github.com/Tarangrana/PokeeClaude/actions/workflows/ci.yml/badge.svg)](https://github.com/Tarangrana/PokeeClaude/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Tarangrana/PokeeClaude?sort=semver)](https://github.com/Tarangrana/PokeeClaude/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-5fa04e)](https://nodejs.org)

## About

PokeeClaude puts an animated Pokémon on your desktop that reacts to what Claude
is doing: it thinks while Claude thinks, shows "Editing cli.ts", asks for your
attention when Claude needs permission, and jumps with "Done in 2m 14s · 3 files"
when a turn finishes. It works with **Claude Code** in the terminal (through
hooks), with **normal chats in the Claude desktop app** (through a tiny local MCP
server) and with **Codex CLI**.

Everything runs on your machine: a local bridge on `127.0.0.1`, no account, no
telemetry, no prompts or code leaving the computer. Free and MIT licensed —
installers for macOS, Windows and Linux are on the
[Releases page](https://github.com/Tarangrana/PokeeClaude/releases/latest), and
[CONTRIBUTING.md](CONTRIBUTING.md) has everything you need to hack on it.

Codex (ChatGPT) has desktop pets: a little animated companion that sits on
your screen and shows what the agent is doing. Claude Code doesn't. PokeeClaude
rebuilds the Codex pet system and connects it to Claude Code's hooks, with a
Pokémon of your choice as the pet.

```
 ┌───────────────────────────┐
 │ ✏️ Editing cli.ts          │
 │ [PokeeClaude] [Claude]     │
 └────────────┬──────────────┘
              ▼
            (Pikachu)   ← always on top, walks around when idle
```

- **Shows context:** a dark status pill with "Thinking…", "Editing cli.ts",
  "Run the test suite", "Needs your OK · Running rm", plus the project name.
  It fades away on its own while Claude works, and comes back when you hover.
- **Tells you when Claude is done:** the pet jumps and a green pill shows
  "Done in 2m 14s · 3 files · 4 commands" until you've seen it. Longer turns
  play a chime and send a system notification (turn off under ⌄).
- **Hover toolbar:** ✎ change Pokémon · progress updates on/off ("Done" and
  "Needs you" always show) · ⌄ size, walking, sound and notifications.
- **Troubleshooting built in:** tray → **Test the Done message** plays a fake
  finished task; **Copy diagnostics** copies the version, hook commands and
  recent activity (no prompts or code); **Open activity log** shows each hook
  Claude sent.
- **Self-updating hooks:** every app start points Claude Code's hooks at the
  installed version, so updates take effect after restarting Claude Code.
- **Reacts:** thinks, works, waits, jumps when done, greys out on errors.
- **Multi-session:** a session waiting on you takes priority; the others show
  as "+N busy".
- **Any Pokémon:** `pokeeclaude add pikachu`, `add garchomp --shiny`, `add rotom-wash`.
  629 Pokémon and forms (Gen 1–5) get pixel sprites with real walk cycles, and
  any dex number 1–1025 works with `--style hd`.
- **Claude app chats too:** tick **Claude app chats** in setup and normal
  conversations in the Claude desktop app show "Planning your trip…" → "Planned
  a 3-day trip ✓" (see [Claude desktop app](#claude-desktop-app)).
- **Codex-compatible:** pets use the Codex format, so your `~/.codex/pets`
  work here and the Pokémon pets work in Codex. Codex CLI can drive the pet too.

## Install

### Option 1: installer (no Node.js needed)

Download the latest installer from the
[Releases page](https://github.com/Tarangrana/PokeeClaude/releases/latest):

| System | File |
|---|---|
| macOS (Apple Silicon: M1/M2/M3/M4) | `PokeeClaude-<version>-mac-arm64.dmg` |
| macOS (Intel) | `PokeeClaude-<version>-mac-x64.dmg` |
| Windows | `PokeeClaude-<version>-win-x64.exe` |
| Linux | `PokeeClaude-<version>-linux-x86_64.AppImage` |

1. **macOS:** open the `.dmg` and drag **PokeeClaude** into **Applications**.
   **Windows:** run the `.exe` and follow the installer.
   **Linux:** make the AppImage executable (`chmod +x`) and run it.
2. Open PokeeClaude. The **setup window** appears: pick a Pokémon (search,
   filter by generation, shiny toggle), keep **Claude Code** ticked, and click **Install**.
3. Restart Claude Code once. Your Pokémon now reacts to everything Claude does.

PokeeClaude lives in the menu bar / system tray. Use **Choose Pokémon…** there
to switch, or open the app again.

**First launch warnings.** The installers aren't signed with a paid Apple or
Microsoft certificate yet, so your system will warn you once:

- **macOS:** "PokeeClaude can't be opened" / "Apple could not verify…". Click
  **Done**, then open **System Settings → Privacy & Security**, scroll down and
  click **Open Anyway** next to PokeeClaude.
- **Windows:** "Windows protected your PC". Click **More info → Run anyway**.

### Option 2: from source

You need [Node.js](https://nodejs.org) 20 or newer. Download this repository,
then double-click the launcher for your system:

- macOS: `PokeeClaude.command` (the first time, right-click → **Open**)
- Windows: `PokeeClaude.bat`
- Linux: `pokeeclaude.sh`

The first run installs everything (about a minute), then the same setup window opens.

### Option 3: terminal

```bash
npm install && npm run build
node dist/cli.js add pikachu     # download + build the pet
node dist/cli.js install         # add hooks to ~/.claude/settings.json
node dist/cli.js start           # put Pikachu on your desktop
```

No desktop window? `pokeeclaude setup` and `pokeeclaude serve` run the same setup
page and pet in a browser tab.

### Uninstall

Untick **Claude Code** in the setup window and click the button (or run
`pokeeclaude uninstall`), then delete the app and the `~/.pokeeclaude` folder.

## Claude desktop app

Claude Code sessions report through hooks automatically. **Normal chats** in
the Claude desktop app have no hooks, so PokeeClaude adds a small local MCP
server ("pokeeclaude") with three tools: `pet_working`, `pet_done` and
`pet_say`. Claude is asked to call `pet_working` at the start of every reply
and `pet_done` at the end, which drives the same status pill, "Done" pill,
chime and notification.

- Turn it on: it is **ticked by default** in the setup window when the Claude
  desktop app is installed — click the button, then restart the Claude app.
  (Untick it there if you only want the terminal.)
- It's best effort: Claude decides when to call the tools, and each reply
  shows a small "used pet_done" line in the chat.
- Code sessions in the Claude app running on your Mac already use the hooks;
  cloud sessions can't reach your Mac.
- Turn it off by unticking it again; other MCP servers in
  `claude_desktop_config.json` are never touched.

## Commands

| Command | What it does |
|---|---|
| `pokeeclaude add <pokemon> [--shiny] [--style hd]` | Build a pet from a name, form or dex number (`--name N`, `--file F` also work) |
| `pokeeclaude search [text]` | Find Pokémon that have pixel sprites |
| `pokeeclaude use <pet-id>` | Switch pets (the running pet swaps immediately) |
| `pokeeclaude list` | Your pets plus any Codex pets in `~/.codex/pets` |
| `pokeeclaude setup` | Open the setup window (Pokémon list + connect agents) |
| `pokeeclaude start` | Launch the desktop pet (tray icon: choose Pokémon, size, bubble, quit) |
| `pokeeclaude serve` | Run the pet in a browser tab instead |
| `pokeeclaude install [--project] [--codex]` | Add hooks to Claude Code (user or project), and optionally Codex `notify` |
| `pokeeclaude uninstall [--project] [--codex]` | Remove only PokeeClaude's hooks (backups are kept) |
| `pokeeclaude say <reaction> [text]` | Send a test reaction |
| `pokeeclaude config showPrompt=true` | Settings: `showPrompt`, `showBubble`, `wander`, `scale` |
| `pokeeclaude doctor` | Check hooks, pets and whether the desktop pet is running |

## How it works

```
Claude Code ──hook (stdin JSON)──▶ pokeeclaude hook ──POST──▶ bridge (127.0.0.1:47823)
Codex CLI ───notify (argv JSON)──▶ pokeeclaude hook ─┘            │ session board
                                                                  ▼ SSE
                                              desktop window (Electron) / browser tab
                                              plays the Codex spritesheet + bubble
```

| Claude Code hook | Pet |
|---|---|
| `SessionStart` | waves: "Ready to help!" |
| `UserPromptSubmit` | thinking |
| `PreToolUse` Edit/Write | running animation: "Editing app.ts" |
| `PreToolUse` Read/Grep/Glob/Web | thinking: "Reading README.md" |
| `PreToolUse` Bash | running, or waiting animation for test commands; uses the command's description |
| `PreToolUse` Task / MCP | working: "Using github · create_issue" |
| `PermissionRequest` / `Notification` | waiting + red "!": "Needs your OK · …" |
| `Stop` | jumps: "All done!" |
| `StopFailure` | greys out: "Stopped · rate_limit" |
| `SessionEnd` | session removed |

The Codex pet format is documented in [docs/codex-pets.md](docs/codex-pets.md).

### Pokémon sprites

`pokeeclaude add` downloads sprites on your machine. Two styles are available:

- **pixel (default):** the overworld sprites from
  [jakobhoeg/vscode-pokemon](https://github.com/jakobhoeg/vscode-pokemon),
  pinned to a fixed commit. Each Pokémon has its own idle and walk animations,
  a walk-left animation where the sprite isn't symmetric, and a shiny version.
  These play directly as the idle, walking and "working" rows.
- **hd (`--style hd`, and the fallback for Pokémon not in vscode-pokemon):**
  the bigger battle sprites from [PokeAPI/sprites](https://github.com/PokeAPI/sprites):
  Black/White animated, then Showdown animated, then a still.

The other rows are generated from the idle animation: a waving hop, a
squash-and-stretch jump, a thinking tilt, and a greyed-out wobble for errors.
Downloads are cached in `~/.pokeeclaude/cache`.

The list of names (`src/pokemon/vscode-index.ts`) is generated from
vscode-pokemon's CC0 data by `scripts/gen-vscode-index.mjs`.

No Pokémon artwork is stored in this repository. Pokémon and all related
names and artwork are © Nintendo / Creatures Inc. / GAME FREAK inc. This is a
non-commercial fan project and is not affiliated with or endorsed by them.

## Privacy

Everything stays on your machine. The bridge only listens on 127.0.0.1,
rejects other hostnames, and only accepts JSON POSTs, so web pages can't drive
it. The bubble shows file names (not paths) and Bash descriptions or program
names (not full commands). Prompt text is off unless you set
`showPrompt=true`.

## Development

```bash
npm install
npm test          # node:test via tsx
npm run typecheck
npm run build
npm run dist      # installer for the current OS, into release/
```

### Building the installers

`.github/workflows/release.yml` builds all installers on GitHub's Mac,
Windows and Linux machines:

- **Actions → Build installers → Run workflow** builds them and attaches
  them to the run (download them under "Artifacts").
- Pushing a version tag publishes a GitHub Release with them:
  `git tag v0.1.0 && git push origin v0.1.0`.

The installed app runs Claude Code's hooks with its own built-in runtime
(Electron in Node mode, through `~/.pokeeclaude/bin/pokeeclaude-hook`), so
people don't need Node.js.

```
src/core/       Codex pet format, reactions, session board (Part 1)
src/adapters/   Claude Code + Codex payload → pet event
src/bridge/     local HTTP + SSE server, hook client
src/install/    safe edits to Claude settings.json / Codex config.toml
src/pokemon/    sprite download, frame decode, Codex atlas builder
src/setup.ts    setup window API: Pokédex, connect agents, build pets
renderer/       pet page (canvas + bubble) and setup page, shared by Electron and browser
desktop/        Electron shell: transparent pet window, setup window, tray, app icon
scripts/        icon + vscode-pokemon index generators
.github/        installer build workflow
```

## Contributing

Bug reports and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Found a bug? Open an issue with the
output of **tray → Copy diagnostics**. CI runs `npm test` and `npm run typecheck`
on Linux, macOS and Windows for every PR.

Inspired by [claude-pets](https://github.com/alvinunreal/claude-pets) /
[OpenPets](https://github.com/OpenPetsHQ/openpets).
