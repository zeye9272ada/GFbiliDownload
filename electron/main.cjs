const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, Menu } = require("electron");
const AdmZip = require("adm-zip");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const activeDownloads = new Map();
const activeDownloadKeys = new Set();
let mainWindow = null;
let settingsCache = null;
const approvedOutputDirs = new Set();
const approvedCookieFiles = new Set();

const APP_NAME = "孤帆下载器";
const APP_ID = "com.gufan.downloader";
const YT_DLP_VERSION = "2026.03.17";
const FFMPEG_VERSION = "8.1.1";
const YT_DLP_RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp.exe`;
const FFMPEG_RELEASE_URL = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
const YT_DLP_SHA256 = "3db811b366b2da47337d2fcfdfe5bbd9a258dad3f350c54974f005df115a1545";
const FFMPEG_ZIP_SHA256 = "6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541";
const FFMPEG_EXE_SHA256 = "228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb";
const TOOL_SOURCE_DEFAULT = "official";
const TOOL_MANIFESTS = {
  ytdlp: {
    name: "yt-dlp",
    fileName: "yt-dlp.exe",
    version: YT_DLP_VERSION,
    sha256: YT_DLP_SHA256,
    sources: {
      official: [{ id: "yt-dlp-github", label: "官方 GitHub", url: YT_DLP_RELEASE_URL }],
      china: [
        { id: "yt-dlp-gh-proxy", label: "中国加速源 1", url: `https://gh-proxy.com/${YT_DLP_RELEASE_URL}` },
        { id: "yt-dlp-gh-llkk", label: "中国加速源 2", url: `https://gh.llkk.cc/${YT_DLP_RELEASE_URL}` },
        { id: "yt-dlp-ghfast", label: "中国加速源 3", url: `https://ghfast.top/${YT_DLP_RELEASE_URL}` },
        { id: "yt-dlp-github", label: "官方 GitHub", url: YT_DLP_RELEASE_URL }
      ]
    }
  },
  ffmpeg: {
    name: "ffmpeg",
    fileName: "ffmpeg.exe",
    archiveName: "ffmpeg-release-essentials.zip",
    version: FFMPEG_VERSION,
    archiveSha256: FFMPEG_ZIP_SHA256,
    executableSha256: FFMPEG_EXE_SHA256,
    sources: {
      official: [{ id: "ffmpeg-github", label: "官方 GitHub", url: FFMPEG_RELEASE_URL }],
      china: [
        { id: "ffmpeg-gh-proxy", label: "中国加速源 1", url: `https://gh-proxy.com/${FFMPEG_RELEASE_URL}` },
        { id: "ffmpeg-gh-llkk", label: "中国加速源 2", url: `https://gh.llkk.cc/${FFMPEG_RELEASE_URL}` },
        { id: "ffmpeg-ghfast", label: "中国加速源 3", url: `https://ghfast.top/${FFMPEG_RELEASE_URL}` },
        { id: "ffmpeg-github", label: "官方 GitHub", url: FFMPEG_RELEASE_URL }
      ]
    }
  }
};
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "bilibili.com",
  "www.bilibili.com",
  "passport.bilibili.com",
  "account.bilibili.com",
  "api.bilibili.com",
  "space.bilibili.com"
]);
const BILIBILI_COOKIE_URLS = [
  "https://www.bilibili.com",
  "https://bilibili.com",
  "https://passport.bilibili.com",
  "https://api.bilibili.com",
  "https://space.bilibili.com"
];

function isDev() {
  return !app.isPackaged;
}

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function logPath() {
  return path.join(app.getPath("userData"), "logs", "app.log");
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeLog(level, message, details = {}) {
  try {
    const file = logPath();
    ensureDirSync(path.dirname(file));
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      ...details
    });
    fs.appendFileSync(file, `${line}\n`, "utf8");
  } catch {
    // Logging must never break app startup or downloads.
  }
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getDefaultSettings() {
  return {
    outputDir: path.join(app.getPath("downloads"), APP_NAME),
    ytdlpPath: "",
    ffmpegPath: "",
    cookiesPath: "",
    toolSource: TOOL_SOURCE_DEFAULT,
    theme: "system",
    filenameTemplate: "%(title).180B [%(id)s].%(ext)s"
  };
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readSettings() {
  if (settingsCache) {
    return settingsCache;
  }

  const settingsPath = getSettingsPath();
  const saved = readJsonFile(settingsPath) || {};
  const defaults = getDefaultSettings();
  settingsCache = {
    ...defaults,
    ...saved
  };
  settingsCache.toolSource = normalizeToolSource(settingsCache.toolSource);
  settingsCache.theme = normalizeTheme(settingsCache.theme);

  try {
    ensureDirSync(settingsCache.outputDir);
    registerOutputDir(settingsCache.outputDir);
  } catch (error) {
    writeLog("error", "Saved output directory is not usable; falling back to default", {
      outputDir: settingsCache.outputDir,
      error: errorText(error)
    });
    settingsCache.outputDir = defaults.outputDir;
    ensureDirSync(settingsCache.outputDir);
    registerOutputDir(settingsCache.outputDir);
  }

  try {
    ensureDirSync(path.join(app.getPath("userData"), "tools"));
  } catch (error) {
    writeLog("error", "Failed to ensure tools directory", { error: errorText(error) });
    throw error;
  }

  settingsCache.ytdlpPath = sanitizeManagedToolSetting(settingsCache.ytdlpPath, TOOL_MANIFESTS.ytdlp);
  settingsCache.ffmpegPath = sanitizeManagedToolSetting(settingsCache.ffmpegPath, TOOL_MANIFESTS.ffmpeg);

  if (settingsCache.cookiesPath) {
    approvedCookieFiles.add(normalizePathKey(settingsCache.cookiesPath));
  }

  return settingsCache;
}

function normalizeSettings(settings) {
  const defaults = getDefaultSettings();
  const normalized = {
    ...getDefaultSettings(),
    ...settings,
    ytdlpPath: sanitizeString(settings.ytdlpPath || defaults.ytdlpPath),
    ffmpegPath: sanitizeString(settings.ffmpegPath || defaults.ffmpegPath),
    cookiesPath: sanitizeString(settings.cookiesPath || defaults.cookiesPath),
    outputDir: sanitizeString(settings.outputDir || defaults.outputDir),
    toolSource: normalizeToolSource(settings.toolSource),
    theme: normalizeTheme(settings.theme),
    filenameTemplate: sanitizeFilenameTemplate(settings.filenameTemplate || defaults.filenameTemplate)
  };
  normalized.ytdlpPath = sanitizeManagedToolSetting(normalized.ytdlpPath, TOOL_MANIFESTS.ytdlp);
  normalized.ffmpegPath = sanitizeManagedToolSetting(normalized.ffmpegPath, TOOL_MANIFESTS.ffmpeg);
  return normalized;
}

async function writeSettings(settings) {
  settingsCache = normalizeSettings(settings);
  ensureDirSync(path.dirname(getSettingsPath()));
  await fsp.writeFile(getSettingsPath(), JSON.stringify(settingsCache, null, 2), "utf8");
  return settingsCache;
}

function resourcePath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, "..", ...parts);
}

