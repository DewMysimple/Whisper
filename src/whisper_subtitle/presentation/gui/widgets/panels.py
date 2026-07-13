"""Builders for the three existing main-window panels."""

from __future__ import annotations

import logging

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QPixmap
from PyQt5.QtWidgets import (
    QApplication, QCheckBox, QFrame, QHBoxLayout, QLabel, QLineEdit, QMenu,
    QPlainTextEdit, QPushButton, QRadioButton, QSizePolicy, QStackedWidget,
    QTableWidget, QVBoxLayout, QWidget,
)

from ....domain.presets import PRESETS
from .performance import PerfChart

logger = logging.getLogger(__name__)


class MainPanels:
    """Build the unchanged settings, parameters/monitor and log panels."""

    def __init__(self, owner):
        object.__setattr__(self, "_owner", owner)

    def __getattr__(self, name):
        return getattr(self._owner, name)

    def __setattr__(self, name, value):
        setattr(self._owner, name, value)

    def build(self):
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

        self._build_settings_panel(main_layout)
        self._build_center_panel(main_layout)
        self._build_log_panel(main_layout)
        self.setStyleSheet("""
            QMainWindow { background: #ffffff; border: none; }
            QLineEdit:focus { border: 1px solid #adb5bd; }
            QRadioButton::indicator { width: 16px; height: 16px; }
            QRadioButton::indicator:checked { background: #1a1a1a; border-radius: 8px; }
            QRadioButton::indicator:unchecked { background: #e9ecef; border-radius: 8px; }
        """)

    def _build_settings_panel(self, main_layout):
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
        try:
            pixmap = QPixmap()
            if pixmap.loadFromData(self.app_paths.read_resource("logo.png")):
                pixmap = pixmap.scaled(
                    48, 48, Qt.KeepAspectRatio, Qt.SmoothTransformation
                )
                logo_lbl.setPixmap(pixmap)
        except FileNotFoundError as exc:
            logger.warning("无法加载标题图标: %s", exc)
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
            self.settings_repository.set_input_path
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
        file_menu = QMenu(self._owner)
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
            self.settings_repository.set_output_path
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
        group_names = list(dict.fromkeys(p.group for p in PRESETS))
        for gi, gname in enumerate(group_names):
            row = QHBoxLayout()
            row.setSpacing(16)
            for p in PRESETS:
                if p.group != gname:
                    continue
                btn = QRadioButton(p.label)
                btn.setStyleSheet(self._radio_style())
                btn.toggled.connect(self._on_mode_changed)
                self.mode_buttons[p.id] = btn
                row.addWidget(btn)
            row.addStretch()
            left_layout.addLayout(row)
            if gi < len(group_names) - 1:
                left_layout.addSpacing(4)
        left_layout.addSpacing(8)
        self.mode_buttons[PRESETS[0].id].setChecked(True)
        self.mode_desc = QLabel(PRESETS[0].description)
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


    def _build_center_panel(self, main_layout):
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
        self.page_menu = QMenu(self._owner)
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
        self._perf_timer = QTimer(self._owner)
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


    def _build_log_panel(self, main_layout):
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
