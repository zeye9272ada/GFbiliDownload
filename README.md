# GuFanDL（孤帆下载器）

一个 Windows 桌面应用，用于下载你有权保存的 Bilibili 视频，或提取音频文件。应用界面使用 Electron + React + Vite，下载执行由主进程调用 `yt-dlp.exe`，音视频合并和音频转码由 `ffmpeg.exe` 完成。

项目主页：<https://github.com/zeye9272ada/GFbiliDownload>

## 功能

- Bilibili 链接解析：标题、UP 主、时长、缩略图、可用格式
- 下载模式：视频、仅音频
- 视频清晰度：最佳、4K、1080p、720p、480p
- 视频默认优先 H.264/AVC + M4A，避免 Windows 播放器有声音无画面
- 音频格式：MP3、M4A、FLAC
- 字幕、元数据选项
- 任务队列、进度、速度、ETA、取消任务、打开目录
- 工具页检测 `yt-dlp` 和 `ffmpeg`
- 应用内下载 `yt-dlp.exe`
- 应用内下载并解压 `ffmpeg.exe`
- 依赖下载源可选“官方站”或“中国加速源”，中国加速失败时自动回退官方站
- Cookie 文件配置，适配需要登录状态的内容
- 内置 B 站官方登录窗口，登录后自动导出 `cookies.txt`
- 使用 `assets/app-icon.svg` 生成 Windows 桌面/任务栏图标
- Windows portable exe 打包配置

## 版权和平台规则

请只下载你拥有权利或被授权离线保存的内容。本项目不绕过 DRM，不破解付费限制，也不替代平台授权机制。实际可下载范围取决于 Bilibili、`yt-dlp`、账号 Cookie、视频权限和本地网络环境。

## 开发运行

当前环境 PowerShell 禁止直接运行 `npm.ps1` 时，请使用 `npm.cmd`。

```powershell
npm.cmd ci
npm.cmd run dev
```

## 依赖工具

应用启动后进入“工具”页：

1. 点击“获取 yt-dlp”自动下载 `yt-dlp.exe`。
2. 点击“获取 ffmpeg”自动下载并提取 `ffmpeg.exe`，用于合并视频和转换音频。

如果官方站下载较慢，可以在右侧“依赖状态”或“设置”页把“依赖下载源”切换为“中国加速源”。该模式会优先使用常见 GitHub Release 加速节点；如果节点不可用，会自动尝试下一个节点并最终回退官方站。

也可以手动放置：

```text
tools/yt-dlp.exe
tools/ffmpeg.exe
tools/ffmpeg/bin/ffmpeg.exe
```

这些第三方可执行文件不会提交到源码仓库。`easyuse` 分支会在打包时读取本地 `tools/`；维护者可将经过完整性校验的工具放入该目录，再构建开箱即用的便携包。

如果内容需要登录态，可以在“设置”页点击 Cookie 输入框右侧的登录按钮。应用会打开 B 站官方登录页，你可以扫码或输入账号登录。程序不会自建登录表单，也不会读取你的密码；检测到登录成功后，会把 B 站 Cookie 保存为：

```text
%APPDATA%\孤帆下载器\bilibili-cookies.txt
```

也可以手动选择已有的 `cookies.txt`。Cookie 文件格式需兼容 `yt-dlp --cookies`。

Cookie 等同于登录凭证，请不要发给别人。如果退出登录、改密码或 Cookie 过期，需要重新登录导出。

## 打包 exe

```powershell
npm.cmd run dist
```

`easyuse` 分支生成可内置本地已校验工具的 Windows portable 单文件应用，产物名为：

```text
release/孤帆下载器-easyuse-0.1.0-x64.exe
```

如果本地 `tools/` 中存在通过完整性校验的 `yt-dlp.exe` 和 `ffmpeg.exe`，它们会被一起打入 portable exe；否则用户仍可在应用内获取或手动选择工具。安装包应通过 GitHub Releases 发布，不应提交到源码仓库。

## 常见问题

- `yt-dlp 不可用`：在“工具”页点击“获取 yt-dlp”，或手动选择 `yt-dlp.exe`。
- `ffmpeg 不可用`：在“工具”页点击“获取 ffmpeg”，或手动选择 `bin/ffmpeg.exe`。
- `视频有声音但无画面`：通常是视频编码不兼容。新版默认优先下载 H.264 兼容视频；旧文件需要重新下载。
- 解析失败：检查链接是否有效，必要时配置 Cookie。
- 高画质不可用：账号权限、Cookie、视频本身格式都会影响结果。
- 下载后没有合并成 MP4：确认 `ffmpeg.exe` 可用。

## 项目结构

```text
electron/
  main.cjs       Electron 主进程、IPC、下载任务、工具检测
  preload.cjs    安全暴露给 React 的 API
src/
  App.jsx        应用 UI 和交互状态
  main.jsx       React 入口
  styles.css     界面样式
tools/
  .gitkeep       可放置 yt-dlp.exe / ffmpeg
```

## 开源许可

项目源代码采用 [Apache License 2.0](LICENSE) 发布。`yt-dlp`、FFmpeg 及 npm 依赖仍适用各自的许可证；版本、来源和再分发说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