function userToolPath(fileName) {
  return path.join(app.getPath("userData"), "tools", fileName);
}

function bilibiliCookiePath() {
  return path.join(app.getPath("userData"), "bilibili-cookies.txt");
}

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "app-icon.ico")
    : path.join(__dirname, "..", "assets", "app-icon.ico");
}

function existingPath(candidate) {
  if (!candidate) {
    return "";
  }
  try {
    return fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

function normalizeToolSource(source) {
  return source === "china" ? "china" : TOOL_SOURCE_DEFAULT;
}

function normalizeTheme(theme) {
  return ["system", "light", "dark"].includes(theme) ? theme : "system";
}

function normalizePathKey(value) {
  return path.resolve(sanitizeString(value)).toLowerCase();
}

function isUncPath(value) {
  const target = sanitizeString(value);
  return target.startsWith("\\\\") || target.startsWith("//");
}

function isUrlLike(value) {
  const target = sanitizeString(value);
  if (/^[a-zA-Z]:[\\/]/.test(target)) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function registerOutputDir(dir) {
  const value = sanitizeString(dir);
  if (!value || isUncPath(value)) {
    return;
  }
  try {
    const resolved = path.resolve(value);
    approvedOutputDirs.add(resolved.toLowerCase());
    if (fs.existsSync(resolved)) {
      approvedOutputDirs.add(fs.realpathSync(resolved).toLowerCase());
    }
  } catch (error) {
    writeLog("warn", "Failed to register output directory", { dir: value, error: errorText(error) });
  }
}

function isApprovedOutputDir(dir) {
  const value = sanitizeString(dir);
  if (!value || isUncPath(value) || isUrlLike(value)) {
    return false;
  }
  try {
    const resolved = path.resolve(value);
    const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    const keys = [resolved.toLowerCase(), real.toLowerCase()];
    if (keys.some((key) => approvedOutputDirs.has(key))) {
      return true;
    }
    const current = path.resolve(readSettings().outputDir);
    return isPathInside(real, current);
  } catch (error) {
    writeLog("warn", "Output directory validation failed", { dir: value, error: errorText(error) });
    return false;
  }
}

function sanitizeFilenameTemplate(template) {
  const value = sanitizeString(template) || "%(title).180B [%(id)s].%(ext)s";
  if (/[\\/]/.test(value) || value.includes("..")) {
    writeLog("warn", "Rejected unsafe filename template; using default", { template: value });
    return "%(title).180B [%(id)s].%(ext)s";
  }
  return value;
}

function applySettingsPatch(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Invalid settings payload");
  }

  const forbiddenKeys = ["ytdlpPath", "ffmpegPath"];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      writeLog("warn", "Blocked renderer executable path update", { key });
      throw new Error("Executable paths must be selected by the trusted tool picker");
    }
  }

  const allowedKeys = new Set(["outputDir", "cookiesPath", "toolSource", "theme", "filenameTemplate"]);
  for (const key of Object.keys(patch)) {
    if (!allowedKeys.has(key)) {
      writeLog("warn", "Blocked unsupported settings key", { key });
      throw new Error("Unsupported settings key");
    }
  }

  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "outputDir")) {
    const outputDir = sanitizeString(patch.outputDir);
    if (!isApprovedOutputDir(outputDir)) {
      writeLog("warn", "Blocked unapproved output directory update", { outputDir });
      throw new Error("Output directory must be selected with the directory picker");
    }
    ensureDirSync(outputDir);
    registerOutputDir(outputDir);
    next.outputDir = outputDir;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "cookiesPath")) {
    const cookiesPath = sanitizeString(patch.cookiesPath);
    if (cookiesPath && !approvedCookieFiles.has(normalizePathKey(cookiesPath))) {
      writeLog("warn", "Blocked unapproved cookie path update", { cookiesPath });
      throw new Error("Cookie file must be selected with the file picker or Bilibili login");
    }
    next.cookiesPath = cookiesPath;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "toolSource")) {
    next.toolSource = normalizeToolSource(patch.toolSource);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "theme")) {
    next.theme = normalizeTheme(patch.theme);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "filenameTemplate")) {
    next.filenameTemplate = sanitizeFilenameTemplate(patch.filenameTemplate);
  }

  return next;
}

