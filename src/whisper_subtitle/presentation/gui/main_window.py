#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Whisper 语音识别 — 极简白色质感 GUI（PyQt5）
原生 Windows 11 风格窗口，支持系统标题栏与圆角
"""

import sys
import logging
from pathlib import Path

from ...domain.contracts import TranscriptionRequest
from ...domain.presets import (
    DISPLAY_KEYS,
    PRESETS,
    get_display_value,
    get_preset_by_id,
)
from .controller import Completion, TranscriptionController
from .process_runner import ProcessRunner
from .settings import SettingsRepository, resolve_saved_preset_id
from .widgets.panels import MainPanels
from ...paths import AppPaths, get_app_paths
from ...infrastructure.environment_check import check_environment

logger = logging.getLogger(__name__)

try:
    from PyQt5.QtCore import Qt, QTimer
    from PyQt5.QtGui import QColor, QFont, QTextCursor, QTextCharFormat, QIcon, QPixmap
    from PyQt5.QtWidgets import (
        QApplication, QFileDialog, QMainWindow, QMessageBox, QTableWidgetItem
    )
except ImportError as exc:
    logger.error("无法导入 PyQt5（%s）: %s", type(exc).__name__, exc)
    raise SystemExit("缺少 PyQt5，无法启动图形界面") from exc

def check_env(app_paths: AppPaths | None = None):
    return check_environment(app_paths or get_app_paths())


class WhisperMinimalGUI(QMainWindow):
    def __init__(
        self,
        *,
        app_paths=None,
        settings_repository=None,
        runner=None,
        startup_check=None,
    ):
        super().__init__()
        self.app_paths = app_paths or get_app_paths()
        self.settings_repository = settings_repository or SettingsRepository()
        self._startup_check = startup_check or (
            lambda: check_env(self.app_paths)
        )
        self.setWindowTitle("Whisper")
        # 原生 Windows 窗口，保留系统标题栏和按钮
        self.setWindowFlags(Qt.Window | Qt.WindowTitleHint | Qt.WindowMinimizeButtonHint | Qt.WindowMaximizeButtonHint | Qt.WindowCloseButtonHint)
        # 窗口大小：屏幕的55%x65%，居中显示
        screen = QApplication.desktop().screenGeometry()
        w = int(screen.width() * 0.55)
        h = int(screen.height() * 0.65)
        self._ratio = w / h  # 锁定实际像素比例
        x = (screen.width() - w) // 2
        y = (screen.height() - h) // 2
        self.setGeometry(x, y, w, h)
        self.setMinimumSize(860, 550)

        # 设置窗口图标
        try:
            icon_pixmap = QPixmap()
            if icon_pixmap.loadFromData(self.app_paths.read_resource("logo.png")):
                self.setWindowIcon(QIcon(icon_pixmap))
        except FileNotFoundError as exc:
            logger.warning("无法加载窗口图标: %s", exc)

        self.version = "v2"
        self.is_running = False
        self._close_pending = False
        self.runner = runner or ProcessRunner(
            app_paths=self.app_paths,
            parent=self,
        )
        self.controller = TranscriptionController(self.runner, self)
        self.controller.log_received.connect(self._append_log)
        self.controller.running_changed.connect(self._on_running_changed)
        self.controller.completed.connect(self._on_finished)
        self.process = getattr(
            self.runner, "process", None
        )  # historical inspection compatibility
        self._build_ui()
        self._restore_settings()
        self._enable_win11_rounded_corners()
        self._check_startup()
        self._update_params()

    # ==================== 窗口拖动与调整大小 ====================
    # ==================== 窗口圆角绘制（抗锯齿）====================
    def _enable_win11_rounded_corners(self):
        """使用 Windows 11 DWM API 启用平滑圆角（无锯齿）并设置边框颜色与界面一致"""
        try:
            import ctypes
            hwnd = int(self.winId())
            DWMWA_WINDOW_CORNER_PREFERENCE = 33
            DWMWCP_ROUND = 2
            ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                ctypes.byref(ctypes.c_int(DWMWCP_ROUND)),
                ctypes.sizeof(ctypes.c_int)
            )
            # 设置边框颜色为浅灰色（#e9ecef），与主界面背景 #f8f9fa 过渡自然
            # 在 Win11 上产生微妙的边界感，不突兀但能看到窗口轮廓
            DWMWA_BORDER_COLOR = 34
            # COLORREF 格式: 0x00BBGGRR
            # #e9ecef -> R=0xE9, G=0xEC, B=0xEF
            # 用位运算确保值正确，避免手写十六进制出错
            border_color = (0xEF << 16) | (0xEC << 8) | 0xE9
            ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                ctypes.byref(ctypes.c_int(border_color)),
                ctypes.sizeof(ctypes.c_int)
            )
            # 设置标题栏颜色（Win11 DWM 浅色标题栏）
            # #f8f9fa -> R=0xF8, G=0xF9, B=0xFA
            DWMWA_CAPTION_COLOR = 35
            caption_color = (0xFA << 16) | (0xF9 << 8) | 0xF8
            ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd,
                DWMWA_CAPTION_COLOR,
                ctypes.byref(ctypes.c_int(caption_color)),
                ctypes.sizeof(ctypes.c_int)
            )
        except Exception as exc:
            logger.warning("无法启用 Windows 11 圆角（%s）: %s", type(exc).__name__, exc)

    def showEvent(self, event):
        """窗口显示后的初始化"""
        super().showEvent(event)

    def resizeEvent(self, event):
        """窗口 resize 时正常处理，不强制干预 QSplitter 尺寸。"""
        super().resizeEvent(event)

    def closeEvent(self, event):
        """程序关闭前清理"""
        if self.controller.is_running:
            event.ignore()
            if not self._close_pending:
                self._close_pending = True
                self._stop()
            return
        self._save_settings()
        super().closeEvent(event)

    # ==================== UI 构建 ====================
    def _build_ui(self):
        MainPanels(self).build()

    # ==================== 样式工具 ====================
    def _input_style(self):
        return (
            "QLineEdit {"
            "  background: #ffffff;"
            "  color: #1a1a1a;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 10px;"
            "  padding: 12px 14px;"
            "  font-weight: 400;"
            "  selection-background-color: #dee2e6;"
            "}"
            "QLineEdit:focus { border: 1px solid #ced4da; }"
        )

    def _ghost_btn_style(self):
        return (
            "QPushButton {"
            "  background: #f8f9fa;"
            "  color: #495057;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 10px;"
            "  padding: 8px 16px;"
            "  font-weight: 400;"
            "}"
            "QPushButton:hover { background: #e9ecef; color: #1a1a1a; }"
            "QPushButton:pressed { background: #dee2e6; }"
        )

    def _primary_btn_style(self):
        return (
            "QPushButton {"
            "  background: #1a1a1a;"
            "  color: #ffffff;"
            "  border: none;"
            "  border-radius: 12px;"
            "  padding: 12px 24px;"
            "  font-weight: 500;"
            "}"
            "QPushButton:hover { background: #333333; }"
            "QPushButton:pressed { background: #000000; }"
            "QPushButton:disabled { background: #e9ecef; color: #adb5bd; }"
        )

    def _danger_btn_style(self):
        return (
            "QPushButton {"
            "  background: #f8f9fa;"
            "  color: #495057;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 12px;"
            "  padding: 12px 24px;"
            "  font-weight: 400;"
            "}"
            "QPushButton:hover { background: #fff0f0; color: #c0392b; border-color: #ffcdd2; }"
            "QPushButton:pressed { background: #ffe0e0; }"
            "QPushButton:disabled { background: #f8f9fa; color: #adb5bd; }"
        )

    def _radio_style(self):
        return (
            "QRadioButton {"
            "  color: #495057;"
            "  spacing: 8px;"
            "  padding: 6px 0;"
            "}"
            "QRadioButton:checked { color: #1a1a1a; font-weight: 500; }"
        )

    def _checkbox_style(self):
        return (
            "QCheckBox {"
            "  color: #495057;"
            "  spacing: 8px;"
            "  padding: 6px 0;"
            "}"
            "QCheckBox::indicator {"
            "  width: 16px;"
            "  height: 16px;"
            "  border-radius: 4px;"
            "  border: 1px solid #e9ecef;"
            "  background: #ffffff;"
            "}"
            "QCheckBox::indicator:checked {"
            "  background: #1a1a1a;"
            "  border-color: #1a1a1a;"
            "}"
            "QCheckBox::indicator:checked::after {"
            "  content: '\\2713';"
            "  color: #ffffff;"
            "  font-size: 10px;"
            "}"
        )

    # ==================== 事件处理 ====================
    def _current_preset(self):
        """返回当前选中的 preset，找不到时回退到第一个"""
        for pid, btn in self.mode_buttons.items():
            if btn.isChecked():
                return get_preset_by_id(pid)
        return PRESETS[0]

    def _on_mode_changed(self):
        # UI 构建过程中 setChecked 可能提前触发本函数，此时控件尚未就绪，跳过
        if not hasattr(self, 'mode_desc') or not hasattr(self, 'param_table'):
            return
        preset = self._current_preset()
        self.mode_desc.setText(preset.description)
        self.settings_repository.set_preset_id(preset.id)
        self._update_params()

    def _browse_input(self):
        path, _ = QFileDialog.getOpenFileName(
            self,
            "选择视频/音频文件",
            self._dialog_start_dir(self.file_edit.text()),
            "视频/音频文件 (*.mp4 *.mkv *.avi *.mov *.wmv *.flv *.webm *.m4v *.mpeg *.mpg *.mp3 *.wav *.m4a *.aac *.ogg);;所有文件 (*)",
        )
        if path:
            self.file_edit.setText(path)

    def _browse_input_folder(self):
        path = QFileDialog.getExistingDirectory(
            self,
            "选择包含视频/音频的文件夹",
            self._dialog_start_dir(self.file_edit.text()),
        )
        if path:
            self.file_edit.setText(path)

    def _browse_output(self):
        path = QFileDialog.getExistingDirectory(
            self,
            "选择输出目录",
            self._dialog_start_dir(self.out_edit.text()),
        )
        if path:
            self.out_edit.setText(path)

    @staticmethod
    def _dialog_start_dir(value):
        """Return a stable existing directory for a QFileDialog."""
        candidate = Path(value.strip()).expanduser() if value.strip() else Path.home()
        if candidate.is_file():
            return str(candidate.parent)
        if candidate.is_dir():
            return str(candidate)
        if candidate.parent.is_dir():
            return str(candidate.parent)
        return str(Path.home())

    def _restore_settings(self):
        """Restore paths, preset and window geometry from QSettings."""
        stored = self.settings_repository.load()
        self.file_edit.setText(stored.input_path)
        self.out_edit.setText(stored.output_path)
        button = self.mode_buttons.get(stored.preset_id)
        if button is not None:
            button.setChecked(True)

        if stored.geometry is not None and not self.restoreGeometry(stored.geometry):
            logger.warning("QSettings 中的窗口几何信息无效，已使用默认窗口位置")

    def _save_settings(self):
        """Persist current paths, preset and window geometry."""
        self.settings_repository.save(
            input_path=self.file_edit.text(),
            output_path=self.out_edit.text(),
            preset_id=self._current_preset().id,
            geometry=self.saveGeometry(),
        )

    def _copy_log(self):
        text = self.log_edit.toPlainText()
        if text:
            QApplication.clipboard().setText(text)

    def _clear_log(self):
        self.log_edit.clear()

    def _resize_window_fixed(self, w, h):
        """按固定像素调整窗口大小并居中"""
        screen = QApplication.desktop().screenGeometry()
        x = (screen.width() - w) // 2
        y = (screen.height() - h) // 2
        self.setGeometry(x, y, w, h)

    def _check_startup(self):
        errors = self._startup_check()
        if errors:
            self._append_log("环境检查失败", "#c0392b")
            for e in errors:
                self._append_log(e, "#c0392b")
            QMessageBox.critical(self, "环境检查失败", "\n\n".join(errors))
        else:
            self._append_log("环境检查通过，可以开始转录", "#27ae60")
            self._append_log(f"Python: {self.app_paths.python_executable}")
            self._append_log(
                f"模型缓存: {self.app_paths.model_location.hf_home}"
            )
            self._append_log("入口: python -m whisper_subtitle transcribe")

    def _update_params(self):
        """根据当前处理模式显示对应的 AI 参数（从 presets 单一数据源读取）"""
        self.param_table.setRowCount(0)
        preset = self._current_preset()

        def _add_row(name, value):
            row = self.param_table.rowCount()
            self.param_table.insertRow(row)
            item_name = QTableWidgetItem(name)
            item_name.setFlags(item_name.flags() & ~Qt.ItemIsEditable)
            item_value = QTableWidgetItem(value)
            item_value.setFlags(item_value.flags() & ~Qt.ItemIsEditable)
            self.param_table.setItem(row, 0, item_name)
            self.param_table.setItem(row, 1, item_value)

        for key in DISPLAY_KEYS:
            _add_row(key, get_display_value(preset, key))
        self.param_table.resizeRowsToContents()

    # ==================== 日志系统 ====================
    def _detect_color(self, text):
        if text.startswith("❌") or "错误" in text or "Error" in text or "Traceback" in text or "异常" in text:
            return "#c0392b"
        if text.startswith("✅") or "完成" in text or "成功" in text or "🎉" in text:
            return "#27ae60"
        if text.startswith("⚠️") or "警告" in text or "warn" in text.lower() or "停止" in text:
            return "#e67e22"
        if text.startswith("▶") or text.startswith("=") or "启动" in text or "命令" in text:
            return "#2980b9"
        return None

    def _append_log(self, text, color=None):
        if not color:
            color = self._detect_color(text)
        doc = self.log_edit.document()
        if doc.blockCount() > 20000:
            cursor = self.log_edit.textCursor()
            cursor.movePosition(QTextCursor.Start)
            cursor.movePosition(QTextCursor.Down, n=1000)
            cursor.movePosition(QTextCursor.Start, mode=QTextCursor.KeepAnchor)
            cursor.removeSelectedText()
        cursor = self.log_edit.textCursor()
        cursor.movePosition(QTextCursor.End)
        if color:
            fmt = QTextCharFormat()
            fmt.setForeground(QColor(color))
            cursor.setCharFormat(fmt)
        cursor.insertText(text + "\n")
        if color:
            fmt = QTextCharFormat()
            fmt.setForeground(QColor("#495057"))
            cursor.setCharFormat(fmt)
        self.log_edit.setTextCursor(cursor)
        self.log_edit.ensureCursorVisible()

    # ==================== 转录控制 ====================
    def _switch_page(self, index):
        """切换到中间栏指定页面（0=参数, 1=监视）"""
        if index == 0:
            self.center_stack.setCurrentIndex(0)
            self.page_selector.setText("参数")
            self._perf_timer.stop()
        elif index == 1:
            self.center_stack.setCurrentIndex(1)
            self.page_selector.setText("监视")
            self._perf_timer.start()
            self._update_perf()

    def _toggle_center_page(self):
        """手动切换中间栏页面（参数/监视）"""
        if self.center_stack.currentIndex() == 0:
            self._switch_page(1)
        else:
            self._switch_page(0)

    def _update_perf(self):
        """刷新性能监控数据"""
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory()
            self.cpu_chart.append(cpu)
            # 内存格式：15.7/31.8 GB (49%)
            used_gb = mem.used / (1024 ** 3)
            total_gb = mem.total / (1024 ** 3)
            self.mem_chart.detail = f"{used_gb:.1f}/{total_gb:.1f} GB ({mem.percent:.0f}%)"
            self.mem_chart.append(mem.percent)
        except Exception as exc:
            logger.warning("无法读取 CPU/内存监控（%s）: %s", type(exc).__name__, exc)
        if self._has_nvidia:
            try:
                import pynvml
                util = pynvml.nvmlDeviceGetUtilizationRates(self._nvml_handle)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(self._nvml_handle)
                # GPU 利用率
                self.gpu_chart.append(util.gpu)
                # 显存格式：3.2/8.0 GB (40%)
                used_gb = mem_info.used / (1024 ** 3)
                total_gb = mem_info.total / (1024 ** 3)
                mem_pct = (mem_info.used / mem_info.total) * 100 if mem_info.total > 0 else 0
                self.gpu_mem_chart.detail = f"{used_gb:.1f}/{total_gb:.1f} GB ({mem_pct:.0f}%)"
                self.gpu_mem_chart.append(mem_pct)
            except Exception as exc:
                logger.warning("无法读取 GPU 监控（%s）: %s", type(exc).__name__, exc)

    def _start(self):
        input_p = self.file_edit.text().strip()
        if not input_p:
            QMessageBox.warning(self, "提示", "请先选择要处理的视频/音频文件")
            return
        if not Path(input_p).exists():
            QMessageBox.critical(self, "错误", f"路径不存在:\n{input_p}")
            return
        preset = self._current_preset()
        mode_str = preset.label

        output_p = self.out_edit.text().strip()
        request = TranscriptionRequest(
            input_path=Path(input_p),
            preset_id=preset.id,
            output_dir=Path(output_p) if output_p else None,
            desktop=self.desktop_cb.isChecked(),
        )
        self.controller.start(request)
        program, arguments = self.controller.command
        cmd = [program, *arguments]
        self._append_log("=" * 50, "#2980b9")
        self._append_log(f"▶ 启动转录 | {mode_str}", "#2980b9")
        self._append_log(f"{' '.join(cmd)}", "#2980b9")
        self._append_log("=" * 50, "#2980b9")
        # 自动切换到监控页
        if self.center_stack.currentIndex() == 0:
            self._toggle_center_page()
        self._perf_timer.start()

    def _on_running_changed(self, running):
        self.is_running = running
        self.start_btn.setEnabled(not running)
        self.stop_btn.setEnabled(running)
        if running:
            self.status_lbl.setText("正在转录中...")
            self.status_lbl.setStyleSheet("color: #e67e22;")

    def _on_finished(self, completion: Completion):
        if completion.user_stopped:
            self._append_log("\n已停止", "#e67e22")
            self.status_lbl.setText("已停止")
            self.status_lbl.setStyleSheet("color: #adb5bd;")
        elif completion.exit_code == 0:
            self._append_log("\n转录全部完成！", "#27ae60")
            self.status_lbl.setText("转录完成")
            self.status_lbl.setStyleSheet("color: #27ae60;")
        else:
            self._append_log(f"\n进程异常退出，返回码: {completion.exit_code}", "#c0392b")
            self.status_lbl.setText(f"异常退出 (code {completion.exit_code})")
            self.status_lbl.setStyleSheet("color: #c0392b;")
        self._reset_ui()
        self._perf_timer.stop()
        if self.center_stack.currentIndex() == 1:
            self._toggle_center_page()
        if self._close_pending:
            self._close_pending = False
            QTimer.singleShot(0, self.close)

    def _reset_ui(self):
        self.is_running = False
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)

    def _stop(self):
        self._perf_timer.stop()
        self.controller.stop()

    def _kill_process_if_running(self):
        """terminate 超时后异步强制终止，避免阻塞 GUI 主线程。"""
        self.runner.kill_if_running()


def main():
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    font = QFont("LXGW WenKai", 12)
    font.setStyleHint(QFont.SansSerif)
    app.setFont(font)
    window = WhisperMinimalGUI()
    window.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
