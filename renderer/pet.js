// Desktop pet renderer. Runs in the Electron window and in a normal browser
// tab (`pokeeclaude serve`). Plays a Codex-format spritesheet, shows what the
// coding agent is doing in a dark status pill, and offers a hover toolbar.
import { FRAME_HEIGHT, FRAME_WIDTH, frameAt, frameRect } from "/lib/pet-format.js";
import { ONE_SHOT_REACTIONS, REACTION_ANIMATION } from "/lib/reactions.js";

const $ = (id) => document.getElementById(id);
const petEl = $("pet");
const canvas = $("sprite");
const ctx = canvas.getContext("2d");
const statusEl = $("bubble");
const toolbar = $("toolbar");
const menu = $("menu");

const RESTING = new Set(["idle", "success", "waving"]);
const AGENT_LABEL = { claude: "Claude", codex: "Codex", app: "Claude app", manual: "" };
const WALK_SPEED = 70; // px per second

/** How long each kind of status stays up before fading away on its own. */
const STATUS_LIFETIME = {
  busy: 6000, // the pet's animation keeps showing activity after the pill fades
  hello: 4000,
  attention: 0, // stays until the agent moves on
  done: 10 * 60 * 1000, // stays until you notice it (hover / click) or the next prompt
};

const host = window.pokee ?? createBrowserHost();
if (window.pokee) document.body.classList.add("electron");

const state = {
  config: { showBubble: true, wander: true, scale: 0.75, showPrompt: false, notifyDone: true, soundDone: true },
  sheet: null,
  petId: null,
  petName: "",
  reaction: "idle",
  animation: "idle",
  startedAt: performance.now(),
  oneShotDone: false,
  walk: null,
  nextWalkAt: performance.now() + 4000,
  dragging: false,
  hovering: false,
  lastDrawn: "",
  focus: null,
  othersActive: 0,
  status: { mode: null, hideAt: 0, seen: false },
  toolbarHideTimer: 0,
};

// ---------- data ----------

async function init() {
  const snapshot = await (await fetch("/api/state")).json();
  applyConfig(snapshot.config, snapshot.pet);
  applyView(snapshot.view, true);
  connect();
  requestAnimationFrame(tick);
}

function connect() {
  const source = new EventSource("/api/events");
  source.addEventListener("view", (e) => {
    const { view, event, session } = JSON.parse(e.data);
    // A finished turn always gets its moment, even if another session is
    // still marked busy. Same for anything that needs you.
    if (session && (event?.phase === "end" || session.reaction === "waiting")) {
      state.focus = session;
      state.othersActive = view?.othersActive ?? 0;
      play(session.reaction);
      showStatus(session);
      if (event?.phase === "end") chime(session.turn?.ok !== false);
      return;
    }
    applyView(view, false);
  });
  source.addEventListener("config", (e) => {
    const { config, pet } = JSON.parse(e.data);
    applyConfig(config, pet);
  });
}

function applyConfig(config, pet) {
  state.config = { ...state.config, ...config };
  const size = state.config.scale;
  canvas.style.width = `${Math.round(FRAME_WIDTH * size)}px`;
  canvas.style.height = `${Math.round(FRAME_HEIGHT * size)}px`;
  $("tb-bubble").setAttribute("aria-pressed", String(state.config.showBubble));
  if (!state.config.showBubble && state.status.mode === "busy") hideStatus();
  if (!menu.hidden) renderMenu();
  $("empty").hidden = Boolean(pet);
  petEl.hidden = !pet;
  if (!pet || pet.id === state.petId) return;
  state.petId = pet.id;
  state.petName = pet.displayName;
  const img = new Image();
  img.onerror = () => {
    state.sheet = null;
    $("empty").hidden = false;
    $("empty").textContent = `Couldn't load ${pet.displayName}'s sprites. Open setup and pick it again.`;
  };
  img.onload = () => {
    state.sheet = img;
    state.lastDrawn = "";
    play("waving");
    showStatus({ reaction: "waving", context: `${pet.displayName} is here!`, project: "", agent: "manual" });
  };
  img.src = `${pet.sheet}?v=${Date.now()}`;
}

