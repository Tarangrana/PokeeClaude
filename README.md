# PokeeClaude

**Pokémon desktop pets for Claude Code.**

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
  also send a system notification with a sound (turn off under ⌄ → Notify when done).
- **Hover toolbar:** ✎ change Pokémon · status pill on/off · ⌄ size, walking and notifications.
- **Reacts:** thinks, works, waits, jumps when done, greys out on errors.
- **Multi-session:** a session waiting on you takes priority; the others show
  as "+N busy".
- **Any Pokémon:** `pokeeclaude add pikachu`, `add garchomp --shiny`, `add rotom-wash`.
  629 Pokémon and forms (Gen 1–5) get pixel sprites with real walk cycles, and
  any dex number 1–1025 works with `--style hd`.
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

Inspired by [claude-pets](https://github.com/alvinunreal/claude-pets) /
[OpenPets](https://github.com/OpenPetsHQ/openpets).
