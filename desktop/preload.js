const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chopwatchDesktop", {
  isDesktop: true,
  quit: () => ipcRenderer.invoke("app:quit"),
  reload: () => ipcRenderer.invoke("app:reload"),
  restartHelper: () => ipcRenderer.invoke("app:restart-helper"),
  rebuildRestart: () => ipcRenderer.invoke("app:rebuild-restart"),
  getOpenAtLogin: () => ipcRenderer.invoke("app:get-open-at-login"),
  setOpenAtLogin: (enabled) =>
    ipcRenderer.invoke("app:set-open-at-login", Boolean(enabled)),
});
