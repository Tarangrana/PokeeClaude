// Lets the setup page tell the app it finished, so the pet window shows up.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pokeeSetup", {
  done: () => ipcRenderer.send("pokee:setup-done"),
});