function assertHttpsUrl(url, context) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    writeLog("error", "Invalid URL rejected", { context, url, error: errorText(error) });
    throw new Error("下载地址无效");
  }
  if (parsed.protocol !== "https:") {
    writeLog("error", "Non-HTTPS URL rejected", { context, url });
    throw new Error("只允许 HTTPS 下载地址");
  }
  return parsed;
}

function isAllowedToolUrl(manifest, url) {
  const allowed = [...manifest.sources.official, ...manifest.sources.china].map((source) => source.url);
  return allowed.includes(url);
}

function getToolDownloadSources(tool, preferredSource) {
  const manifest = TOOL_MANIFESTS[tool];
  const source = normalizeToolSource(preferredSource);
  return manifest.sources[source].map((item) => {
    assertHttpsUrl(item.url, `${manifest.name} source`);
    if (!isAllowedToolUrl(manifest, item.url)) {
      writeLog("error", "Unlisted tool download URL rejected", { tool: manifest.name, url: item.url });
      throw new Error("下载源不在允许列表中");
    }
    return item;
  });
}

function sha256FileSync(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function isSamePath(left, right) {
  try {
    return fs.realpathSync(left).toLowerCase() === fs.realpathSync(right).toLowerCase();
  } catch {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
  }
}

function isManagedToolPath(candidate, fileName) {
  return (
    isSamePath(candidate, userToolPath(fileName)) ||
    isSamePath(candidate, resourcePath("tools", fileName))
  );
}

function sanitizeManagedToolSetting(candidate, manifest) {
  const value = sanitizeString(candidate);
  if (!value) {
    return "";
  }
  if (!isManagedToolPath(value, manifest.fileName)) {
    writeLog("warn", "Removed unmanaged executable path from settings", { tool: manifest.name, path: value });
    return "";
  }
  return value;
}

function existingToolPath(candidate, manifest, expectedSha256) {
  const found = existingPath(candidate);
  if (!found) {
    return "";
  }
  if (!isManagedToolPath(found, manifest.fileName)) {
    writeLog("warn", "Rejected unmanaged executable path", { tool: manifest.name, path: found });
    return "";
  }
  try {
    const actual = sha256FileSync(found);
    if (actual === expectedSha256) {
      return found;
    }
    writeLog("error", "Managed tool checksum mismatch; refusing to execute", {
      tool: manifest.name,
      path: found,
      expectedSha256,
      actualSha256: actual
    });
  } catch (error) {
    writeLog("error", "Managed tool checksum failed", {
      tool: manifest.name,
      path: found,
      error: errorText(error)
    });
  }
  return "";
}

function resolveYtdlpPath(settings = readSettings()) {
  const manifest = TOOL_MANIFESTS.ytdlp;
  return (
    existingToolPath(settings.ytdlpPath, manifest, manifest.sha256) ||
    existingToolPath(userToolPath(manifest.fileName), manifest, manifest.sha256) ||
    existingToolPath(resourcePath("tools", manifest.fileName), manifest, manifest.sha256)
  );
}

function resolveFfmpegPath(settings = readSettings()) {
  const manifest = TOOL_MANIFESTS.ffmpeg;
  return (
    existingToolPath(settings.ffmpegPath, manifest, manifest.executableSha256) ||
    existingToolPath(userToolPath(manifest.fileName), manifest, manifest.executableSha256) ||
    existingToolPath(resourcePath("tools", manifest.fileName), manifest, manifest.executableSha256)
  );
}

function runCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      windowsHide: true,
      ...options
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error("命令执行超时"));
        }, options.timeoutMs)
      : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `命令退出码 ${code}`).trim()));
      }
    });
  });
}

async function checkExecutable(command, args, parser) {
  if (!command) {
    return {
      ok: false,
      path: "",
      version: "",
      message: "Managed executable is not installed or failed integrity verification"
    };
  }
  try {
    const result = await runCollect(command, args, { timeoutMs: 15000 });
    const version = parser(result.stdout, result.stderr);
    return {
      ok: true,
      path: command,
      version,
      message: "可用"
    };
  } catch (error) {
    return {
      ok: false,
      path: command,
      version: "",
      message: error.message || "不可用"
    };
  }
}

async function getDependencyHealth() {
  const settings = readSettings();
  const ytdlp = await checkExecutable(resolveYtdlpPath(settings), ["--version"], (stdout) => stdout.trim().split(/\s+/)[0] || "");
  const ffmpeg = await checkExecutable(resolveFfmpegPath(settings), ["-version"], (stdout) => {
    const firstLine = stdout.split(/\r?\n/)[0] || "";
    return firstLine.replace(/^ffmpeg version\s+/i, "").split(/\s+/)[0] || "";
  });

  return { ytdlp, ffmpeg };
}