function applyView(view, initial) {
  const focus = view?.focus ?? null;
  const previous = state.focus;
  state.focus = focus;
  state.othersActive = view?.othersActive ?? 0;
  if (!focus) {
    play("idle");
    hideStatus();
    return;
  }
  const changed = !previous || previous.updatedAt !== focus.updatedAt || previous.sessionId !== focus.sessionId;
  if (!changed) return;
  // On first load don't replay an old celebration.
  if (initial && RESTING.has(focus.reaction)) return;
  play(focus.reaction);
  showStatus(focus);
}

// ---------- animation ----------

function play(reaction) {
  state.reaction = reaction;
  state.animation = REACTION_ANIMATION[reaction] ?? "idle";
  state.startedAt = performance.now();
  state.oneShotDone = false;
  if (!RESTING.has(reaction)) state.walk = null;
  $("alert").hidden = reaction !== "waiting";
}

function currentAnimation() {
  if (state.walk) return state.walk.dir < 0 ? "running-left" : "running-right";
  if (state.oneShotDone) return "idle";
  return state.animation;
}

function tick(now) {
  maybeWalk(now);
  const animation = currentAnimation();
  const started = state.walk ? state.walk.startedAt : state.startedAt;
  const { frame, done } = frameAt(animation, now - started);
  if (done && ONE_SHOT_REACTIONS.has(state.reaction) && !state.oneShotDone) {
    state.oneShotDone = true;
    state.startedAt = now;
  }
  draw(animation, frame);
  if (state.status.hideAt && now > state.status.hideAt && !state.hovering) hideStatus();
  requestAnimationFrame(tick);
}

function draw(animation, frame) {
  if (!state.sheet) return;
  const key = `${animation}:${frame}`;
  if (key === state.lastDrawn) return;
  state.lastDrawn = key;
  const r = frameRect(animation, frame);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.sheet, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
}

// ---------- wandering ----------

function maybeWalk(now) {
  const resting = RESTING.has(state.reaction) && (state.oneShotDone || state.reaction === "idle");
  if (!state.config.wander || state.dragging || state.hovering || !resting) {
    if (state.walk) state.lastDrawn = "";
    state.walk = null;
    state.nextWalkAt = Math.max(state.nextWalkAt, now + 3000);
    return;
  }
  if (!state.walk && now >= state.nextWalkAt) {
    state.walk = { dir: Math.random() < 0.5 ? -1 : 1, until: now + 1500 + Math.random() * 2500, startedAt: now, last: now };
  }
  if (!state.walk) return;
  const dt = (now - state.walk.last) / 1000;
  state.walk.last = now;
  if (now >= state.walk.until) {
    state.walk = null;
    state.lastDrawn = "";
    state.nextWalkAt = now + 7000 + Math.random() * 12000;
    return;
  }
  Promise.resolve(host.moveBy(state.walk.dir * WALK_SPEED * dt)).then((result) => {
    if (result?.atEdge && state.walk) state.walk.dir *= -1;
  });
}

// ---------- status pill ----------

function modeFor(reaction) {
  if (reaction === "waiting" || reaction === "error") return "attention";
  if (reaction === "success") return "done";
  if (reaction === "waving" || reaction === "idle") return "hello";
  return "busy";
}

/** The on/off switch only hides progress updates; "done" and "needs you" always show. */
function isOptional(mode) {
  return mode === "busy" || mode === "hello";
}

