// Desktop pet renderer. Runs in the Electron window and in a normal browser
// tab (`pokeeclaude serve`). Plays a Codex-format spritesheet and shows what
// the coding agent is doing in a speech bubble.
import { ANIMATION_SPECS, FRAME_HEIGHT, FRAME_WIDTH, frameAt, frameRect } from "/lib/pet-format.js";
import { ONE_SHOT_REACTIONS, REACTION_ANIMATION, REACTION_ICON } from "/lib/reactions.js";

const $ = (id) => document.getElementById(id);
const petEl = $("pet");
const canvas = $("sprite");
const ctx = canvas.getContext("2d");
const bubble = $("bubble");

const RESTING = new Set(["idle", "success", "waving"]);
const AGENT_LABEL = { claude: "Claude", codex: "Codex", manual: "" };
const WALK_SPEED = 70; // px per second

const host = window.pokee ?? createBrowserHost();
if (window.pokee) document.body.classList.add("electron");

const state = {
  config: { showBubble: true, wander: true, scale: 0.75 },
  sheet: null,
  petName: "",
  reaction: "idle",
  animation: "idle",
  startedAt: performance.now(),
  oneShotDone: false,
  walk: null, // { dir, until }
  nextWalkAt: performance.now() + 4000,
  dragging: false,
  lastDrawn: "",
  focus: null,
  othersActive: 0,
  hideBubbleAt: 0,
};

// ---------- data ----------

async function init() {
  const response = await fetch("/api/state");
  const snapshot = await response.json();
  applyConfig(snapshot.config, snapshot.pet);
  applyView(snapshot.view, true);
  connect();
  requestAnimationFrame(tick);
}

function connect() {
  const source = new EventSource("/api/events");
  source.addEventListener("view", (e) => {
    const { view } = JSON.parse(e.data);
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
  if (!state.config.showBubble) bubble.hidden = true;
  $("empty").hidden = Boolean(pet);
  petEl.hidden = !pet;
  if (!pet) return;
  if (pet.id === state.petId) return;
  state.petId = pet.id;
  state.petName = pet.displayName;
  const img = new Image();
  img.onload = () => {
    state.sheet = img;
    state.lastDrawn = "";
    play("waving");
    showBubble({ reaction: "waving", context: `${pet.displayName} is here!`, project: "", agent: "manual" }, 4000);
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
    hideBubbleSoon(0);
    return;
  }
  const changed = !previous || previous.updatedAt !== focus.updatedAt || previous.sessionId !== focus.sessionId;
  if (!changed) return;
  // On first load don't replay a finished celebration.
  if (initial && RESTING.has(focus.reaction)) return;
  play(focus.reaction);
  showBubble(focus, RESTING.has(focus.reaction) ? 7000 : 0);
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

function currentAnimation(now) {
  if (state.walk) return state.walk.dir < 0 ? "running-left" : "running-right";
  if (state.oneShotDone) return "idle";
  return state.animation;
}

function tick(now) {
  maybeWalk(now);
  const animation = currentAnimation(now);
  const started = state.walk ? state.walk.startedAt : state.startedAt;
  const { frame, done } = frameAt(animation, now - started);
  if (done && ONE_SHOT_REACTIONS.has(state.reaction) && !state.oneShotDone) {
    state.oneShotDone = true;
    state.startedAt = now;
  }
  draw(animation, frame);
  if (state.hideBubbleAt && now > state.hideBubbleAt) {
    state.hideBubbleAt = 0;
    bubble.hidden = true;
  }
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
  if (!state.config.wander || state.dragging || !resting) {
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
  const dx = state.walk.dir * WALK_SPEED * dt;
  Promise.resolve(host.moveBy(dx)).then((result) => {
    if (result?.atEdge && state.walk) state.walk.dir *= -1;
  });
}

// ---------- bubble ----------

function showBubble(session, autoHideMs) {
  if (!state.config.showBubble) return;
  const reaction = session.reaction;
  $("bubble-icon").textContent = REACTION_ICON[reaction] ?? "";
  $("bubble-text").textContent = session.context || defaultText(reaction);
  $("bubble-project").textContent = session.project || "";
  $("bubble-agent").textContent = AGENT_LABEL[session.agent] ?? "";
  const others = $("bubble-others");
  others.hidden = state.othersActive < 1;
  others.textContent = `+${state.othersActive} busy`;
  bubble.classList.toggle("attention", reaction === "waiting" || reaction === "error");
  bubble.classList.toggle("done", reaction === "success");
  bubble.hidden = false;
  // Restart the pop animation.
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";
  state.hideBubbleAt = autoHideMs ? performance.now() + autoHideMs : 0;
}

function hideBubbleSoon(ms) {
  state.hideBubbleAt = performance.now() + ms;
}

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

// ---------- interaction ----------

let pointerStart = null;

petEl.addEventListener("pointerenter", () => host.setInteractive?.(true));
petEl.addEventListener("pointerleave", () => {
  if (!state.dragging) host.setInteractive?.(false);
});

petEl.addEventListener("pointerdown", (e) => {
  pointerStart = { x: e.screenX, y: e.screenY, moved: false };
  petEl.setPointerCapture(e.pointerId);
  host.dragStart?.(e.screenX, e.screenY, e.clientX, e.clientY);
});

petEl.addEventListener("pointermove", (e) => {
  if (!pointerStart) return;
  if (!pointerStart.moved && Math.hypot(e.screenX - pointerStart.x, e.screenY - pointerStart.y) < 4) return;
  pointerStart.moved = true;
  state.dragging = true;
  petEl.classList.add("dragging");
  host.dragMove?.(e.screenX, e.screenY, e.clientX, e.clientY);
});

petEl.addEventListener("pointerup", () => {
  const wasClick = pointerStart && !pointerStart.moved;
  pointerStart = null;
  state.dragging = false;
  petEl.classList.remove("dragging");
  host.dragEnd?.();
  if (wasClick) {
    // A poke: say hi and repeat the latest status.
    play("waving");
    const focus = state.focus;
    showBubble(focus ?? { reaction: "waving", context: `${state.petName} says hi!`, project: "", agent: "manual" }, 5000);
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
window.__pokee = { state, play, ANIMATION_SPECS };
