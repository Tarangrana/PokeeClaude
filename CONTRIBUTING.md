# Contributing to PokeeClaude

Thanks for helping out! PokeeClaude is a small TypeScript + Electron project, so
getting started takes a minute.

## Setup

```bash
npm install
npm test          # node:test via tsx
npm run typecheck
npm run build
node dist/cli.js setup   # the setup window, against your own ~/.pokeeclaude
```

Working on the pages in `renderer/`? `node dist/cli.js serve` runs the pet and
the setup page in a browser tab — no Electron rebuild needed, just reload.

Use a throwaway home so you don't touch your real config:

```bash
POKEECLAUDE_HOME=/tmp/pokee POKEECLAUDE_PORT=47999 node dist/cli.js serve
```

## Before you open a PR

- `npm test` and `npm run typecheck` pass (CI runs both).
- New non-trivial logic comes with a test next to it (`src/**/*.test.ts`).
- Match the style of the file you're editing: small functions, comments only
  for the *why*, no new dependencies unless there is no other way.
- Anything that edits a user's `~/.claude/settings.json`, `claude_desktop_config.json`
  or `~/.codex/config.toml` must be idempotent, keep foreign entries untouched
  and write a backup. See `src/install/`.
- Keep the privacy promise: no prompt text, file contents or full paths leave
  the machine or reach the bubble unless the user opts in (`showPrompt`).

## Where things live

| Path | What |
|---|---|
| `src/core/` | pet format, reactions, session board |
| `src/adapters/` | Claude Code / Codex payload → pet event |
| `src/bridge/` | local HTTP + SSE server on 127.0.0.1 |
| `src/install/` | safe edits to agent config files |
| `src/mcp/` | MCP server that lets Claude app chats drive the pet |
| `src/pokemon/` | sprite download and spritesheet building |
| `renderer/` | pet page and setup page (plain HTML/CSS/JS) |
| `desktop/` | Electron shell, tray, notifications |

## Reporting bugs

Open an issue with the template and paste the output of **tray → Copy
diagnostics** (it contains no prompts or code).

## Pokémon artwork

No sprites are stored in this repository and none should be added — they are
downloaded on the user's machine at runtime. This is a non-commercial fan
project; Pokémon is © Nintendo / Creatures Inc. / GAME FREAK inc.
