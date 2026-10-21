# Part 1: the Codex (ChatGPT) pets, re-engineered

OpenAI's Codex app ships "pets": a small animated companion that sits on the
desktop and reacts to what the agent is doing. This page writes down how that
system works, as rebuilt in `src/core/`. Claude Code has no built-in
equivalent, so Part 2 (the rest of this repo) plugs Claude Code into the same
model.

## 1. A pet is two files

```
~/.codex/pets/<id>/
  pet.json
  spritesheet.webp
```

`pet.json`:

```json
{
  "id": "dewey",
  "displayName": "Dewey",
  "description": "A tidy duck for calm desk days.",
  "spritesheetPath": "spritesheet.webp"
}
```

- `id`: lowercase letters, digits and dashes. It must match the folder name.
- `spritesheetPath`: always the file next to `pet.json`. Paths are never free-form.
- `spriteVersionNumber: 2` (optional): the sheet has two extra rows for
  cursor-gaze frames (see below).

Validation: `validatePetMetadata()` in `src/core/pet-format.ts`.

## 2. The spritesheet atlas

A fixed grid: **8 columns × 9 rows** of **192 × 208 px** frames, so
1536 × 1872 px. A v2 sheet is 11 rows (1536 × 2288).

| Row | Animation       | Frames | Loop         | Used for                            |
|-----|-----------------|--------|--------------|-------------------------------------|
| 0   | `idle`          | 6      | forever      | nothing happening                   |
| 1   | `running-right` | 8      | while moving | walking right across the desktop    |
| 2   | `running-left`  | 8      | while moving | walking left                        |
| 3   | `waving`        | 4      | 2×           | hello / needs a look                |
| 4   | `jumping`       | 5      | 2×           | task finished                       |
| 5   | `failed`        | 8      | 2×           | error                               |
| 6   | `waiting`       | 6      | forever      | blocked, waiting on a person, tests |
| 7   | `running`       | 6      | forever      | working, editing, running commands  |
| 8   | `review`        | 6      | forever      | thinking / reading                  |
| 9–10| gaze (v2 only)  | 8      | n/a          | eyes follow the cursor when idle    |

Unused cells to the right of a row are transparent. A renderer only needs the
first nine rows, so v1 and v2 pets play the same way.

Spec: `ANIMATION_SPECS`, `frameRect()` and `frameAt()` in `src/core/pet-format.ts`.

## 3. Reactions → rows

The agent doesn't pick animations. It reports a **reaction** and the pet maps
that to a row:

| Reaction   | Row       |
|------------|-----------|
| idle       | idle      |
| thinking   | review    |
| working    | running   |
| editing    | running   |
| running    | running   |
| testing    | waiting   |
| waiting    | waiting   |
| waving     | waving    |
| success    | jumping   |
| error      | failed    |

`waving`, `success` and `error` are one-shots: they play their iterations and
then the pet drops back to `idle`. Source: `src/core/reactions.ts`.

## 4. Behaviour

- **Always-on-top, transparent, frameless window.** Only the pet itself takes
  clicks; the rest passes through to the apps underneath.
- **Wandering.** When idle, the pet walks a short distance left or right
  every so often, using rows 1 and 2.
- **Status bubble.** A small speech bubble says what the agent is up to
  ("Editing app.ts", "Needs your OK"), plus an attention marker when the agent
  is blocked on you.
- **Several sessions.** Sessions waiting on you take priority, then the most
  recently active one. The rest show up as a "+N busy" count.

## 5. How Codex reports activity

Codex CLI runs a `notify` program from `~/.codex/config.toml` at the end of
every turn. It passes one JSON argument:

```json
{"type":"agent-turn-complete","thread-id":"…","turn-id":"…","cwd":"/path",
 "input-messages":["…"],"last-assistant-message":"…"}
```

Codex lifecycle hooks use the same payload shape as Claude Code hooks
(`hook_event_name`, `session_id`, `tool_name`, …). `src/adapters/codex.ts`
handles both.

## 6. What this repo does with it

- `pokeeclaude list` and the tray menu show your existing `~/.codex/pets`,
  which play in PokeeClaude without changes.
- Pokémon pets (sprites from vscode-pokemon or PokeAPI) are generated in the same format
  (`~/.pokeeclaude/pets/<id>/pet.json` + `spritesheet.webp`), so you can
  copy them into `~/.codex/pets` and use them in Codex too.
- Part 2 sends Claude Code hooks into the same reaction model, which gives
  Claude Code the pet feature it doesn't have.