function createWindow() {
  nativeTheme.themeSource = readSettings().theme;

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: APP_NAME,
    icon: appIconPath(),
    autoHideMenuBar: true,
    backgroundColor: "#f6f7fb",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    writeLog("warn", "Main window blocked new window", { url });
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (url !== currentUrl) {
      event.preventDefault();
      writeLog("warn", "Main window blocked navigation", { url });
    }
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (isDev() && startUrl) {
    mainWindow.loadURL(startUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateUrl(url) {
  const value = sanitizeString(url);
  if (!value) {
    throw new Error("请输入链接");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("链接格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("只支持 http 或 https 链接");
  }
  return value;
}

function isAllowedExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase());
}

async function openExternalSafe(url, context) {
  if (!isAllowedExternalUrl(url)) {
    writeLog("warn", "Blocked external URL", { context, url });
    return false;
  }
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    writeLog("error", "Failed to open external URL", { context, url, error: errorText(error) });
    return false;
  }
}

function commonYtdlpArgs(settings) {
  const args = ["--newline", "--no-playlist", "--windows-filenames"];

  if (settings.cookiesPath && fs.existsSync(settings.cookiesPath)) {
    args.push("--cookies", settings.cookiesPath);
  }

  const ffmpegPath = resolveFfmpegPath(settings);
  if (ffmpegPath && ffmpegPath !== "ffmpeg.exe") {
    args.push("--ffmpeg-location", ffmpegPath);
  }

  return args;
}

function simplifyFormats(formats = []) {
  const seen = new Set();
  return formats
    .filter((item) => item && (item.height || item.format_note || item.ext))
    .map((item) => ({
      id: item.format_id,
      ext: item.ext,
      note: item.format_note || "",
      resolution: item.resolution || (item.height ? `${item.height}p` : ""),
      height: item.height || 0,
      fps: item.fps || 0,
      video: item.vcodec && item.vcodec !== "none",
      audio: item.acodec && item.acodec !== "none"
    }))
    .filter((item) => {
      const key = `${item.height}-${item.ext}-${item.note}-${item.video}-${item.audio}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, 18);
}

function secondsToTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "";
  }
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("解析结果不是有效 JSON");
  }
}

function normalizeThumbnailUrl(data, baseUrl) {
  const candidates = [
    data?.thumbnail,
    ...(Array.isArray(data?.thumbnails) ? data.thumbnails.map((item) => item?.url) : [])
  ];

  for (const candidate of candidates) {
    const value = sanitizeString(candidate);
    if (!value) {
      continue;
    }
    if (value.startsWith("data:image/")) {
      return value;
    }
    if (value.startsWith("//")) {
      return `https:${value}`;
    }
    try {
      const parsed = new URL(value, baseUrl);
      if (parsed.protocol === "http:" && /(^|\.)hdslb\.com$/i.test(parsed.hostname)) {
        parsed.protocol = "https:";
      }
      if (parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch (error) {
      writeLog("warn", "Invalid thumbnail URL ignored", { thumbnail: value, error: errorText(error) });
    }
  }

  return "";
}

async function analyzeMedia(url) {
  const settings = readSettings();
  const targetUrl = validateUrl(url);
  const ytdlpPath = resolveYtdlpPath(settings);
  if (!ytdlpPath) {
    throw new Error("yt-dlp is not installed or failed integrity verification");
  }
  const args = [
    ...commonYtdlpArgs(settings),
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    targetUrl
  ];
  const result = await runCollect(ytdlpPath, args, { timeoutMs: 120000 });
  const data = parseJsonOutput(result.stdout);
  const webpageUrl = data.webpage_url || targetUrl;

  return {
    id: data.id || "",
    title: data.title || "未命名媒体",
    uploader: data.uploader || data.channel || "",
    duration: secondsToTime(data.duration),
    durationSeconds: data.duration || 0,
    thumbnail: normalizeThumbnailUrl(data, webpageUrl),
    webpageUrl,
    extractor: data.extractor_key || data.extractor || "",
    formats: simplifyFormats(data.formats || []),
    subtitles: Object.keys(data.subtitles || {}),
    automaticCaptions: Object.keys(data.automatic_captions || {})
  };
}

function qualityToFormat(quality) {
  const value = sanitizeString(quality) || "best";
  const h264Mp4 = "bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]";
  const h264Any = "bv*[vcodec^=avc1]+ba";
  const mp4AnyCodec = "bv*[ext=mp4]+ba[ext=m4a]";
  const anyVideo = "bv*+ba";

  if (value === "best") {
    return `${h264Mp4}/${h264Any}/${mp4AnyCodec}/${anyVideo}`;
  }

  const height = Number.parseInt(value, 10);
  if (!Number.isFinite(height) || height <= 0) {
    return `${h264Mp4}/${h264Any}/${mp4AnyCodec}/${anyVideo}`;
  }

  return [
    `bv*[height<=${height}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]`,
    `bv*[height<=${height}][vcodec^=avc1]+ba`,
    `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]`,
    `bv*[height<=${height}]+ba`
  ].join("/");
}

function buildDownloadArgs(input) {
  const settings = readSettings();
  const url = validateUrl(input.url);
  const outputDir = sanitizeString(input.outputDir) || settings.outputDir;
  if (!isApprovedOutputDir(outputDir)) {
    writeLog("warn", "Blocked download to unapproved output directory", { outputDir });
    throw new Error("Output directory must be selected with the directory picker");
  }
  const mode = input.mode === "audio" ? "audio" : "video";
  const args = [
    ...commonYtdlpArgs(settings),
    "--force-overwrites",
    "--progress-template",
    "download:%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "-P",
    outputDir,
    "-o",
    sanitizeFilenameTemplate(settings.filenameTemplate)
  ];

  if (mode === "audio") {
    args.push("-x", "--audio-format", input.audioFormat || "mp3", "--audio-quality", "0");
  } else {
    args.push("-f", qualityToFormat(input.quality), "--merge-output-format", input.container || "mp4");
  }

  if (input.subtitles) {
    args.push(
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "all,-live_chat,-danmaku",
      "--sub-format",
      "srt/best",
      "--convert-subs",
      "srt"
    );
  }

  if (input.embedMetadata) {
    args.push("--embed-metadata");
  }

  if (input.downloadThumbnail) {
    args.push("--write-thumbnail", "--convert-thumbnails", "jpg");
  }

  args.push(url);
  const downloadKey = [
    url.toLowerCase(),
    path.resolve(outputDir).toLowerCase(),
    mode,
    sanitizeFilenameTemplate(settings.filenameTemplate)
  ].join("\n");
  return { args, outputDir, mode, downloadKey };
}

function splitLines(bufferState, chunk, onLine) {
  bufferState.value += chunk.toString("utf8");
  const lines = bufferState.value.split(/\r?\n/);
  bufferState.value = lines.pop() || "";
  for (const line of lines) {
    onLine(line.trim());
  }
}

function parseProgressLine(line) {
  if (line.startsWith("download:")) {
    const [, status = "", percent = "", speed = "", eta = ""] = line.split("|");
    return {
      status: status.trim() || "downloading",
      percent: Number.parseFloat(percent.replace("%", "")) || 0,
      speed: speed.trim(),
      eta: eta.trim()
    };
  }

  const classic = line.match(/\[download\]\s+([\d.]+)%.*?at\s+(.+?)\s+ETA\s+([^\s]+)/i);
  if (classic) {
    return {
      status: "downloading",
      percent: Number.parseFloat(classic[1]) || 0,
      speed: classic[2].trim(),
      eta: classic[3].trim()
    };
  }

  if (/\[download\]\s+100%/i.test(line)) {
    return {
      status: "finished",
      percent: 100,
      speed: "",
      eta: "00:00"
    };
  }

  return null;
}

function startDownload(input) {
  const settings = readSettings();
  const ytdlpPath = resolveYtdlpPath(settings);
  if (!ytdlpPath) {
    throw new Error("yt-dlp is not installed or failed integrity verification");
  }
  const id = `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { args, outputDir, mode, downloadKey } = buildDownloadArgs(input);
  if (activeDownloadKeys.has(downloadKey)) {
    throw new Error("该链接已经在下载队列中，请等待当前任务完成");
  }
  const task = {
    id,
    url: input.url,
    title: input.title || "下载任务",
    mode,
    outputDir,
    percent: 0,
    speed: "",
    eta: "",
    status: "queued",
    startedAt: new Date().toISOString()
  };
  let optionalPostprocessError = false;
  let finalMediaOutputSeen = false;

  ensureDirSync(outputDir);
  registerOutputDir(outputDir);
  sendToRenderer("download:event", { type: "task", task });
  activeDownloadKeys.add(downloadKey);

  const child = spawn(ytdlpPath, args, {
    windowsHide: true
  });
  const stdoutState = { value: "" };
  const stderrState = { value: "" };

  task.status = "running";
  activeDownloads.set(id, { child, task });
  sendToRenderer("download:event", { type: "task", task: { ...task } });

  const handleLine = (line, level) => {
    if (!line) {
      return;
    }

    const progress = parseProgressLine(line);
    if (progress) {
      task.percent = Math.max(task.percent || 0, progress.percent);
      task.speed = progress.speed;
      task.eta = progress.eta;
      task.status = progress.status === "finished" ? "finalizing" : "running";
      sendToRenderer("download:event", { type: "task", task: { ...task } });
    }

    if (/\[(Merger|Metadata)\]/i.test(line) || /\[download\].+has already been downloaded/i.test(line)) {
      finalMediaOutputSeen = true;
    }

    if (/^ERROR:\s+(Preprocessing|Postprocessing):/i.test(line)) {
      optionalPostprocessError = true;
    }

    sendToRenderer("download:event", {
      type: "log",
      taskId: id,
      level,
      message: line,
      at: new Date().toISOString()
    });
  };

  child.stdout?.on("data", (chunk) => splitLines(stdoutState, chunk, (line) => handleLine(line, "info")));
  child.stderr?.on("data", (chunk) => splitLines(stderrState, chunk, (line) => handleLine(line, "warn")));

  child.on("error", (error) => {
    task.status = "failed";
    task.error = error.message;
    activeDownloads.delete(id);
    activeDownloadKeys.delete(downloadKey);
    sendToRenderer("download:event", { type: "task", task: { ...task } });
    sendToRenderer("download:event", {
      type: "log",
      taskId: id,
      level: "error",
      message: error.message,
      at: new Date().toISOString()
    });
  });

  child.on("close", (code) => {
    activeDownloads.delete(id);
    activeDownloadKeys.delete(downloadKey);
    if (task.status === "canceled") {
      task.percent = task.percent || 0;
    } else if (code === 0) {
      task.percent = 100;
      task.status = "completed";
      task.completedAt = new Date().toISOString();
    } else if (task.percent >= 100 && finalMediaOutputSeen && optionalPostprocessError) {
      task.percent = 100;
      task.status = "completed";
      task.warning = "视频已下载完成，但字幕、封面或元数据等可选后处理有警告";
      task.completedAt = new Date().toISOString();
      sendToRenderer("download:event", {
        type: "log",
        taskId: id,
        level: "warn",
        message: task.warning,
        at: new Date().toISOString()
      });
    } else {
      task.status = "failed";
      task.error = `yt-dlp 退出码 ${code}`;
    }
    sendToRenderer("download:event", { type: "task", task: { ...task } });
  });

  return task;
}

function cancelDownload(id) {
  const active = activeDownloads.get(id);
  if (!active) {
    return false;
  }
  active.task.status = "canceled";

  if (process.platform === "win32" && active.child.pid) {
    spawn("taskkill", ["/pid", String(active.child.pid), "/t", "/f"], { windowsHide: true });
  } else {
    active.child.kill("SIGTERM");
  }

  sendToRenderer("download:event", { type: "task", task: { ...active.task } });
  return true;
}

function downloadToTempFile(url, tempFile, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    assertHttpsUrl(url, "download");
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        if (redirectCount >= 5) {
          response.resume();
          reject(new Error("下载重定向次数过多"));
          return;
        }
        let nextUrl = "";
        try {
          nextUrl = new URL(response.headers.location, url).toString();
          assertHttpsUrl(nextUrl, "download redirect");
        } catch (error) {
          response.resume();
          reject(error);
          return;
        }
        response.resume();
        downloadToTempFile(nextUrl, tempFile, onProgress, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`下载失败：HTTP ${response.statusCode}`));
        response.resume();
        return;
      }

      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const file = fs.createWriteStream(tempFile);

      response.on("data", (chunk) => {
        received += chunk.length;
        if (total && onProgress) {
          onProgress(Math.round((received / total) * 100));
        }
      });

      response.pipe(file);

      file.on("finish", () => {
        file.close(() => resolve(tempFile));
      });

      file.on("error", (error) => {
        response.destroy();
        reject(error);
      });
    });

    request.on("error", reject);
    request.setTimeout(120000, () => {
      request.destroy(new Error("下载超时"));
    });
  });
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifySha256(file, expectedSha256, label) {
  const actualSha256 = await sha256File(file);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} SHA256 校验失败`);
  }
  return actualSha256;
}

async function replaceFileAtomic(tempFile, destination) {
  ensureDirSync(path.dirname(destination));
  await fsp.rename(tempFile, destination);
  return destination;
}

async function cleanupTempFile(file, tool, reason) {
  try {
    await fsp.rm(file, { force: true });
  } catch (error) {
    writeLog("error", "Failed to remove temporary file", {
      tool,
      reason,
      path: file,
      error: errorText(error)
    });
  }
}

function tempToolPath(destination, sourceId, suffix = "download") {
  return path.join(path.dirname(destination), `${path.basename(destination)}.${sourceId}.${Date.now()}.${suffix}`);
}

async function downloadYtdlpFromSources(sources, destination, onProgress, onAttempt) {
  const manifest = TOOL_MANIFESTS.ytdlp;
  const failures = [];

  for (const source of sources) {
    let tempFile = "";
    try {
      if (onAttempt) {
        onAttempt(source);
      }
      tempFile = tempToolPath(destination, source.id);
      await downloadToTempFile(source.url, tempFile, (percent) => onProgress?.(percent, source));
      await verifySha256(tempFile, manifest.sha256, manifest.name);
      await replaceFileAtomic(tempFile, destination);
      writeLog("info", "Tool download verified and installed", { tool: manifest.name, source: source.label, version: manifest.version });
      return source;
    } catch (error) {
      failures.push(`${source.label}: ${error.message || "下载失败"}`);
      writeLog("error", "Tool download source failed", {
        tool: manifest.name,
        source: source.label,
        url: source.url,
        error: errorText(error)
      });
      if (tempFile) {
        await cleanupTempFile(tempFile, manifest.name, "download failed");
      }
    }
  }

  throw new Error(`所有下载源均失败：${failures.join("；")}`);
}

async function downloadFfmpegFromSources(sources, zipPath, destination, onProgress, onAttempt) {
  const manifest = TOOL_MANIFESTS.ffmpeg;
  const failures = [];

  for (const source of sources) {
    let tempZip = "";
    let tempExe = "";
    try {
      if (onAttempt) {
        onAttempt(source);
      }
      tempZip = tempToolPath(zipPath, source.id);
      tempExe = tempToolPath(destination, source.id, "extracted");
      await downloadToTempFile(source.url, tempZip, (percent) => onProgress?.(percent, source));
      await verifySha256(tempZip, manifest.archiveSha256, `${manifest.name} archive`);
      await extractFfmpeg(tempZip, tempExe);
      await verifySha256(tempExe, manifest.executableSha256, manifest.name);
      await replaceFileAtomic(tempExe, destination);
      await cleanupTempFile(tempZip, manifest.name, "install complete");
      writeLog("info", "Tool archive verified, extracted, and installed", { tool: manifest.name, source: source.label, version: manifest.version });
      return source;
    } catch (error) {
      failures.push(`${source.label}: ${error.message || "下载失败"}`);
      writeLog("error", "Tool download source failed", {
        tool: manifest.name,
        source: source.label,
        url: source.url,
        error: errorText(error)
      });
      if (tempZip) {
        await cleanupTempFile(tempZip, manifest.name, "download failed");
      }
      if (tempExe) {
        await cleanupTempFile(tempExe, manifest.name, "download failed");
      }
    }
  }

  throw new Error(`所有下载源均失败：${failures.join("；")}`);
}

async function extractFfmpeg(zipPath, destination) {
  const zip = new AdmZip(zipPath);
  const entry = zip
    .getEntries()
    .find((item) => /(^|\/)bin\/ffmpeg\.exe$/i.test(item.entryName.replace(/\\/g, "/")));

  if (!entry) {
    throw new Error("ffmpeg 压缩包中没有找到 ffmpeg.exe");
  }

  ensureDirSync(path.dirname(destination));
  await fsp.writeFile(destination, entry.getData());
  return destination;
}

async function collectBilibiliCookies(cookieSession) {
  const byKey = new Map();

  for (const url of BILIBILI_COOKIE_URLS) {
    const cookies = await cookieSession.cookies.get({ url });
    for (const cookie of cookies) {
      const key = `${cookie.domain || ""}\t${cookie.path || ""}\t${cookie.name}`;
      byKey.set(key, cookie);
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const left = `${a.domain || ""}/${a.path || ""}/${a.name}`;
    const right = `${b.domain || ""}/${b.path || ""}/${b.name}`;
    return left.localeCompare(right);
  });
}

function hasBilibiliLoginCookie(cookies) {
  return cookies.some((cookie) => cookie.name === "SESSDATA" && cookie.value);
}

function cleanCookieValue(value) {
  return String(value ?? "").replace(/[\r\n\t]/g, "");
}

function cookieToNetscapeLine(cookie) {
  const rawDomain = cleanCookieValue(cookie.domain || "");
  const domain = cookie.httpOnly && !rawDomain.startsWith("#HttpOnly_") ? `#HttpOnly_${rawDomain}` : rawDomain;
  const includeSubdomains = rawDomain.startsWith(".") ? "TRUE" : "FALSE";
  const pathValue = cleanCookieValue(cookie.path || "/");
  const secure = cookie.secure ? "TRUE" : "FALSE";
  const expiration = Number.isFinite(cookie.expirationDate) ? Math.floor(cookie.expirationDate) : 0;
  const name = cleanCookieValue(cookie.name);
  const value = cleanCookieValue(cookie.value);

  return [domain, includeSubdomains, pathValue, secure, expiration, name, value].join("\t");
}

