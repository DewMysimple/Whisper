"""Task-manager-style performance chart used by the monitoring panel."""

from __future__ import annotations

from collections import deque

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QBrush, QColor, QFont, QPainter, QPainterPath, QPen
from PyQt5.QtWidgets import QSizePolicy, QWidget


class PerfChart(QWidget):
    """Small real-time line chart with the existing visual style."""

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
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        width, height = self.width(), self.height()
        margin_left, margin_right, margin_top, margin_bottom = 40, 10, 18, 18
        chart_width = width - margin_left - margin_right
        chart_height = height - margin_top - margin_bottom

        painter.setBrush(QBrush(QColor("#f8f9fa")))
        painter.setPen(QPen(QColor("#e9ecef"), 1))
        painter.drawRoundedRect(0, 0, width, height, 6, 6)

        painter.setPen(QPen(QColor("#868e96")))
        painter.setFont(QFont("LXGW WenKai", 10))
        painter.drawText(10, 14, self.title)

        value_text = self.detail or f"{self.current_value:.1f}{self.unit}"
        painter.setPen(QPen(QColor("#1a1a1a")))
        painter.setFont(QFont("LXGW WenKai", 11, QFont.Bold))
        text_width = painter.fontMetrics().width(value_text)
        painter.drawText(width - text_width - 10, 14, value_text)

        painter.setClipRect(margin_left, margin_top, chart_width, chart_height)
        painter.setPen(QPen(QColor("#e9ecef"), 1))
        for index in range(1, 5):
            y = margin_top + chart_height * index / 5
            painter.drawLine(margin_left, int(y), width - margin_right, int(y))

        if len(self.data) > 1:
            step = chart_width / (self.max_points - 1)
            points = [
                (
                    margin_left + index * step,
                    margin_top + chart_height * (1 - value / 100),
                )
                for index, value in enumerate(self.data)
            ]
            path = QPainterPath()
            path.moveTo(*points[0])
            for point in points[1:]:
                path.lineTo(*point)
            painter.setPen(QPen(QColor("#1a1a1a"), 2))
            painter.drawPath(path)

            fill = QPainterPath()
            fill.moveTo(points[0][0], height - margin_bottom)
            for point in points:
                fill.lineTo(*point)
            fill.lineTo(points[-1][0], height - margin_bottom)
            fill.closeSubpath()
            painter.setPen(Qt.NoPen)
            painter.setBrush(QBrush(QColor("#1a1a1a").lighter(220)))
            painter.drawPath(fill)

        painter.end()
