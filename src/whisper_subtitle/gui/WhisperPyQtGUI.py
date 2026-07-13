#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Whisper 语音识别 — 极简白色质感 GUI（PyQt5）
原生 Windows 11 风格窗口，支持系统标题栏与圆角
"""

import os
import sys
import logging
from collections import deque
from pathlib import Path

from .. import PROJECT_ROOT
from ..core.presets import DISPLAY_KEYS, PRESETS, get_display_value, get_preset

logger = logging.getLogger(__name__)

try:
    from PyQt5.QtCore import QProcess, QProcessEnvironment, QSettings, Qt, QTimer
    from PyQt5.QtGui import QColor, QFont, QTextCursor, QTextCharFormat, QPixmap, QIcon
    from PyQt5.QtWidgets import (
        QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
        QLabel, QPushButton, QLineEdit, QPlainTextEdit, QFrame,
        QFileDialog, QMessageBox, QSizePolicy, QRadioButton, QSplitter,
        QListWidget, QStackedWidget, QMenu, QCheckBox, QTableWidget, QHeaderView, QTableWidgetItem
    )
except ImportError as exc:
    logger.error("无法导入 PyQt5（%s）: %s", type(exc).__name__, exc)
    raise SystemExit("缺少 PyQt5，无法启动图形界面") from exc

# ============================================================
# 路径配置
# 路径配置
# ============================================================
VENV_PYTHON = PROJECT_ROOT / "whisper_env" / "Scripts" / "python.exe"
ICON_PATH = PROJECT_ROOT / "assets" / "logo.png"


def script_path(preset):
    """根据 preset 取脚本绝对路径"""
    return PROJECT_ROOT / "src" / "whisper_subtitle" / "core" / preset["script"]


def script_module(preset):
    """根据 preset 生成可由 ``python -m`` 执行的模块名。"""
    return f"whisper_subtitle.core.{Path(preset['script']).stem}"


def check_env():
    errors = []
    if not VENV_PYTHON.exists():
        errors.append(f"虚拟环境 Python 未找到:\n{VENV_PYTHON}")
    for p in PRESETS:
        sp = script_path(p)
        if not sp.exists():
            errors.append(f"{p['label']}脚本未找到:\n{sp}")
    return errors


class PerfChart(QWidget):
    """实时性能折线图表，对标任务管理器"""

    def __init__(self, title="", max_points=60, parent=None):
        super().__init__(parent)
        self.title = title
        self.max_points = max_points
        self.data = deque([0.0] * max_points, maxlen=max_points)
        self.current_value = 0.0
        self.unit = "%"
        self.detail = None
        self.setMinimumHeight(80)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

    def append(self, value):
        self.data.append(float(value))
        self.current_value = float(value)
        self.update()

    def set_detail(self, text):
        self.detail = text
        self.update()

    def set_unit(self, unit):
        self.unit = unit

    def paintEvent(self, event):
        from PyQt5.QtGui import QPainter, QPen, QBrush, QColor, QFont, QPainterPath
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        w, h = self.width(), self.height()
        margin_left = 40
        margin_right = 10
        margin_top = 18
        margin_bottom = 18
        chart_w = w - margin_left - margin_right
        chart_h = h - margin_top - margin_bottom

        # 背景
        painter.setBrush(QBrush(QColor("#f8f9fa")))
        painter.setPen(QPen(QColor("#e9ecef"), 1))
        painter.drawRoundedRect(0, 0, w, h, 6, 6)

        # 标题（左上）
        painter.setPen(QPen(QColor("#868e96")))
        painter.setFont(QFont("LXGW WenKai", 10))
        painter.drawText(10, 14, self.title)

        # 当前数值（右上）
        if self.detail:
            val_text = self.detail
        else:
            val_text = f"{self.current_value:.1f}{self.unit}"
        painter.setPen(QPen(QColor("#1a1a1a")))
        painter.setFont(QFont("LXGW WenKai", 11, QFont.Bold))
        fm = painter.fontMetrics()
        text_w = fm.width(val_text)
        painter.drawText(w - text_w - 10, 14, val_text)

        # 图表区域裁剪
        painter.setClipRect(margin_left, margin_top, chart_w, chart_h)

        # 网格线（横线，每20%一条）
        painter.setPen(QPen(QColor("#e9ecef"), 1))
        for i in range(1, 5):
            y = margin_top + chart_h * i / 5
            painter.drawLine(margin_left, int(y), w - margin_right, int(y))

        # 折线数据
        if len(self.data) > 1:
            points = []
            step = chart_w / (self.max_points - 1)
            for i, val in enumerate(self.data):
                x = margin_left + i * step
                y = margin_top + chart_h * (1 - val / 100)
                points.append((x, y))

            # 折线路径
            path = QPainterPath()
            path.moveTo(points[0][0], points[0][1])
            for x, y in points[1:]:
                path.lineTo(x, y)
            painter.setPen(QPen(QColor("#1a1a1a"), 2))
            painter.drawPath(path)

            # 填充路径（折线下方）
            fill = QPainterPath()
            fill.moveTo(points[0][0], h - margin_bottom)
            for x, y in points:
                fill.lineTo(x, y)
            fill.lineTo(points[-1][0], h - margin_bottom)
            fill.closeSubpath()
            painter.setPen(Qt.NoPen)
            painter.setBrush(QBrush(QColor("#1a1a1a").lighter(220)))
            painter.drawPath(fill)

        painter.end()


class WhisperMinimalGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = QSettings("WhisperSubtitle", "WhisperSubtitle")
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
        if ICON_PATH.exists():
            self.setWindowIcon(QIcon(str(ICON_PATH)))

        self.version = "v2"
        self.is_running = False
        self.process = QProcess(self)
        self._user_stopped = False
        self._close_pending = False
        self._stop_timeout_timer = QTimer(self)
        self._stop_timeout_timer.setSingleShot(True)
        self._stop_timeout_timer.setInterval(5000)
        self._stop_timeout_timer.timeout.connect(self._kill_process_if_running)

        self._setup_process()
        self._build_ui()
        self._restore_settings()
        self._enable_win11_rounded_corners()
        self._check_startup()
        self._update_params()

    # ==================== 进程设置 ====================
    def _setup_process(self):
        self.process.setProcessChannelMode(QProcess.MergedChannels)
        self.process.setWorkingDirectory(str(PROJECT_ROOT))
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONIOENCODING", "utf-8")
        env.insert("PYTHONUNBUFFERED", "1")
        # 设置 HF_HOME，让模型缓存指向工程目录内部
        env.insert("HF_HOME", str(PROJECT_ROOT / "models" / "huggingface"))
        self.process.setProcessEnvironment(env)
        self.process.readyReadStandardOutput.connect(self._on_output)
        self.process.finished.connect(self._on_finished)

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
        if self.process.state() != QProcess.NotRunning:
            event.ignore()
            if not self._close_pending:
                self._close_pending = True
                self._stop()
            return
        self._save_settings()
        super().closeEvent(event)

    # ==================== UI 构建 ====================
    def _build_ui(self):
        central = QWidget()
        central.setStyleSheet("background: transparent;")
        self.setCentralWidget(central)
        outer_layout = QVBoxLayout(central)
        outer_layout.setContentsMargins(0, 0, 0, 0)
        outer_layout.setSpacing(0)

        # ========== 主内容区：三列固定布局（无分割线，无拖动）==========
        main_container = QWidget()
        main_container.setStyleSheet("background: transparent;")
        main_layout = QHBoxLayout(main_container)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        outer_layout.addWidget(main_container, 1)

        # --- 左侧设置面板 ---
        left = QFrame()
        left.setMinimumWidth(100)
        left.setStyleSheet("background: #f8f9fa;")
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(40, 28, 40, 24)
        left_layout.setSpacing(0)
        left_layout.setAlignment(Qt.AlignTop)

        # 标题区：Logo + 文字并排，整体高度对齐
        title_row = QHBoxLayout()
        title_row.setSpacing(14)
        title_row.setAlignment(Qt.AlignLeft)

        # Logo 图片（48x48，与文字列同高）
        logo_lbl = QLabel()
        if ICON_PATH.exists():
            pixmap = QPixmap(str(ICON_PATH)).scaled(48, 48, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            logo_lbl.setPixmap(pixmap)
        logo_lbl.setFixedSize(48, 48)
        title_row.addWidget(logo_lbl, alignment=Qt.AlignVCenter)

        # 文字列（标题 + 副标题，总高度 ≈ 48px，与 logo 对齐）
        title_col = QVBoxLayout()
        title_col.setSpacing(0)
        title_col.setContentsMargins(0, 0, 0, 0)
        title_col.setAlignment(Qt.AlignVCenter)
        title_text = QLabel("Whisper")
        title_text.setStyleSheet("font-weight: 600; color: #1a1a1a; letter-spacing: -1px; font-size: 28px;")
        title_col.addWidget(title_text)
        sub_text = QLabel("语音识别转文本")
        sub_text.setStyleSheet("color: #868e96; font-weight: 400;")
        title_col.addWidget(sub_text)
        title_row.addLayout(title_col)
        title_row.addStretch()

        left_layout.addLayout(title_row)
        left_layout.addSpacing(36)

        # 文件路径
        sec1_label = QLabel("文件路径")
        sec1_label.setStyleSheet("color: #adb5bd; text-transform: uppercase; letter-spacing: 1px; font-weight: 500;")
        left_layout.addWidget(sec1_label)
        left_layout.addSpacing(8)
        self.file_edit = QLineEdit()
        self.file_edit.setPlaceholderText("输入文件或文件夹路径...")
        self.file_edit.setStyleSheet(self._input_style())
        self.file_edit.textChanged.connect(
            lambda value: self.settings.setValue("paths/input", value)
        )
        left_layout.addWidget(self.file_edit)
        left_layout.addSpacing(12)
        self.file_btn = QPushButton("浏览")
        self.file_btn.setStyleSheet(
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
            "QPushButton::menu-indicator { image: none; width: 0px; }"
        )
        self.file_btn.setMaximumWidth(80)
        self.file_btn.setCursor(Qt.PointingHandCursor)
        file_menu = QMenu(self)
        file_menu.setStyleSheet(
            "QMenu {"
            "  background: #ffffff;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 8px;"
            "  padding: 4px;"
            "}"
            "QMenu::item {"
            "  padding: 8px 16px;"
            "  border-radius: 6px;"
            "  color: #495057;"
            "}"
            "QMenu::item:selected {"
            "  background: #f8f9fa;"
            "  color: #1a1a1a;"
            "}"
        )
        file_menu.addAction("选择文件", self._browse_input)
        file_menu.addAction("选择文件夹", self._browse_input_folder)
        self.file_btn.setMenu(file_menu)
        self.file_clear_btn = QPushButton("清空")
        self.file_clear_btn.setStyleSheet(self._ghost_btn_style())
        self.file_clear_btn.clicked.connect(lambda: self.file_edit.clear())
        self.file_clear_btn.setMaximumWidth(80)
        file_btn_row = QHBoxLayout()
        file_btn_row.setSpacing(8)
        file_btn_row.addWidget(self.file_btn)
        file_btn_row.addWidget(self.file_clear_btn)
        file_btn_row.addStretch()
        left_layout.addLayout(file_btn_row)
        left_layout.addSpacing(28)

        # 输出目录
        sec2_label = QLabel("输出目录")
        sec2_label.setStyleSheet("color: #adb5bd; text-transform: uppercase; letter-spacing: 1px; font-weight: 500;")
        left_layout.addWidget(sec2_label)
        left_layout.addSpacing(8)
        self.out_edit = QLineEdit()
        self.out_edit.setPlaceholderText("留空则自动创建 Text 文件夹")
        self.out_edit.setStyleSheet(self._input_style())
        self.out_edit.textChanged.connect(
            lambda value: self.settings.setValue("paths/output", value)
        )
        left_layout.addWidget(self.out_edit)
        left_layout.addSpacing(12)
        self.out_btn = QPushButton("浏览")
        self.out_btn.setStyleSheet(self._ghost_btn_style())
        self.out_btn.clicked.connect(self._browse_output)
        self.out_btn.setMaximumWidth(80)
        self.out_clear_btn = QPushButton("清空")
        self.out_clear_btn.setStyleSheet(self._ghost_btn_style())
        self.out_clear_btn.clicked.connect(lambda: self.out_edit.clear())
        self.out_clear_btn.setMaximumWidth(80)
        out_btn_row = QHBoxLayout()
        out_btn_row.setSpacing(8)
        out_btn_row.addWidget(self.out_btn)
        out_btn_row.addWidget(self.out_clear_btn)
        out_btn_row.addStretch()
        left_layout.addLayout(out_btn_row)
        left_layout.addSpacing(28)

        # 处理模式（从 PRESETS 数据驱动生成，按 group 分行）
        sec3_label = QLabel("处理模式")
        sec3_label.setStyleSheet("color: #adb5bd; text-transform: uppercase; letter-spacing: 1px; font-weight: 500;")
        left_layout.addWidget(sec3_label)
        left_layout.addSpacing(8)
        self.mode_buttons = {}  # id -> QRadioButton
        group_names = list(dict.fromkeys(p["group"] for p in PRESETS))
        for gi, gname in enumerate(group_names):
            row = QHBoxLayout()
            row.setSpacing(16)
            for p in PRESETS:
                if p["group"] != gname:
                    continue
                btn = QRadioButton(p["label"])
                btn.setStyleSheet(self._radio_style())
                btn.toggled.connect(self._on_mode_changed)
                self.mode_buttons[p["id"]] = btn
                row.addWidget(btn)
            row.addStretch()
            left_layout.addLayout(row)
            if gi < len(group_names) - 1:
                left_layout.addSpacing(4)
        left_layout.addSpacing(8)
        self.mode_buttons[PRESETS[0]["id"]].setChecked(True)
        self.mode_desc = QLabel(PRESETS[0]["desc"])
        self.mode_desc.setStyleSheet("color: #adb5bd; padding-left: 2px;")
        self.mode_desc.setWordWrap(True)
        left_layout.addWidget(self.mode_desc)
        left_layout.addSpacing(36)

        # 桌面保存选项
        self.desktop_cb = QCheckBox("自动保存到桌面并转 Markdown")
        self.desktop_cb.setStyleSheet(self._checkbox_style())
        self.desktop_cb.setCursor(Qt.PointingHandCursor)
        left_layout.addWidget(self.desktop_cb)
        left_layout.addSpacing(36)

        # 控制按钮
        self.start_btn = QPushButton("开始转录")
        self.start_btn.setStyleSheet(self._primary_btn_style())
        self.start_btn.setCursor(Qt.PointingHandCursor)
        self.start_btn.setMinimumHeight(48)
        self.start_btn.clicked.connect(self._start)
        self.stop_btn = QPushButton("停止")
        self.stop_btn.setStyleSheet(self._danger_btn_style())
        self.stop_btn.setCursor(Qt.PointingHandCursor)
        self.stop_btn.setMinimumHeight(48)
        self.stop_btn.clicked.connect(self._stop)
        self.stop_btn.setEnabled(False)
        btn_row = QHBoxLayout()
        btn_row.setSpacing(12)
        btn_row.addWidget(self.start_btn, 2)
        btn_row.addWidget(self.stop_btn, 1)
        left_layout.addLayout(btn_row)
        left_layout.addSpacing(16)
        self.status_lbl = QLabel("就绪")
        self.status_lbl.setStyleSheet("color: #adb5bd;")
        left_layout.addWidget(self.status_lbl)
        left_layout.addSpacing(24)

        left_layout.addStretch()
        # 左面板固定 440px
        left.setFixedWidth(440)
        main_layout.addWidget(left)

        # --- 中间栏：双页切换（队列 / 性能监控）---
        center = QFrame()
        center.setStyleSheet("background: #ffffff;")
        center.setMinimumWidth(500)
        center.setMaximumWidth(500)
        center_layout = QVBoxLayout(center)
        center_layout.setContentsMargins(40, 28, 40, 24)
        center_layout.setSpacing(0)
        center_layout.setAlignment(Qt.AlignTop)
        main_layout.addWidget(center)

        # 标题行 + 页面选择下拉
        center_header = QHBoxLayout()
        center_header.setSpacing(0)
        # 页面选择按钮（带圆角边框）
        self.page_selector = QPushButton("参数")
        self.page_selector.setStyleSheet(
            "QPushButton {"
            "  background-color: #f1f3f5;"
            "  color: #868e96;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 8px;"
            "  padding: 6px 12px;"
            "  font-weight: 500;"
            "}"
            "QPushButton:hover {"
            "  color: #495057;"
            "  border-color: #ced4da;"
            "}"
            "QPushButton::menu-indicator {"
            "  image: none;"
            "  width: 0px;"
            "}"
        )
        self.page_selector.setCursor(Qt.PointingHandCursor)
        center_header.addWidget(self.page_selector)
        # 创建菜单
        self.page_menu = QMenu(self)
        self.page_menu.setStyleSheet(
            "QMenu {"
            "  background: #ffffff;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 8px;"
            "  padding: 4px;"
            "}"
            "QMenu::item {"
            "  padding: 8px 16px;"
            "  border-radius: 6px;"
            "  color: #495057;"
            "}"
            "QMenu::item:selected {"
            "  background: #f8f9fa;"
            "  color: #1a1a1a;"
            "}"
        )
        self.page_menu.addAction("参数", lambda: self._switch_page(0))
        self.page_menu.addAction("监视", lambda: self._switch_page(1))
        self.page_selector.setMenu(self.page_menu)
        center_header.addWidget(self.page_selector)
        center_header.addStretch()
        center_layout.addLayout(center_header)
        center_layout.addSpacing(12)

        # 双页容器
        self.center_stack = QStackedWidget()
        self.center_stack.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

        # ===== 第 1 页：AI 参数 =====
        param_page = QWidget()
        param_page_layout = QVBoxLayout(param_page)
        param_page_layout.setContentsMargins(0, 0, 0, 0)
        param_page_layout.setSpacing(0)
        self.param_table = QTableWidget(0, 2)
        self.param_table.setColumnWidth(0, 280)
        self.param_table.setColumnWidth(1, 180)
        self.param_table.horizontalHeader().setVisible(False)
        self.param_table.verticalHeader().setVisible(False)
        self.param_table.setShowGrid(False)
        self.param_table.setSelectionMode(QTableWidget.NoSelection)
        self.param_table.setFocusPolicy(Qt.NoFocus)
        self.param_table.setStyleSheet(
            "QTableWidget {"
            "  background: #f8f9fa;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 12px;"
            "  padding: 12px;"
            "  color: #495057;"
            "  font-family: 'Consolas', 'Courier New', monospace;"
            "  font-size: 17px;"
            "}"
            "QTableWidget::item {"
            "  padding: 4px 8px;"
            "  border-bottom: 1px solid #e9ecef;"
            "}"
            "QTableWidget::item:selected {"
            "  background: transparent;"
            "}"
        )
        self.param_table.setVerticalScrollMode(QTableWidget.ScrollPerPixel)
        self.param_table.setHorizontalScrollMode(QTableWidget.ScrollPerPixel)
        self.param_table.verticalScrollBar().setSingleStep(12)
        self.param_table.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        param_page_layout.addWidget(self.param_table)
        self.center_stack.addWidget(param_page)

        # ===== 第 2 页：性能监控 =====
        perf_page = QWidget()
        perf_page_layout = QVBoxLayout(perf_page)
        perf_page_layout.setContentsMargins(0, 0, 0, 0)
        perf_page_layout.setSpacing(12)
        perf_page_layout.setAlignment(Qt.AlignTop)

        # CPU 图表
        self.cpu_chart = PerfChart("CPU")
        perf_page_layout.addWidget(self.cpu_chart)
        # 内存图表
        self.mem_chart = PerfChart("内存")
        perf_page_layout.addWidget(self.mem_chart)
        # GPU 图表（NVIDIA GPU 利用率）
        self.gpu_chart = PerfChart("GPU")
        self.gpu_chart.set_unit("%")
        perf_page_layout.addWidget(self.gpu_chart)
        # 显存图表
        self.gpu_mem_chart = PerfChart("显存")
        self.gpu_mem_chart.set_unit("%")
        perf_page_layout.addWidget(self.gpu_mem_chart)
        perf_page_layout.addStretch()
        self.center_stack.addWidget(perf_page)

        center_layout.addWidget(self.center_stack)

        # 性能监控定时器
        self._perf_timer = QTimer(self)
        self._perf_timer.timeout.connect(self._update_perf)
        self._perf_timer.setInterval(1000)
        self._has_nvidia = False
        try:
            import pynvml
            pynvml.nvmlInit()
            self._nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self._has_nvidia = True
        except Exception as exc:
            logger.warning("无法初始化 NVIDIA 监控（%s）: %s", type(exc).__name__, exc)

        # --- 右侧日志面板 ---
        right = QFrame()
        right.setStyleSheet("background: #ffffff;")
        right.setMinimumWidth(100)
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(40, 28, 40, 24)
        right_layout.setSpacing(0)
        right_layout.setAlignment(Qt.AlignTop)

        log_header = QHBoxLayout()
        log_header.setSpacing(0)
        # 日志标题（QPushButton，与队列标题完全一致）
        self.log_title_btn = QPushButton("日志")
        self.log_title_btn.setStyleSheet(
            "QPushButton {"
            "  background-color: #f1f3f5;"
            "  color: #868e96;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 8px;"
            "  padding: 6px 12px;"
            "  font-weight: 500;"
            "}"
            "QPushButton:hover {"
            "  color: #495057;"
            "  border-color: #ced4da;"
            "}"
            "QPushButton::menu-indicator {"
            "  image: none;"
            "  width: 0px;"
            "}"
        )
        self.log_title_btn.setCursor(Qt.PointingHandCursor)
        log_header.addWidget(self.log_title_btn)
        log_header.addStretch()
        self.copy_log_btn = QPushButton("复制")
        self.copy_log_btn.setStyleSheet("QPushButton { background: transparent; color: #adb5bd; border: none; padding: 4px 8px; } QPushButton:hover { color: #495057; }")
        self.copy_log_btn.setCursor(Qt.PointingHandCursor)
        self.copy_log_btn.clicked.connect(self._copy_log)
        log_header.addWidget(self.copy_log_btn)
        log_header.addSpacing(8)
        self.clear_log_btn = QPushButton("清空")
        self.clear_log_btn.setStyleSheet("QPushButton { background: transparent; color: #adb5bd; border: none; padding: 4px 8px; } QPushButton:hover { color: #495057; }")
        self.clear_log_btn.clicked.connect(self._clear_log)
        log_header.addWidget(self.clear_log_btn)
        right_layout.addLayout(log_header)
        right_layout.addSpacing(12)

        # 日志框：用 QFrame 包裹，提供圆角边框（和队列列表一致）
        log_frame = QFrame()
        log_frame.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        log_frame.setStyleSheet(
            "QFrame {"
            "  background: #f8f9fa;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 12px;"
            "}"
        )
        log_frame_layout = QVBoxLayout(log_frame)
        log_frame_layout.setContentsMargins(16, 16, 16, 16)
        log_frame_layout.setSpacing(0)
        self.log_edit = QPlainTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setStyleSheet(
            "QPlainTextEdit {"
            "  background: transparent;"
            "  color: #495057;"
            "  border: none;"
            "  font-family: 'SF Mono', 'SFMono-Regular', Consolas, monospace;"
            "  line-height: 1.6;"
            "}"
        )
        self.log_edit.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        log_frame_layout.addWidget(self.log_edit)
        right_layout.addWidget(log_frame)
        right_layout.addSpacing(8)

        # 右下角：缩放按钮（1512×882 / 50% / 75%）
        zoom_bar = QHBoxLayout()
        zoom_bar.setSpacing(8)
        zoom_bar.addStretch()

        # 固定分辨率按钮：1512×882
        zoom_frame = QFrame()
        zoom_frame.setMinimumHeight(34)
        zoom_frame.setMaximumHeight(34)
        zoom_frame.setStyleSheet(
            "QFrame {"
            "  background: #ffffff;"
            "  border: 1px solid #e9ecef;"
            "  border-radius: 10px;"
            "}"
        )
        zoom_frame_layout = QHBoxLayout(zoom_frame)
        zoom_frame_layout.setContentsMargins(12, 0, 12, 0)
        zoom_frame_layout.setSpacing(0)
        btn = QPushButton("50%")
        btn.setStyleSheet(
            "QPushButton {"
            "  background: transparent;"
            "  color: #adb5bd;"
            "  border: none;"
            "  padding: 0;"
            "}"
            "QPushButton:hover {"
            "  color: #495057;"
            "}"
        )
        btn.setCursor(Qt.PointingHandCursor)
        btn.clicked.connect(lambda: self._resize_window_fixed(1512, 882))
        zoom_frame_layout.addWidget(btn)
        zoom_bar.addWidget(zoom_frame)

        for pct in [75]:
            zoom_frame = QFrame()
            zoom_frame.setMinimumHeight(34)
            zoom_frame.setMaximumHeight(34)
            zoom_frame.setStyleSheet(
                "QFrame {"
                "  background: #ffffff;"
                "  border: 1px solid #e9ecef;"
                "  border-radius: 10px;"
                "}"
            )
            zoom_frame_layout = QHBoxLayout(zoom_frame)
            zoom_frame_layout.setContentsMargins(12, 0, 12, 0)
            zoom_frame_layout.setSpacing(0)
            btn = QPushButton(f"{pct}%")
            btn.setStyleSheet(
                "QPushButton {"
                "  background: transparent;"
                "  color: #adb5bd;"
                "  border: none;"
                "  padding: 0;"
                "}"
                "QPushButton:hover {"
                "  color: #495057;"
                "}"
            )
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda checked, p=pct: self._resize_window_fixed(int(QApplication.desktop().screenGeometry().width() * p / 100), int(QApplication.desktop().screenGeometry().width() * p / 100 / self._ratio)))
            zoom_frame_layout.addWidget(btn)
            zoom_bar.addWidget(zoom_frame)
        right_layout.addLayout(zoom_bar)

        right.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        main_layout.addWidget(right)

        self.setStyleSheet("""
            QMainWindow { background: #ffffff; border: none; }
            QLineEdit:focus { border: 1px solid #adb5bd; }
            QRadioButton::indicator { width: 16px; height: 16px; }
            QRadioButton::indicator:checked { background: #1a1a1a; border-radius: 8px; }
            QRadioButton::indicator:unchecked { background: #e9ecef; border-radius: 8px; }
        """)

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
                return get_preset(pid)
        return PRESETS[0]

    def _on_mode_changed(self):
        # UI 构建过程中 setChecked 可能提前触发本函数，此时控件尚未就绪，跳过
        if not hasattr(self, 'mode_desc') or not hasattr(self, 'param_table'):
            return
        preset = self._current_preset()
        self.mode_desc.setText(preset["desc"])
        self.settings.setValue("transcription/preset", preset["id"])
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
        self.file_edit.setText(self.settings.value("paths/input", "", type=str))
        self.out_edit.setText(self.settings.value("paths/output", "", type=str))

        preset_id = self.settings.value(
            "transcription/preset", PRESETS[0]["id"], type=str
        )
        button = self.mode_buttons.get(preset_id)
        if button is not None:
            button.setChecked(True)

        geometry = self.settings.value("window/geometry")
        if geometry is not None and not self.restoreGeometry(geometry):
            logger.warning("QSettings 中的窗口几何信息无效，已使用默认窗口位置")

    def _save_settings(self):
        """Persist current paths, preset and window geometry."""
        self.settings.setValue("paths/input", self.file_edit.text())
        self.settings.setValue("paths/output", self.out_edit.text())
        self.settings.setValue("transcription/preset", self._current_preset()["id"])
        self.settings.setValue("window/geometry", self.saveGeometry())
        self.settings.sync()
        if self.settings.status() != QSettings.NoError:
            logger.warning("QSettings 写入失败，状态码: %s", self.settings.status())

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
        errors = check_env()
        if errors:
            self._append_log("环境检查失败", "#c0392b")
            for e in errors:
                self._append_log(e, "#c0392b")
            QMessageBox.critical(self, "环境检查失败", "\n\n".join(errors))
        else:
            self._append_log("环境检查通过，可以开始转录", "#27ae60")
            self._append_log(f"Python: {VENV_PYTHON}")
            for p in PRESETS:
                self._append_log(f"{p['label']}: {script_path(p)}")

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
        # 根据处理模式选择脚本（从 presets 单一数据源读取）
        preset = self._current_preset()
        mode_str = preset["label"]

        output_p = self.out_edit.text().strip()
        cmd = [str(VENV_PYTHON), "-m", script_module(preset), input_p]
        if output_p:
            cmd.extend(["-o", output_p])
        if self.desktop_cb.isChecked():
            cmd.append("--desktop")
        self._append_log("=" * 50, "#2980b9")
        self._append_log(f"▶ 启动转录 | {mode_str}", "#2980b9")
        self._append_log(f"{' '.join(cmd)}", "#2980b9")
        self._append_log("=" * 50, "#2980b9")
        self.is_running = True
        self._user_stopped = False
        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.status_lbl.setText("正在转录中...")
        self.status_lbl.setStyleSheet("color: #e67e22;")
        # 自动切换到监控页
        if self.center_stack.currentIndex() == 0:
            self._toggle_center_page()
        self._perf_timer.start()
        self.process.start(str(VENV_PYTHON), cmd[1:])

    def _on_output(self):
        data = self.process.readAllStandardOutput().data().decode("utf-8", errors="replace")
        for line in data.splitlines():
            if line.strip():
                self._append_log(line.strip())

    def _on_finished(self, exit_code, exit_status):
        self._stop_timeout_timer.stop()
        if self._user_stopped:
            self._append_log("\n已停止", "#e67e22")
            self.status_lbl.setText("已停止")
            self.status_lbl.setStyleSheet("color: #adb5bd;")
        elif exit_code == 0:
            self._append_log("\n转录全部完成！", "#27ae60")
            self.status_lbl.setText("转录完成")
            self.status_lbl.setStyleSheet("color: #27ae60;")
        else:
            self._append_log(f"\n进程异常退出，返回码: {exit_code}", "#c0392b")
            self.status_lbl.setText(f"异常退出 (code {exit_code})")
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
        if self.process.state() != QProcess.NotRunning:
            self._user_stopped = True
            self._append_log("\n请求停止...", "#e67e22")
            self.process.terminate()
            self._stop_timeout_timer.start()

    def _kill_process_if_running(self):
        """terminate 超时后异步强制终止，避免阻塞 GUI 主线程。"""
        if self.process.state() != QProcess.NotRunning:
            self.process.kill()
            self._append_log("强制终止", "#e67e22")


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
