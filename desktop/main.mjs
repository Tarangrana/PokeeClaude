// PokeeClaude desktop shell: a transparent, always-on-top window that hosts
// the pet renderer, plus a tray menu. The bridge server runs in-process.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getFromBridge, postToBridge } from "../dist/bridge/send.js";
import { startBridge } from "../dist/bridge/server.js";
import { bridgePort, configPath, loadConfig } from "../dist/config.js";
import { claudeSettingsPath, findPokeeCommands, readSettings } from "../dist/install/claude-settings.js";
import { claudeDesktopConfigPath, getMcpServer } from "../dist/install/claude-desktop.js";
import { findPet, listPets } from "../dist/pets.js";
import { hookLauncherPath, refreshHookLauncher, setupStatus, syncAgentHooks } from "../dist/setup.js";
import { activityLogPath } from "../dist/hook.js";

const here = dirname(fileURLToPath(import.meta.url));
const WIDTH = 280;
const HEIGHT = 390; // room for the status pill and hover toolbar above the pet

if (process.platform === "linux") app.commandLine.appendSwitch("enable-transparent-visuals");
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === "darwin") app.dock?.hide();

let win = null;
let setupWin = null;
let bridgeUrl = null;
let tray = null;
let refreshTray = null;
let bridge = null;
let drag = null;

app.whenReady().then(async () => {
  const url = await ensureBridge();
  bridgeUrl = url;
  refreshHookLauncher();
  // Hooks from an older version keep running old code until re-pointed here.
  const synced = syncAgentHooks();
  if (synced.claude) console.log("PokeeClaude: updated Claude Code hooks to this version");
  createWindow(url);
  await createTray(url);
  // First run (no pet or no hooks yet) or an explicit --setup opens the setup window.
  const status = setupStatus();
  if (process.argv.includes("--setup") || status.pets.length === 0 || !status.claude.installed) openSetup();
});

// Launching the app again (e.g. double-clicking the launcher) opens setup.
app.on("second-instance", () => openSetup());

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => bridge?.close());

async function ensureBridge() {
  try {
    bridge = await startBridge(undefined, { onEvent: notifyWhenDone });
    return bridge.url;
  } catch (error) {
    // Someone (e.g. `pokeeclaude serve`) already runs a bridge: reuse it.
    const health = await getFromBridge("/api/health", 800);
    if (error?.code === "EADDRINUSE" && health?.name === "pokeeclaude") return `http://127.0.0.1:${bridgePort()}/`;
    throw error;
  }
}

function createWindow(url) {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: area.x + area.width - WIDTH - 24,
    y: area.y + area.height - HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      // The pet plays a chime when Claude finishes, without a click first.
      autoplayPolicy: "no-user-gesture-required",
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks pass through the transparent parts until the pointer is on the pet.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadURL(url);
}