async function writeBilibiliCookiesFile(cookieSession) {
  const cookies = await collectBilibiliCookies(cookieSession);

  if (!hasBilibiliLoginCookie(cookies)) {
    throw new Error("未检测到 B 站登录 Cookie，请先完成登录");
  }

  const file = bilibiliCookiePath();
  const body = [
    "# Netscape HTTP Cookie File",
    "# Generated by 孤帆下载器. Keep this file private.",
    "# This file is used by yt-dlp --cookies.",
    "",
    ...cookies.map(cookieToNetscapeLine),
    ""
  ].join("\n");

  ensureDirSync(path.dirname(file));
  await fsp.writeFile(file, body, "utf8");
  approvedCookieFiles.add(normalizePathKey(file));

  const settings = await writeSettings({
    ...readSettings(),
    cookiesPath: file
  });

  return {
    cookiePath: file,
    cookieCount: cookies.length,
    settings
  };
}

function loginBilibiliAndSaveCookies() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const loginWindow = new BrowserWindow({
      width: 1060,
      height: 780,
      minWidth: 860,
      minHeight: 640,
      title: "登录 B 站获取 Cookie",
      icon: appIconPath(),
      autoHideMenuBar: true,
      parent: mainWindow || undefined,
      modal: false,
      backgroundColor: "#11151b",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:bilibili-login"
      }
    });

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      handler(value);
      if (!loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    };

    const tryExport = async () => {
      try {
        const result = await writeBilibiliCookiesFile(loginWindow.webContents.session);
        finish(resolve, result);
      } catch {
        // The user may still be completing QR/password login.
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/([^/]+\.)?bilibili\.com\//i.test(url)) {
        loginWindow.loadURL(url);
      } else {
        openExternalSafe(url, "bilibili-login-window");
      }
      return { action: "deny" };
    });

    loginWindow.on("closed", () => {
      if (!settled) {
        finish(reject, new Error("登录窗口已关闭，未保存 Cookie"));
      }
    });

    loginWindow.webContents.on("did-finish-load", tryExport);
    pollTimer = setInterval(tryExport, 1500);
    timeoutTimer = setTimeout(() => {
      finish(reject, new Error("登录超时，请重新打开登录窗口"));
    }, 10 * 60 * 1000);

    loginWindow.loadURL("https://passport.bilibili.com/login").catch((error) => {
      finish(reject, error);
    });
  });
}

