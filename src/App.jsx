import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AudioLines,
  Check,
  CheckCircle2,
  CircleAlert,
  Clipboard,
  Download,
  ExternalLink,
  FileAudio,
  Folder,
  Gauge,
  HardDriveDownload,
  History,
  Info,
  Loader2,
  LogIn,
  MonitorCog,
  Play,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  Square,
  Terminal,
  Video,
  Wrench,
  X
} from "lucide-react";

const bridge = window.biliBridge;

const initialSettings = {
  outputDir: "",
  ytdlpPath: "",
  ffmpegPath: "",
  cookiesPath: "",
  toolSource: "official",
  theme: "system",
  filenameTemplate: "%(title).180B [%(id)s].%(ext)s"
};

const navItems = [
  { id: "download", label: "下载", icon: Download },
  { id: "library", label: "媒体库", icon: History },
  { id: "tools", label: "工具", icon: Wrench },
  { id: "settings", label: "设置", icon: Settings }
];

const qualityOptions = [
  { value: "best", label: "最佳兼容" },
  { value: "2160", label: "4K 兼容" },
  { value: "1080", label: "1080p 兼容" },
  { value: "720", label: "720p 兼容" },
  { value: "480", label: "480p 兼容" }
];

const audioFormats = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "flac", label: "FLAC" }
];

const toolSourceOptions = [
  { value: "official", label: "官方站" },
  { value: "china", label: "中国加速源" }
];

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function statusLabel(status) {
  const labels = {
    queued: "等待",
    running: "下载中",
    finalizing: "封装中",
    completed: "完成",
    failed: "失败",
    canceled: "已取消"
  };
  return labels[status] || status;
}

function StatusDot({ ok }) {
  return <span className={ok ? "dot dot-ok" : "dot dot-error"} />;
}