function openSetup() {
  if (!bridgeUrl) return;
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.show();
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    title: "PokeeClaude Setup",
    icon: join(here, "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(here, "setup-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Footer links open in the real browser.
  setupWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  setupWin.once("ready-to-show", () => {
    setupWin.show();
    if (process.platform === "darwin") app.focus({ steal: true });
  });
  setupWin.on("closed", () => {
    setupWin = null;
  });
  setupWin.loadURL(`${bridgeUrl}setup`);
}

/** Long-running turns get a system notification when the agent finishes. */
const NOTIFY_AFTER_MS = 15_000;

function notifyWhenDone(event, session) {
  if (event.phase !== "end" || !session?.turn) return;
  const config = loadConfig();
  if (!config.notifyDone || !Notification.isSupported()) return;
  const { turn } = session;
  // Quick replies happen while you're watching; only ping for longer work.
  if (turn.ok && turn.durationMs !== null && turn.durationMs < NOTIFY_AFTER_MS) return;
  const pet = findPet(config.activePet) ?? listPets()[0];
  const who = event.agent === "codex" ? "Codex" : "Claude";
  const where = event.project ? ` · ${event.project}` : "";
  const notification = new Notification({
    title: turn.ok ? `${who} is done${where}` : `${who} stopped${where}`,
    body: `${pet ? `${pet.metadata.displayName}: ` : ""}${session.context}`,
    silent: false,
  });
  notification.on("click", () => win?.showInactive());
  notification.show();
}

ipcMain.on("pokee:open-setup", () => openSetup());

ipcMain.on("pokee:menu", () => {
  if (!win || !bridgeUrl) return;
  buildMenu(bridgeUrl, () => refreshTray?.()).popup({ window: win });
});

ipcMain.on("pokee:setup-done", () => {
  win?.showInactive();
});

ipcMain.handle("pokee:move-by", (_event, dx) => {
  if (!win || typeof dx !== "number" || !Number.isFinite(dx)) return { moved: 0, atEdge: false };
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const wanted = bounds.x + dx;
  const x = Math.max(area.x - 40, Math.min(area.x + area.width - bounds.width + 40, wanted));
  win.setBounds({ ...bounds, x: Math.round(x) });
  return { moved: x - bounds.x, atEdge: Math.abs(x - wanted) > 0.5 };
});

ipcMain.on("pokee:set-interactive", (_event, interactive) => {
  win?.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on("pokee:drag-start", (_event, screenX, screenY) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  drag = { offsetX: screenX - x, offsetY: screenY - y };
});

ipcMain.on("pokee:drag-move", (_event, screenX, screenY) => {
  if (!win || !drag || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  win.setPosition(Math.round(screenX - drag.offsetX), Math.round(screenY - drag.offsetY));
});

ipcMain.on("pokee:drag-end", () => {
  drag = null;
});

async function createTray(url) {
  const size = process.platform === "darwin" ? 18 : 24;
  const icon = nativeImage.createFromPath(join(here, "icon.png")).resize({ width: size, height: size });
  tray = new Tray(icon);
  tray.setToolTip("PokeeClaude");
  const refresh = () => tray.setContextMenu(buildMenu(url, refresh));
  refreshTray = refresh;
  refresh();
  tray.on("click", refresh);
  setInterval(refresh, 10_000);
}

function buildMenu(url, refresh) {
  const config = loadConfig();
  const pets = listPets();
  const activeId = config.activePet ?? pets[0]?.metadata.id;
  const set = (patch) => postToBridge("/api/config", patch).then(refresh);
  return Menu.buildFromTemplate([
    { label: "PokeeClaude", enabled: false },
    { label: "Choose Pokémon…", click: () => openSetup() },
    { type: "separator" },
    ...(pets.length
      ? pets.map((pet) => ({
          label: `${pet.metadata.displayName}${pet.source === "codex" ? "  (Codex)" : ""}`,
          type: "radio",
          checked: pet.metadata.id === activeId,
          click: () => set({ activePet: pet.metadata.id }),
        }))
      : [{ label: "No pets yet: choose one…", click: () => openSetup() }]),
    { type: "separator" },
    { label: "Show progress updates", type: "checkbox", checked: config.showBubble, click: (item) => set({ showBubble: item.checked }) },
    { label: "Show prompt text", type: "checkbox", checked: config.showPrompt, click: (item) => set({ showPrompt: item.checked }) },
    { label: "Walk around", type: "checkbox", checked: config.wander, click: (item) => set({ wander: item.checked }) },
    { label: "Notify when Claude is done", type: "checkbox", checked: config.notifyDone, click: (item) => set({ notifyDone: item.checked }) },
    { label: "Sound when Claude is done", type: "checkbox", checked: config.soundDone, click: (item) => set({ soundDone: item.checked }) },
    {
      label: "Size",
      submenu: [0.5, 0.75, 1].map((scale) => ({
        label: { 0.5: "Small", 0.75: "Medium", 1: "Large" }[scale],
        type: "radio",
        checked: config.scale === scale,
        click: () => set({ scale }),
      })),
    },
    { type: "separator" },
    { label: "Open in browser", click: () => shell.openExternal(url) },
    { label: "Open activity log", click: () => shell.openPath(activityLogPath()) },
    { label: "Test the Done message", click: () => testDone() },
    { label: "Copy diagnostics", click: () => copyDiagnostics() },
    { label: "Bring pet back", click: () => resetPosition() },
    { label: "Quit", role: "quit" },
  ]);
}

function resetPosition() {
  if (!win) return;
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(area.x + area.width - WIDTH - 24, area.y + area.height - HEIGHT);
}

/** Play a fake finished turn on the pet, to check the display without Claude. */
function testDone() {
  // Without an in-process bridge (another PokeeClaude owns the port) send over HTTP.
  const push = bridge ? (event) => bridge.push(event) : (event) => postToBridge("/api/event", event);
  const base = { agent: "manual", sessionId: "pokee-test", project: "Test" };
  const t = Date.now();
  push({ ...base, reaction: "thinking", context: "Thinking…", phase: "start", at: t });
  setTimeout(() => push({ ...base, reaction: "editing", context: "Editing demo.ts", file: "demo.ts", at: Date.now() }), 1200);
  setTimeout(() => push({ ...base, reaction: "success", context: "All done!", phase: "end", at: Date.now() }), 3000);
}

/** Everything needed to debug "the pet doesn't react", without prompts or code. */
function copyDiagnostics() {
  const read = (path, lines) => {
    try {
      const text = readFileSync(path, "utf8");
      return lines ? text.trim().split("\n").slice(-lines).join("\n") : text.trim();
    } catch {
      return "(missing)";
    }
  };
  let commands = [];
  try {
    commands = findPokeeCommands(readSettings(claudeSettingsPath()));
  } catch (error) {
    commands = [`(could not read settings: ${error.message})`];
  }
  const text = [
    `PokeeClaude ${app.getVersion()} on ${process.platform} ${process.arch}`,
    `App: ${process.execPath}`,
    `Claude settings: ${claudeSettingsPath()}`,
    `PokeeClaude hook commands (${commands.length}):`,
    ...commands.map((c) => `  ${c}`),
    `Claude app MCP (${claudeDesktopConfigPath()}): ${(() => {
      try {
        return JSON.stringify(getMcpServer(readSettings(claudeDesktopConfigPath()))) ?? "not installed";
      } catch (error) {
        return `could not read: ${error.message}`;
      }
    })()}`,
    `Hook launcher (${hookLauncherPath()}):`,
    read(hookLauncherPath()),
    `Config: ${read(configPath())}`,
    "Last activity:",
    existsSync(activityLogPath()) ? read(activityLogPath(), 25) : "(no activity log yet: Claude hasn't run a PokeeClaude hook from this version)",
  ].join("\n");
  clipboard.writeText(text);
  dialog.showMessageBox({ message: "Diagnostics copied", detail: "Paste them into your chat. They contain no prompts or code." });
}