function showStatus(session, { force = false } = {}) {
  const mode = modeFor(session.reaction);
  if (!state.config.showBubble && isOptional(mode) && !force) return;
  statusEl.dataset.mode = mode;
  $("bubble-text").textContent = session.context || defaultText(session.reaction);
  $("bubble-project").textContent = session.project || "";
  $("bubble-agent").textContent = AGENT_LABEL[session.agent] ?? "";
  const others = $("bubble-others");
  others.hidden = state.othersActive < 1;
  others.textContent = `+${state.othersActive} busy`;
  statusEl.classList.remove("is-hidden");
  const life = STATUS_LIFETIME[mode];
  state.status = { mode, hideAt: life ? performance.now() + life : 0, seen: false };
}

function hideStatus() {
  statusEl.classList.add("is-hidden");
  state.status.hideAt = 0;
}

/** Bring the last status back for a moment (hover or click on the pet). */
function peekStatus() {
  if (!state.focus) return;
  // Hovering is an explicit "what's going on?", so it shows even with updates off.
  if (statusEl.classList.contains("is-hidden")) showStatus(state.focus, { force: true });
  if (state.status.mode === "done") state.status.seen = true;
}

statusEl.addEventListener("click", () => {
  // Clicking a "done" pill dismisses it.
  if (state.status.mode === "done" || state.status.mode === "hello") hideStatus();
});

function defaultText(reaction) {
  return {
    idle: `${state.petName} is chilling`,
    thinking: "Thinking…",
    working: "Working…",
    editing: "Editing…",
    running: "Running a command",
    testing: "Running tests",
    waiting: "Needs you",
    waving: "Hi!",
    success: "All done!",
    error: "Something went wrong",
  }[reaction];
}

// ---------- sound ----------

let audio = null;

/** A short two-note chime (rising when done, falling on an error). No sound files needed. */
function chime(ok) {
  if (!state.config.soundDone) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
    const notes = ok ? [880, 1318.5] : [659.3, 440];
    notes.forEach((freq, i) => {
      const start = audio.currentTime + i * 0.13;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // No audio device: the pill and the jump still show.
  }
}

// ---------- hover toolbar ----------

function showToolbar() {
  clearTimeout(state.toolbarHideTimer);
  toolbar.classList.remove("is-hidden");
}

function hideToolbarSoon(delay = 1200) {
  clearTimeout(state.toolbarHideTimer);
  state.toolbarHideTimer = setTimeout(() => {
    if (state.hovering || !menu.hidden || state.dragging) return;
    toolbar.classList.add("is-hidden");
  }, delay);
}

petEl.addEventListener("pointerenter", () => {
  state.hovering = true;
  host.setInteractive?.(true);
  showToolbar();
  peekStatus();
});

petEl.addEventListener("pointerleave", () => {
  state.hovering = false;
  if (!state.dragging && menu.hidden) host.setInteractive?.(false);
  hideToolbarSoon();
  // Let a peeked or already-seen status fade shortly after you look away.
  const { mode, seen } = state.status;
  if (mode === "busy" || mode === "hello" || (mode === "done" && seen)) {
    state.status.hideAt = performance.now() + (mode === "done" ? 3000 : 1500);
  }
});

for (const el of [toolbar, menu, statusEl]) {
  // Buttons and pills shouldn't start a drag.
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
}

$("tb-setup").addEventListener("click", () => {
  if (host.openSetup) host.openSetup();
  else window.open("/setup", "_blank");
});

$("tb-bubble").addEventListener("click", () => {
  const on = !state.config.showBubble;
  setConfig({ showBubble: on });
  // Say what the button did, so it's never a mystery.
  showStatus(
    { reaction: "waving", context: on ? "Progress updates on" : "Progress updates off · Done and alerts still show", project: "", agent: "manual" },
    { force: true },
  );
});

$("tb-more").addEventListener("click", () => {
  if (host.openMenu) return host.openMenu();
  menu.hidden = !menu.hidden;
  if (!menu.hidden) renderMenu();
  else hideToolbarSoon();
});

document.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !menu.contains(e.target) && e.target.closest("#tb-more") === null) {
    menu.hidden = true;
    hideToolbarSoon();
  }
});

