// Setup window: pick a Pokémon, connect agents, start the pet. Talks to the
// local PokeeClaude server, which does the downloading and config edits.
const $ = (id) => document.getElementById(id);

const state = {
  dex: [],
  status: null,
  gen: 0,
  shiny: false,
  query: "",
  selected: null,
  busy: false,
};

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function init() {
  const [dex, status] = await Promise.all([api("/api/pokedex"), api("/api/setup/status")]);
  state.dex = dex;
  state.status = status;
  renderGens();
  renderAgents();
  renderMine();
  // Pre-select the active pet, or Pikachu for first-timers.
  const active = dex.find((p) => p.id === status.activePet || p.shinyId === status.activePet);
  if (active && active.shinyId === status.activePet) {
    state.shiny = true;
    $("shiny").checked = true;
  }
  select(active ?? dex.find((p) => p.key === "pikachu") ?? null, false);
  renderGrid();
}

// ---------- filters ----------

function renderGens() {
  const gens = [0, ...new Set(state.dex.map((p) => p.gen))];
  $("gens").replaceChildren(
    ...gens.map((gen) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = gen ? `Gen ${gen}` : "All";
      button.setAttribute("aria-pressed", String(state.gen === gen));
      button.addEventListener("click", () => {
        state.gen = gen;
        renderGens();
        renderGrid();
      });
      return button;
    }),
  );
}

$("search").addEventListener("input", (e) => {
  state.query = e.target.value.trim().toLowerCase();
  renderGrid();
});

$("shiny").addEventListener("change", (e) => {
  state.shiny = e.target.checked;
  renderGrid();
  if (state.selected) select(state.selected, false);
});

function visible() {
  const q = state.query.replace(/^#0*/, "");
  return state.dex.filter((p) => {
    if (state.gen && p.gen !== state.gen) return false;
    if (state.shiny && !p.shiny) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.key.includes(q.replace(/[\s-]+/g, "_")) || String(p.dex) === q;
  });
}

// ---------- grid ----------

function renderGrid() {
  const list = visible();
  $("count").textContent = `${list.length} Pokémon`;
  $("grid").replaceChildren(...list.map(card));
}

function card(p) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mon";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(state.selected?.key === p.key));
  button.dataset.key = p.key;
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  img.src = state.shiny && p.previewShiny ? p.previewShiny : p.preview;
  // Offline or blocked: show a neutral placeholder instead of a broken image.
  img.addEventListener("error", () => img.classList.add("missing"), { once: true });
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = p.name;
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = `#${String(p.dex).padStart(3, "0")}`;
  button.append(img, name, num);
  if (state.shiny ? p.installedShiny : p.installed) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "✓";
    badge.title = "Installed";
    button.append(badge);
  }
  button.addEventListener("click", () => select(p, true));
  return button;
}

function select(p, scroll) {
  state.selected = p;
  for (const el of document.querySelectorAll(".mon")) el.setAttribute("aria-selected", String(el.dataset.key === p?.key));
  const preview = $("preview");
  if (!p) {
    preview.hidden = true;
    $("preview-empty").hidden = false;
    updateButton();
    return;
  }
  const shiny = state.shiny && p.shiny;
  preview.src = shiny ? p.previewShiny : p.preview;
  preview.alt = p.name;
  preview.hidden = false;
  $("preview-empty").hidden = true;
  $("sel-name").textContent = `${shiny ? "Shiny " : ""}${p.name}`;
  $("sel-meta").textContent = `#${String(p.dex).padStart(3, "0")} · Generation ${p.gen}`;
  if (scroll) setMessage("");
  updateButton();
}

// ---------- agents & pets ----------

function renderAgents() {
  const { claude, codex, claudeApp } = state.status;
  $("agent-app").checked = claudeApp.installed;
  $("app-status").textContent = claudeApp.error
    ? `Can't read the Claude app's config: ${claudeApp.error}`
    : claudeApp.installed
      ? "Connected · Claude reports when chats finish"
      : "Adds a small MCP tool to the Claude desktop app";
  $("agent-claude").checked = claude.installed || !claude.error;
  $("claude-status").textContent = claude.error
    ? `Can't read settings: ${claude.error}`
    : claude.installed ? "Connected" : "Adds hooks to ~/.claude/settings.json";
  $("agent-codex").checked = codex.installed;
  $("agent-codex").disabled = codex.blocked && !codex.installed;
  $("codex-status").textContent = codex.blocked && !codex.installed
    ? "Your Codex config already has its own notify command"
    : codex.installed ? "Connected" : "Adds a notify command to ~/.codex/config.toml";
  updateButton();
}

function renderMine() {
  const { pets, activePet } = state.status;
  $("mine-card").hidden = pets.length === 0;
  $("mine").replaceChildren(
    ...pets.map((pet) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = pet.source === "codex" ? `${pet.displayName} (Codex)` : pet.displayName;
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = pet.id === activePet ? "On desktop" : "Use";
      use.disabled = pet.id === activePet;
      use.addEventListener("click", async () => {
        await api("/api/config", { activePet: pet.id });
        await refreshStatus();
        setMessage(`${pet.displayName} is on your desktop.`, "ok");
      });
      li.append(label, use);
      return li;
    }),
  );
}

async function refreshStatus() {
  state.status = await api("/api/setup/status");
  renderAgents();
  renderMine();
}

function updateButton() {
  const p = state.selected;
  const go = $("go");
  go.disabled = state.busy || !p;
  if (!p) {
    go.textContent = "Choose a Pokémon";
    return;
  }
  const name = `${state.shiny && p.shiny ? "Shiny " : ""}${p.name}`;
  const firstTime = state.status && !state.status.claude.installed;
  go.textContent = state.busy ? "Working…" : firstTime ? `Install with ${name}` : `Use ${name}`;
}

function setMessage(text, kind = "") {
  const el = $("message");
  el.textContent = text;
  el.className = `message ${kind}`;
}

// ---------- install ----------

$("go").addEventListener("click", async () => {
  const p = state.selected;
  if (!p || state.busy) return;
  state.busy = true;
  updateButton();
  const shiny = state.shiny && p.shiny;
  try {
    const wantClaude = $("agent-claude").checked;
    const wantCodex = $("agent-codex").checked && !$("agent-codex").disabled;
    const agents = {};
    // Always (re)write Claude's hooks when ticked, so they point at this version.
    if (wantClaude || state.status.claude.installed) agents.claude = wantClaude;
    if (wantCodex !== state.status.codex.installed && !$("agent-codex").disabled) agents.codex = wantCodex;
    const wantApp = $("agent-app").checked;
    if (wantApp || state.status.claudeApp.installed) agents.claudeApp = wantApp;
    const appNew = wantApp && !state.status.claudeApp.installed;
    const newlyConnected = agents.claude === true || agents.codex === true;
    if (Object.keys(agents).length) {
      setMessage("Connecting agents…");
      await api("/api/setup/agents", agents);
    }
    setMessage(`Downloading ${p.name}…`);
    const pet = await api("/api/setup/add", { key: p.key, shiny });
    p[shiny ? "installedShiny" : "installed"] = true;
    await refreshStatus();
    renderGrid();
    const restart = [newlyConnected && "Claude Code", appNew && "the Claude app"].filter(Boolean).join(" and ");
    setMessage(
      restart ? `${pet.displayName} is on your desktop! Restart ${restart} once so it picks this up.` : `${pet.displayName} is on your desktop!`,
      "ok",
    );
    window.pokeeSetup?.done();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    state.busy = false;
    updateButton();
  }
});

init().catch((error) => setMessage(`Can't reach PokeeClaude: ${error.message}`, "error"));
