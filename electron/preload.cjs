const { contextBridge, ipcRenderer } = require("electron");

const INVOKE_CHANNELS = new Set([
  "app:get-state",
  "media:analyze",
  "download:start",
  "download:cancel",
  "settings:update",
  "dialog:select-output",
  "dialog:select-cookies",
  "cookies:login-bilibili",
  "tools:check",
  "tools:select",
  "tools:download-ytdlp",
  "tools:download-ffmpeg",
  "shell:open-output-dir"
]);

const EVENT_CHANNELS = new Set(["download:event", "tool:event"]);

function invoke(channel, ...args) {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error("IPC channel is not allowed");
  }
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel, listener) {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error("IPC event channel is not allowed");
  }
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api = Object.freeze({
  getState: () => invoke("app:get-state"),
  analyzeMedia: (url) => invoke("media:analyze", { url }),
  startDownload: (payload) => invoke("download:start", payload),
  cancelDownload: (id) => invoke("download:cancel", id),
  updateSettings: (patch) => invoke("settings:update", patch),
  selectOutputDir: () => invoke("dialog:select-output"),
  selectCookies: () => invoke("dialog:select-cookies"),
  loginBilibili: () => invoke("cookies:login-bilibili"),
  checkTools: () => invoke("tools:check"),
  selectTool: (type) => invoke("tools:select", type),
  downloadYtdlp: () => invoke("tools:download-ytdlp"),
  downloadFfmpeg: () => invoke("tools:download-ffmpeg"),
  openOutputDir: (targetPath) => invoke("shell:open-output-dir", targetPath),
  onDownloadEvent: (listener) => {
    return subscribe("download:event", listener);
  },
  onToolEvent: (listener) => {
    return subscribe("tool:event", listener);
  }
});

contextBridge.exposeInMainWorld("biliBridge", api);