function renderMenu() {
  const c = state.config;
  const item = (label, checked, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitemcheckbox");
    button.setAttribute("aria-checked", String(checked));
    button.innerHTML = `<span></span><span class="check">${checked ? "✓" : ""}</span>`;
    button.firstChild.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };
  const label = (text) => Object.assign(document.createElement("div"), { className: "label", textContent: text });
  menu.replaceChildren(
    label("Size"),
    ...[["Small", 0.5], ["Medium", 0.75], ["Large", 1]].map(([name, scale]) => item(name, c.scale === scale, () => setConfig({ scale }))),
    label("Behaviour"),
    item("Walk around", c.wander, () => setConfig({ wander: !c.wander })),
    item("Notify when done", c.notifyDone, () => setConfig({ notifyDone: !c.notifyDone })),
    item("Sound when done", c.soundDone, () => setConfig({ soundDone: !c.soundDone })),
    item("Show prompt text", c.showPrompt, () => setConfig({ showPrompt: !c.showPrompt })),
  );
}

function setConfig(patch) {
  return fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
}

// ---------- drag & poke ----------

let pointerStart = null;

canvas.addEventListener("pointerdown", (e) => {
  pointerStart = { x: e.screenX, y: e.screenY, moved: false };
  canvas.setPointerCapture(e.pointerId);
  host.dragStart?.(e.screenX, e.screenY, e.clientX, e.clientY);
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointerStart) return;
  if (!pointerStart.moved && Math.hypot(e.screenX - pointerStart.x, e.screenY - pointerStart.y) < 4) return;
  pointerStart.moved = true;
  state.dragging = true;
  petEl.classList.add("dragging");
  host.dragMove?.(e.screenX, e.screenY, e.clientX, e.clientY);
});

// A cancelled gesture (OS gesture, window switch) would otherwise leave the
// pet stuck in "dragging" and stop it animating or walking.
canvas.addEventListener("pointercancel", () => {
  pointerStart = null;
  state.dragging = false;
  petEl.classList.remove("dragging");
  host.dragEnd?.();
});

canvas.addEventListener("pointerup", () => {
  const wasClick = pointerStart && !pointerStart.moved;
  pointerStart = null;
  state.dragging = false;
  petEl.classList.remove("dragging");
  host.dragEnd?.();
  if (!wasClick) return;
  // A poke: say hi and show the latest status again.
  play("waving");
  if (state.focus) {
    showStatus(state.focus, { force: true });
    if (state.status.mode === "done") state.status.seen = true;
  } else {
    showStatus({ reaction: "waving", context: `${state.petName} says hi!`, project: "", agent: "manual" });
  }
});

// ---------- browser host ----------

function createBrowserHost() {
  let offsetX = 0;
  let grab = null;
  const apply = () => {
    petEl.style.transform = `translateX(calc(-50% + ${offsetX}px))`;
  };
  return {
    moveBy(dx) {
      const limit = Math.max(0, (window.innerWidth - petEl.offsetWidth) / 2 - 8);
      const next = Math.max(-limit, Math.min(limit, offsetX + dx));
      const atEdge = next !== offsetX + dx;
      offsetX = next;
      apply();
      return { moved: dx, atEdge };
    },
    dragStart(_sx, _sy, cx) {
      grab = { cx, start: offsetX };
    },
    dragMove(_sx, _sy, cx) {
      if (!grab) return;
      offsetX = grab.start + (cx - grab.cx);
      apply();
    },
    dragEnd() {
      grab = null;
    },
  };
}

init().catch((error) => {
  console.error(error);
  $("empty").hidden = false;
  $("empty").textContent = "Can't reach the PokeeClaude bridge.";
});

// Exposed for debugging in DevTools.
window.__pokee = { state, play, showStatus, hideStatus, chime };