function toolManifestByType(type) {
  if (type === "ytdlp") {
    return TOOL_MANIFESTS.ytdlp;
  }
  if (type === "ffmpeg") {
    return TOOL_MANIFESTS.ffmpeg;
  }
  throw new Error("Unsupported tool type");
}

async function installManagedToolFromFile(type, sourceFile) {
  const manifest = toolManifestByType(type);
  const selected = sanitizeString(sourceFile);
  if (!selected || isUncPath(selected) || isUrlLike(selected)) {
    writeLog("warn", "Rejected unsafe tool file path", { type, sourceFile: selected });
    throw new Error("Invalid tool file path");
  }
  if (path.basename(selected).toLowerCase() !== manifest.fileName.toLowerCase()) {
    writeLog("warn", "Rejected tool with unexpected file name", { type, sourceFile: selected });
    throw new Error(`Please select ${manifest.fileName}`);
  }
  if (!existingPath(selected)) {
    writeLog("warn", "Selected tool file does not exist", { type, sourceFile: selected });
    throw new Error("Selected tool file does not exist");
  }

  const expectedSha256 = manifest.sha256 || manifest.executableSha256;
  const actualSha256 = sha256FileSync(selected);
  if (actualSha256 !== expectedSha256) {
    writeLog("error", "Selected tool checksum mismatch", {
      tool: manifest.name,
      sourceFile: selected,
      expectedSha256,
      actualSha256
    });
    throw new Error("Selected executable failed integrity verification");
  }

  const destination = userToolPath(manifest.fileName);
  ensureDirSync(path.dirname(destination));
  const tempFile = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.copyFile(selected, tempFile);
    const copiedSha256 = sha256FileSync(tempFile);
    if (copiedSha256 !== expectedSha256) {
      throw new Error("Copied executable failed integrity verification");
    }
    await fsp.rm(destination, { force: true });
    await fsp.rename(tempFile, destination);
    const settings = await writeSettings({
      ...readSettings(),
      [type === "ytdlp" ? "ytdlpPath" : "ffmpegPath"]: destination
    });
    return { settings, dependencies: await getDependencyHealth() };
  } catch (error) {
    await fsp.rm(tempFile, { force: true }).catch(() => {});
    writeLog("error", "Failed to install selected tool", {
      tool: manifest.name,
      sourceFile: selected,
      error: errorText(error)
    });
    throw error;
  }
}