function IconButton({ title, children, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`} title={title} aria-label={title} {...props}>
      {children}
    </button>
  );
}

function NavButton({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={18} />
      <span>{item.label}</span>
    </button>
  );
}

function Segmented({ value, onChange, items }) {
  return (
    <div className="segmented">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            className={value === item.value ? "active" : ""}
            onClick={() => onChange(item.value)}
          >
            {Icon ? <Icon size={16} /> : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SelectControl({ label, value, onChange, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder = "", actions = null, readOnly = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-row compact">
        <input value={value || ""} placeholder={placeholder} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
        {actions}
      </div>
    </label>
  );
}

function DependencyRows({ dependencies }) {
  const ytdlp = dependencies?.ytdlp || {};
  const ffmpeg = dependencies?.ffmpeg || {};

  return (
    <div className="dependency-list">
      <div className="dependency-row">
        <div>
          <strong>yt-dlp</strong>
          <span>{ytdlp.version || ytdlp.message || "未检测"}</span>
        </div>
        <StatusDot ok={ytdlp.ok} />
      </div>
      <div className="dependency-row">
        <div>
          <strong>ffmpeg</strong>
          <span>{ffmpeg.version || ffmpeg.message || "未检测"}</span>
        </div>
        <StatusDot ok={ffmpeg.ok} />
      </div>
    </div>
  );
}

function HeaderBar({ url, setUrl, onPaste, onAnalyze, onSelectOutput, outputDir, analyzing }) {
  return (
    <header className="topbar">
      <div className="url-box">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.bilibili.com/video/..."
          spellCheck="false"
        />
        <IconButton title="粘贴链接" onClick={onPaste}>
          <Clipboard size={18} />
        </IconButton>
        <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? <Loader2 size={17} className="spin" /> : <Activity size={17} />}
          <span>解析</span>
        </button>
      </div>
      <button className="path-button" onClick={onSelectOutput} title={outputDir || "选择目录"}>
        <Folder size={17} />
        <span>{outputDir || "选择目录"}</span>
      </button>
    </header>
  );
}

function ThumbnailPreview({ src }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <Video size={46} />;
  }

  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function MediaPreview({
  analysis,
  mode,
  setMode,
  quality,
  setQuality,
  audioFormat,
  setAudioFormat,
  subtitles,
  setSubtitles,
  embedMetadata,
  setEmbedMetadata,
  downloadThumbnail,
  setDownloadThumbnail,
  onStart,
  canStart
}) {
  const formatSummary = useMemo(() => {
    if (!analysis?.formats?.length) return "未解析格式";
    const videos = analysis.formats.filter((format) => format.video && format.height);
    const heights = [...new Set(videos.map((format) => `${format.height}p`))].slice(0, 5);
    return heights.length ? heights.join(" / ") : `${analysis.formats.length} 个格式`;
  }, [analysis]);

  return (
    <section className="main-panel media-panel">
      <div className="panel-heading">
        <div>
          <h2>媒体信息</h2>
          <p>{analysis ? analysis.extractor || "已解析" : "等待解析"}</p>
        </div>
        <button className="primary-button" onClick={onStart} disabled={!canStart}>
          <HardDriveDownload size={17} />
          <span>加入队列</span>
        </button>
      </div>

      <div className="media-body">
        <div className="thumbnail">
          <ThumbnailPreview src={analysis?.thumbnail} />
        </div>
        <div className="media-meta">
          <h3>{analysis?.title || "未选择媒体"}</h3>
          <dl>
            <div>
              <dt>UP主</dt>
              <dd>{analysis?.uploader || "-"}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>{analysis?.duration || "-"}</dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd>{formatSummary}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="option-grid">
        <div className="option-block">
          <span className="control-label">类型</span>
          <Segmented
            value={mode}
            onChange={setMode}
            items={[
              { value: "video", label: "视频", icon: Video },
              { value: "audio", label: "仅音频", icon: FileAudio }
            ]}
          />
        </div>
        {mode === "video" ? (
          <SelectControl label="清晰度" value={quality} onChange={setQuality}>
            {qualityOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        ) : (
          <SelectControl label="音频格式" value={audioFormat} onChange={setAudioFormat}>
            {audioFormats.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        )}
        <label className="toggle-line">
          <input type="checkbox" checked={subtitles} onChange={(event) => setSubtitles(event.target.checked)} />
          <span>字幕</span>
        </label>
        <label className="toggle-line">
          <input type="checkbox" checked={downloadThumbnail} onChange={(event) => setDownloadThumbnail(event.target.checked)} />
          <span>封面</span>
        </label>
        <label className="toggle-line">
          <input type="checkbox" checked={embedMetadata} onChange={(event) => setEmbedMetadata(event.target.checked)} />
          <span>元数据</span>
        </label>
      </div>
    </section>
  );
}

function QueueTable({ tasks, onCancel, onOpenFolder }) {
  return (
    <section className="main-panel queue-panel">
      <div className="panel-heading tight">
        <div>
          <h2>任务队列</h2>
          <p>{tasks.length ? `${tasks.length} 个任务` : "空队列"}</p>
        </div>
      </div>
      <div className="queue-table">
        <div className="queue-row queue-head">
          <span>名称</span>
          <span>类型</span>
          <span>进度</span>
          <span>速度</span>
          <span>ETA</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state">
            <Gauge size={22} />
            <span>暂无任务</span>
          </div>
        ) : (
          tasks.map((task) => (
            <div className="queue-row" key={task.id}>
              <span className="task-title" title={task.title}>
                {task.title}
              </span>
              <span>{task.mode === "audio" ? "音频" : "视频"}</span>
              <span className="progress-cell">
                <span className="progress-track">
                  <span style={{ width: `${Math.min(100, Math.max(0, task.percent || 0))}%` }} />
                </span>
                <em>{Math.round(task.percent || 0)}%</em>
              </span>
              <span>{task.speed || "-"}</span>
              <span>{task.eta || "-"}</span>
              <span>
                <span className={`status-pill ${task.status}`}>{statusLabel(task.status)}</span>
              </span>
              <span className="row-actions">
                {["running", "queued", "finalizing"].includes(task.status) ? (
                  <IconButton title="取消" onClick={() => onCancel(task.id)}>
                    <Square size={15} />
                  </IconButton>
                ) : null}
                <IconButton title="打开目录" onClick={() => onOpenFolder(task.outputDir)}>
                  <ExternalLink size={15} />
                </IconButton>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function RightRail({ dependencies, logs, settings, onUpdateSettings, onCheckTools, onDownloadYtdlp, onDownloadFfmpeg, toolDownload, cookieStatus }) {
  const ytdlpDownloading = toolDownload?.type === "yt-dlp-download" && toolDownload.status === "running";
  const ffmpegDownloading = toolDownload?.type === "ffmpeg-download" && toolDownload.status === "running";
  const downloading = ytdlpDownloading || ffmpegDownloading;
  const toolSource = settings?.toolSource || "official";

  return (
    <aside className="right-rail">
      <section className="side-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>依赖状态</h2>
            <p>{cookieStatus}</p>
          </div>
          <IconButton title="重新检测" onClick={onCheckTools}>
            <RefreshCcw size={16} />
          </IconButton>
        </div>
        <label className="field source-field">
          <span>依赖下载源</span>
          <select value={toolSource} onChange={(event) => onUpdateSettings({ toolSource: event.target.value })} disabled={downloading}>
            {toolSourceOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <DependencyRows dependencies={dependencies} />
        <button className="secondary-button full-width" onClick={onDownloadYtdlp} disabled={ytdlpDownloading}>
          <Download size={16} />
          <span>{ytdlpDownloading ? `下载中 ${toolDownload.percent || 0}%` : "获取 yt-dlp"}</span>
        </button>
        <button className="secondary-button full-width compact-top" onClick={onDownloadFfmpeg} disabled={ffmpegDownloading}>
          <Download size={16} />
          <span>{ffmpegDownloading ? `下载中 ${toolDownload.percent || 0}%` : "获取 ffmpeg"}</span>
        </button>
      </section>
      <section className="side-panel log-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>运行日志</h2>
            <p>{logs.length} 条</p>
          </div>
          <Terminal size={18} />
        </div>
        <div className="log-stream">
          {logs.slice(0, 90).map((log) => (
            <div className={`log-line ${log.level || "info"}`} key={log.id}>
              <span>{formatDate(log.at)}</span>
              <p>{log.message}</p>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function DownloadView(props) {
  const {
    url,
    setUrl,
    onPaste,
    onAnalyze,
    onSelectOutput,
    outputDir,
    analyzing,
    analysis,
    mode,
    setMode,
    quality,
    setQuality,
    audioFormat,
    setAudioFormat,
    subtitles,
    setSubtitles,
    embedMetadata,
    setEmbedMetadata,
    downloadThumbnail,
    setDownloadThumbnail,
    onStart,
    canStart,
    tasks,
    onCancel,
    onOpenFolder
  } = props;

  return (
    <main className="workspace">
      <HeaderBar
        url={url}
        setUrl={setUrl}
        onPaste={onPaste}
        onAnalyze={onAnalyze}
        onSelectOutput={onSelectOutput}
        outputDir={outputDir}
        analyzing={analyzing}
      />
      <div className="workspace-stack">
        <MediaPreview
          analysis={analysis}
          mode={mode}
          setMode={setMode}
          quality={quality}
          setQuality={setQuality}
          audioFormat={audioFormat}
          setAudioFormat={setAudioFormat}
          subtitles={subtitles}
          setSubtitles={setSubtitles}
          embedMetadata={embedMetadata}
          setEmbedMetadata={setEmbedMetadata}
          downloadThumbnail={downloadThumbnail}
          setDownloadThumbnail={setDownloadThumbnail}
          onStart={onStart}
          canStart={canStart}
        />
        <QueueTable tasks={tasks} onCancel={onCancel} onOpenFolder={onOpenFolder} />
      </div>
    </main>
  );
}

function LibraryView({ tasks, onOpenFolder }) {
  const completed = tasks.filter((task) => task.status === "completed");
  return (
    <main className="workspace single-view">
      <section className="main-panel">
        <div className="panel-heading">
          <div>
            <h2>媒体库</h2>
            <p>{completed.length ? `${completed.length} 个完成项目` : "无完成项目"}</p>
          </div>
          <History size={21} />
        </div>
        <div className="library-list">
          {completed.length === 0 ? (
            <div className="empty-state spacious">
              <CheckCircle2 size={26} />
              <span>完成的任务会显示在这里</span>
            </div>
          ) : (
            completed.map((task) => (
              <div className="library-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.mode === "audio" ? "音频" : "视频"} · {formatDate(task.completedAt)}</span>
                </div>
                <button className="secondary-button" onClick={() => onOpenFolder(task.outputDir)}>
                  <Folder size={16} />
                  <span>目录</span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function ToolsView({ dependencies, onCheckTools, onDownloadYtdlp, onDownloadFfmpeg, onPickTool, toolDownload }) {
  const ytdlpDownloading = toolDownload?.type === "yt-dlp-download" && toolDownload.status === "running";
  const ffmpegDownloading = toolDownload?.type === "ffmpeg-download" && toolDownload.status === "running";

  return (
    <main className="workspace single-view">
      <section className="main-panel">
        <div className="panel-heading">
          <div>
            <h2>工具</h2>
            <p>yt-dlp / ffmpeg</p>
          </div>
          <button className="primary-button" onClick={onCheckTools}>
            <RefreshCcw size={17} />
            <span>检测</span>
          </button>
        </div>
        <div className="tool-grid">
          <div className="tool-row">
            <div>
              <strong>yt-dlp</strong>
              <span>{dependencies?.ytdlp?.path || "未设置"}</span>
            </div>
            <div className="tool-actions">
              <StatusDot ok={dependencies?.ytdlp?.ok} />
              <button className="secondary-button" onClick={() => onPickTool("ytdlp")}>
                <MonitorCog size={16} />
                <span>选择</span>
              </button>
              <button className="secondary-button" onClick={onDownloadYtdlp} disabled={ytdlpDownloading}>
                <Download size={16} />
                <span>{ytdlpDownloading ? `${toolDownload.percent || 0}%` : "下载"}</span>
              </button>
            </div>
          </div>
          <div className="tool-row">
            <div>
              <strong>ffmpeg</strong>
              <span>{dependencies?.ffmpeg?.path || "未设置"}</span>
            </div>
            <div className="tool-actions">
              <StatusDot ok={dependencies?.ffmpeg?.ok} />
              <button className="secondary-button" onClick={() => onPickTool("ffmpeg")}>
                <MonitorCog size={16} />
                <span>选择</span>
              </button>
              <button className="secondary-button" onClick={onDownloadFfmpeg} disabled={ffmpegDownloading}>
                <Download size={16} />
                <span>{ffmpegDownloading ? `${toolDownload.percent || 0}%` : "下载"}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SettingsView({ settings, onUpdateSettings, onPickOutput, onPickCookies, onLoginBilibili, cookieLoggingIn }) {
  const [localTemplate, setLocalTemplate] = useState(settings.filenameTemplate || "");

  useEffect(() => {
    setLocalTemplate(settings.filenameTemplate || "");
  }, [settings.filenameTemplate]);

  return (
    <main className="workspace single-view">
      <section className="main-panel">
        <div className="panel-heading">
          <div>
            <h2>设置</h2>
            <p>下载目录、Cookie、命名、依赖源</p>
          </div>
          <ShieldCheck size={21} />
        </div>
        <div className="settings-form">
          <TextInput
            label="下载目录"
            value={settings.outputDir}
            onChange={() => {}}
            readOnly
            actions={
              <IconButton title="选择目录" onClick={onPickOutput}>
                <Folder size={16} />
              </IconButton>
            }
          />
          <TextInput
            label="Cookie 文件"
            value={settings.cookiesPath}
            onChange={() => {}}
            readOnly
            placeholder="cookies.txt"
            actions={
              <>
                <IconButton title="登录 B站获取 Cookie" onClick={onLoginBilibili} disabled={cookieLoggingIn}>
                  {cookieLoggingIn ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
                </IconButton>
                <IconButton title="选择 Cookie" onClick={onPickCookies}>
                  <Save size={16} />
                </IconButton>
              </>
            }
          />
          <label className="field">
            <span>依赖下载源</span>
            <select value={settings.toolSource || "official"} onChange={(event) => onUpdateSettings({ toolSource: event.target.value })}>
              {toolSourceOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>主题</span>
            <select value={settings.theme || "system"} onChange={(event) => onUpdateSettings({ theme: event.target.value })}>
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <TextInput
            label="文件命名"
            value={localTemplate}
            onChange={setLocalTemplate}
            actions={
              <IconButton title="保存命名" onClick={() => onUpdateSettings({ filenameTemplate: localTemplate })}>
                <Check size={16} />
              </IconButton>
            }
          />
          <div className="notice-line">
            <Info size={17} />
            <span>仅用于保存你拥有权利或被授权离线保存的内容。</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function Toast({ notice, onClose }) {
  if (!notice) return null;
  const Icon = notice.type === "error" ? CircleAlert : CheckCircle2;
  return (
    <div className={`toast ${notice.type || "info"}`}>
      <Icon size={18} />
      <span>{notice.message}</span>
      <button onClick={onClose} aria-label="关闭">
        <X size={16} />
      </button>
    </div>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState("download");
  const [settings, setSettings] = useState(initialSettings);
  const [dependencies, setDependencies] = useState({});
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [mode, setMode] = useState("video");
  const [quality, setQuality] = useState("best");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [subtitles, setSubtitles] = useState(false);
  const [downloadThumbnail, setDownloadThumbnail] = useState(false);
  const [embedMetadata, setEmbedMetadata] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [toolDownload, setToolDownload] = useState(null);
  const [cookieLoggingIn, setCookieLoggingIn] = useState(false);
  const [notice, setNotice] = useState(null);

  const cookieStatus = settings.cookiesPath ? "Cookie 已设置" : "未设置 Cookie";
  const canStart = Boolean(url.trim()) && Boolean(settings.outputDir) && dependencies?.ytdlp?.ok && dependencies?.ffmpeg?.ok;

  const pushLog = (message, level = "info") => {
    setLogs((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        at: new Date().toISOString(),
        level,
        message
      },
      ...current
    ]);
  };

  const showNotice = (message, type = "info") => {
    setNotice({ message, type });
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => setNotice(null), 4200);
  };

  const refreshState = async () => {
    if (!bridge) return;
    const state = await bridge.getState();
    setSettings(state.settings || initialSettings);
    setDependencies(state.dependencies || {});
  };

  useEffect(() => {
    refreshState().catch((error) => showNotice(error.message, "error"));

    if (!bridge) {
      return undefined;
    }

    const removeDownloadListener = bridge.onDownloadEvent((event) => {
      if (event.type === "task") {
        setTasks((current) => {
          const exists = current.some((item) => item.id === event.task.id);
          const next = exists
            ? current.map((item) => (item.id === event.task.id ? { ...item, ...event.task } : item))
            : [event.task, ...current];
          return next;
        });
      }
      if (event.type === "log") {
        setLogs((current) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            ...event
          },
          ...current
        ]);
      }
    });

    const removeToolListener = bridge.onToolEvent((event) => {
      setToolDownload(event);
      if (event.status === "completed") {
        showNotice(event.type === "ffmpeg-download" ? "ffmpeg 已更新" : "yt-dlp 已更新", "success");
      }
      if (event.status === "failed") {
        showNotice(event.message || "工具下载失败", "error");
      }
    });

    return () => {
      removeDownloadListener();
      removeToolListener();
    };
  }, []);

  const updateSettings = async (patch) => {
    if (!bridge) return;
    const result = await bridge.updateSettings(patch);
    setSettings(result.settings || initialSettings);
    setDependencies(result.dependencies || {});
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
      }
    } catch (error) {
      showNotice(error.message || "无法读取剪贴板", "error");
    }
  };

  const handleAnalyze = async () => {
    if (!url.trim()) {
      showNotice("请输入链接", "error");
      return;
    }
    setAnalyzing(true);
    try {
      const result = await bridge.analyzeMedia(url);
      setAnalysis(result);
      pushLog(`解析完成：${result.title}`, "info");
      showNotice("解析完成", "success");
    } catch (error) {
      pushLog(error.message, "error");
      showNotice(error.message || "解析失败", "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleStart = async () => {
    if (!canStart) {
      const message = !dependencies?.ytdlp?.ok
        ? "yt-dlp 不可用，请先获取 yt-dlp"
        : !dependencies?.ffmpeg?.ok
          ? "ffmpeg 不可用，请先获取 ffmpeg"
          : "任务参数不完整";
      showNotice(message, "error");
      return;
    }
    try {
      const task = await bridge.startDownload({
        url,
        title: analysis?.title,
        outputDir: settings.outputDir,
        mode,
        quality,
        audioFormat,
        subtitles,
        downloadThumbnail,
        embedMetadata,
        container: "mp4"
      });
      setTasks((current) => (current.some((item) => item.id === task.id) ? current : [task, ...current]));
      showNotice("已加入队列", "success");
    } catch (error) {
      showNotice(error.message || "启动失败", "error");
    }
  };

  const handleSelectOutput = async () => {
    const selected = await bridge.selectOutputDir();
    if (selected) {
      await updateSettings({ outputDir: selected });
    }
  };

  const handlePickTool = async (type) => {
    try {
      const result = await bridge.selectTool(type);
      if (result) {
        setSettings(result.settings || settings);
        setDependencies(result.dependencies || dependencies);
      }
    } catch (error) {
      showNotice(error.message || "工具校验失败", "error");
    }
  };

  const handlePickCookies = async () => {
    try {
      const result = await bridge.selectCookies();
      if (result) {
        setSettings(result.settings || settings);
        setDependencies(result.dependencies || dependencies);
      }
    } catch (error) {
      showNotice(error.message || "Cookie 选择失败", "error");
    }
  };

  const handleLoginBilibili = async () => {
    setCookieLoggingIn(true);
    try {
      const result = await bridge.loginBilibili();
      setSettings(result.settings || settings);
      showNotice(`Cookie 已保存：${result.cookieCount || 0} 个`, "success");
    } catch (error) {
      showNotice(error.message || "未保存 Cookie", "error");
    } finally {
      setCookieLoggingIn(false);
    }
  };

  const handleCheckTools = async () => {
    try {
      const result = await bridge.checkTools();
      setDependencies(result || {});
      showNotice("检测完成", "success");
    } catch (error) {
      showNotice(error.message || "检测失败", "error");
    }
  };

  const handleDownloadYtdlp = async () => {
    try {
      const result = await bridge.downloadYtdlp();
      setSettings(result.settings || settings);
      setDependencies(result.dependencies || dependencies);
    } catch (error) {
      showNotice(error.message || "下载失败", "error");
    }
  };

  const handleDownloadFfmpeg = async () => {
    try {
      const result = await bridge.downloadFfmpeg();
      setSettings(result.settings || settings);
      setDependencies(result.dependencies || dependencies);
    } catch (error) {
      showNotice(error.message || "下载失败", "error");
    }
  };

  const renderView = () => {
    if (activeView === "library") {
      return <LibraryView tasks={tasks} onOpenFolder={(target) => bridge.openOutputDir(target)} />;
    }
    if (activeView === "tools") {
      return (
        <ToolsView
          dependencies={dependencies}
          onCheckTools={handleCheckTools}
          onDownloadYtdlp={handleDownloadYtdlp}
          onDownloadFfmpeg={handleDownloadFfmpeg}
          onPickTool={handlePickTool}
          toolDownload={toolDownload}
        />
      );
    }
    if (activeView === "settings") {
      return (
        <SettingsView
          settings={settings}
          onUpdateSettings={updateSettings}
          onPickOutput={handleSelectOutput}
          onPickCookies={handlePickCookies}
          onLoginBilibili={handleLoginBilibili}
          cookieLoggingIn={cookieLoggingIn}
        />
      );
    }

    return (
      <DownloadView
        url={url}
        setUrl={setUrl}
        onPaste={handlePaste}
        onAnalyze={handleAnalyze}
        onSelectOutput={handleSelectOutput}
        outputDir={settings.outputDir}
        analyzing={analyzing}
        analysis={analysis}
        mode={mode}
        setMode={setMode}
        quality={quality}
        setQuality={setQuality}
        audioFormat={audioFormat}
        setAudioFormat={setAudioFormat}
        subtitles={subtitles}
        setSubtitles={setSubtitles}
        downloadThumbnail={downloadThumbnail}
        setDownloadThumbnail={setDownloadThumbnail}
        embedMetadata={embedMetadata}
        setEmbedMetadata={setEmbedMetadata}
        onStart={handleStart}
        canStart={canStart}
        tasks={tasks}
        onCancel={(id) => bridge.cancelDownload(id)}
        onOpenFolder={(target) => bridge.openOutputDir(target)}
      />
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div>
            <strong>BiliBili下载</strong>
            <span>Windows</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavButton key={item.id} item={item} active={activeView === item.id} onClick={() => setActiveView(item.id)} />
          ))}
        </nav>
        <div className="sidebar-footer">
          <AudioLines size={18} />
          <span>视频 / 音频</span>
        </div>
      </aside>

      <div className="content-grid">
        {renderView()}
        <RightRail
          dependencies={dependencies}
          logs={logs}
          settings={settings}
          onUpdateSettings={updateSettings}
          onCheckTools={handleCheckTools}
          onDownloadYtdlp={handleDownloadYtdlp}
          onDownloadFfmpeg={handleDownloadFfmpeg}
          toolDownload={toolDownload}
          cookieStatus={cookieStatus}
        />
      </div>
      <Toast notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}
