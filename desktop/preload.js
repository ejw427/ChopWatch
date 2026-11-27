const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chopwatchDesktop", {
  isDesktop: true,
  quit: () => ipcRenderer.invoke("app:quit"),
  reload: () => ipcRenderer.invoke("app:reload"),
  restartHelper: () => ipcRenderer.invoke("app:restart-helper"),
  rebuildRestart: () => ipcRenderer.invoke("app:rebuild-restart"),
});
