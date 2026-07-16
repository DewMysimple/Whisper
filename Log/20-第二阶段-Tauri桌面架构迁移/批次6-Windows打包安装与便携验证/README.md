# 批次 6：Windows 打包、安装与便携验证

状态：`Implementation Complete / User Acceptance Pending`（2026-07-16）。

本批次把批次 5 的开发态 Tauri/React/Worker 链路制作成可交付的 Windows 11 x64 发布介质：PyInstaller onedir 冻结 Worker，Tauri NSIS current-user 安装器内置 WebView2 Evergreen offlineInstaller，并提供完整便携目录。

正式离线安装介质采用两部分结构：`WhisperSubtitle_0.1.0_x64-setup.exe` 与相邻的 `models/large-v3-turbo/`。安装器在开始前检查模型包，并在安装/卸载时复制或移除安装目录内的模型。这样避开约 2.5 GiB 合并数据触发的 NSIS 数据块内存映射上限，同时不引入网络下载。

发布输出位于 `dist/release/`：

- `WhisperSubtitle-offline-installer/`：两部分离线安装介质，setup 必须与 `models/` 保持相邻。
- `WhisperSubtitle-portable/`：完整便携目录，直接运行 `whisper-subtitle-desktop.exe`。
- `release-manifest.json`、`SHA256SUMS.txt`：逐文件清单与发布级校验和。
- `sbom-python.cdx.json`：CycloneDX Python 构建环境 SBOM。

构建入口为根目录 `corepack pnpm release:build`，实现细节见 `packaging/README.md`。当前产物未签名，因为没有提供本地代码签名证书；签名配置和 SignTool/Tauri 接线已经实现。自动更新仍属于 P2，当前采用经过验证的离线安装器覆盖升级。

批次 6 没有切换默认入口、删除 PyQt5、修改转录算法/preset/后处理/命名/输出，也没有启动 localhost 服务。`launch.vbs` 仍是原 PyQt5 回退入口；默认入口切换只能由批次 7 和用户单独确认处理。

详细结果见[执行报告](执行报告.md)和[结构化验证记录](validation.json)。