function validateOutputDirForShell(targetPath) {
  const value = sanitizeString(targetPath);
  if (!value || isUncPath(value) || isUrlLike(value)) {
    writeLog("warn", "Blocked unsafe shell output path", { targetPath: value });
    throw new Error("Invalid output directory");
  }
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(value));
  } catch (error) {
    writeLog("warn", "Blocked non-existent output path", { targetPath: value, error: errorText(error) });
    throw new Error("Output directory does not exist");
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    writeLog("warn", "Blocked shell open for non-directory", { targetPath: value, resolved });
    throw new Error("Only output directories can be opened");
  }
  if (!isApprovedOutputDir(resolved)) {
    writeLog("warn", "Blocked unapproved shell output path", { targetPath: value, resolved });
    throw new Error("Output directory is not approved");
  }
  return resolved;
}

function registerIpc() {
  ipcMain.handle("app:get-state", async () => ({
    version: app.getVersion(),
    settings: readSettings(),
    dependencies: await getDependencyHealth()
  }));

  ipcMain.handle("media:analyze", async (_event, payload) => analyzeMedia(payload?.url));

  ipcMain.handle("download:start", async (_event, payload) => startDownload(payload || {}));

  ipcMain.handle("download:cancel", async (_event, id) => cancelDownload(id));

  ipcMain.handle("settings:update", async (_event, patch) => {
    const next = applySettingsPatch(readSettings(), patch);
    await writeSettings(next);
    nativeTheme.themeSource = next.theme || "system";
    return {
      settings: readSettings(),
      dependencies: await getDependencyHealth()
    };
  });

  ipcMain.handle("dialog:select-output", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择下载目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const selected = result.filePaths[0];
    ensureDirSync(selected);
    registerOutputDir(selected);
    return selected;
  });

  ipcMain.handle("dialog:select-cookies", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select cookies.txt",
      properties: ["openFile"],
      filters: [{ name: "Cookies", extensions: ["txt"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const selected = result.filePaths[0];
    if (isUncPath(selected) || isUrlLike(selected) || path.extname(selected).toLowerCase() !== ".txt" || !existingPath(selected)) {
      writeLog("warn", "Blocked unsafe cookie file selection", { path: selected });
      throw new Error("Invalid cookie file");
    }
    approvedCookieFiles.add(normalizePathKey(selected));
    const settings = await writeSettings({
      ...readSettings(),
      cookiesPath: selected
    });
    return { settings, dependencies: await getDependencyHealth() };
  });

  ipcMain.handle("cookies:login-bilibili", async () => loginBilibiliAndSaveCookies());

  ipcMain.handle("tools:check", async () => getDependencyHealth());

  ipcMain.handle("tools:select", async (_event, type) => {
    const manifest = toolManifestByType(type);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${manifest.fileName}`,
      properties: ["openFile"],
      filters: [{ name: manifest.name, extensions: ["exe"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return installManagedToolFromFile(type, result.filePaths[0]);
  });

  ipcMain.handle("tools:download-ytdlp", async () => {
    const manifest = TOOL_MANIFESTS.ytdlp;
    const destination = userToolPath(manifest.fileName);
    const sources = getToolDownloadSources("ytdlp", readSettings().toolSource);
    ensureDirSync(path.dirname(destination));
    sendToRenderer("tool:event", { type: "yt-dlp-download", status: "running", percent: 0 });
    try {
      const usedSource = await downloadYtdlpFromSources(
        sources,
        destination,
        (percent, source) => {
          sendToRenderer("tool:event", { type: "yt-dlp-download", status: "running", percent, source: source.label });
        },
        (source) => {
          sendToRenderer("tool:event", { type: "yt-dlp-download", status: "running", percent: 0, source: source.label });
        }
      );
      const settings = await writeSettings({
        ...readSettings(),
        ytdlpPath: destination
      });
      const dependencies = await getDependencyHealth();
      sendToRenderer("tool:event", { type: "yt-dlp-download", status: "completed", percent: 100, source: usedSource.label });
      return { settings, dependencies };
    } catch (error) {
      sendToRenderer("tool:event", {
        type: "yt-dlp-download",
        status: "failed",
        message: error.message
      });
      writeLog("error", "yt-dlp download failed", { error: errorText(error) });
      throw error;
    }
  });

  ipcMain.handle("tools:download-ffmpeg", async () => {
    const manifest = TOOL_MANIFESTS.ffmpeg;
    const zipPath = userToolPath(manifest.archiveName);
    const destination = userToolPath(manifest.fileName);
    const sources = getToolDownloadSources("ffmpeg", readSettings().toolSource);
    ensureDirSync(path.dirname(destination));
    sendToRenderer("tool:event", { type: "ffmpeg-download", status: "running", percent: 0 });
    try {
      const usedSource = await downloadFfmpegFromSources(
        sources,
        zipPath,
        destination,
        (percent, source) => {
          sendToRenderer("tool:event", { type: "ffmpeg-download", status: "running", percent, source: source.label });
        },
        (source) => {
          sendToRenderer("tool:event", { type: "ffmpeg-download", status: "running", percent: 0, source: source.label });
        }
      );
      const settings = await writeSettings({
        ...readSettings(),
        ffmpegPath: destination
      });
      const dependencies = await getDependencyHealth();
      sendToRenderer("tool:event", { type: "ffmpeg-download", status: "completed", percent: 100, source: usedSource.label });
      return { settings, dependencies };
    } catch (error) {
      sendToRenderer("tool:event", {
        type: "ffmpeg-download",
        status: "failed",
        message: error.message
      });
      writeLog("error", "ffmpeg download failed", { error: errorText(error) });
      throw error;
    }
  });

  ipcMain.handle("shell:open-output-dir", async (_event, targetPath) => {
    const outputDir = validateOutputDirForShell(targetPath);
    return shell.openPath(outputDir);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ensureDirSync(path.join(app.getPath("userData"), "tools"));
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
