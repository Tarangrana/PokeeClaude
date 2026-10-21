// Narrow bridge between the sandboxed pet page and the Electron window.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pokee", {
  moveBy: (dx) => ipcRenderer.invoke("pokee:move-by", dx),
  setInteractive: (interactive) => ipcRenderer.send("pokee:set-interactive", Boolean(interactive)),
  dragStart: (screenX, screenY) => ipcRenderer.send("pokee:drag-start", screenX, screenY),
  dragMove: (screenX, screenY) => ipcRenderer.send("pokee:drag-move", screenX, screenY),
  dragEnd: () => ipcRenderer.send("pokee:drag-end"),
});
