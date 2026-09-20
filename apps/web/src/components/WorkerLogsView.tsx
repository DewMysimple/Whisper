import {
  Activity,
  ArrowRight,
  Braces,
  CheckCircle2,
  CircleDot,
  Copy,
  Download,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';

import { desktopBridge } from '../bridge';
import { useWorkspace } from '../state/workspace';
import { useTimedConfirmation } from './useTimedConfirmation';
import { CardButton } from './CardButton';
import { useAutoFollow } from './useAutoFollow';

interface ParsedWorkerLogLine {
  date: string | null;
  message: string;
  scope: string;
  time: string | null;
  tone: 'error' | 'model' | 'stderr' | 'task' | 'worker';
}

export function parseWorkerLogLine(line: string): ParsedWorkerLogLine {
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s+\[([^\]]+)\]\s*(.*)$/);
  const scope = match?.[3] ?? 'SYSTEM';
  const normalizedScope = scope.toLocaleUpperCase();
  const tone = normalizedScope.startsWith('TASK')
    ? 'task'
    : normalizedScope === 'MODEL'
      ? 'model'
      : normalizedScope === 'ERROR'
        ? 'error'
        : normalizedScope === 'STDERR'
          ? 'stderr'
          : 'worker';
  return {
    date: match?.[1] ?? null,
    message: match?.[4] || line,
    scope,
    time: match?.[2] ?? null,
    tone,
  };
}

export function WorkerLogsView() {
  const logs = useWorkspace((state) => state.logs);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const model = useWorkspace((state) => state.model);
  const isReady = hostStatus.state === 'ready';
  const streamRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState('');
  const [confirmation, setConfirmation] = useTimedConfirmation<{ key: string }>();
  const clearArmed = confirmation !== null;
  const reducedMotion = useReducedMotion();
  const logText = logs.length === 0 ? '' : `${logs.join('\r\n')}\r\n`;

  const followLatest = useCallback(() => {
    const stream = streamRef.current;
    if (stream === null) return;
    if (typeof stream.scrollTo === 'function') {
      stream.scrollTo({
        top: stream.scrollHeight,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    } else {
      stream.scrollTop = stream.scrollHeight;
    }
  }, [reducedMotion]);
  const logFollowHandlers = useAutoFollow({
    enabled: true,
    follow: followLatest,
    targetKey: logs.length,
  });

  const copyLogs = async () => {
    try {
      await desktopBridge.copyWorkerLogs(logText);
      setFeedback(`已复制 ${logs.length} 行日志`);
    } catch {
      setFeedback('复制失败，请检查系统剪贴板权限');
    }
  };

  const clearLogs = async () => {
    if (!clearArmed) {
      setConfirmation({ key: 'clear-logs' });
      setFeedback('4 秒内再次点击以清空当前会话日志');
      return;
    }
    try {
      await desktopBridge.clearWorkerLogs();
      setConfirmation(null);
      setFeedback('当前会话日志已清空');
    } catch {
      setConfirmation(null);
      setFeedback('清空失败，Worker 日志未被删除');
    }
  };

  const exportLogs = async () => {
    try {
      const path = await desktopBridge.exportWorkerLogs(logText);
      if (path !== null) setFeedback(`日志已导出：${path}`);
    } catch {
      setFeedback('导出失败，请重新选择可写入的位置');
    }
  };

  const locateLog = (kind: 'worker' | 'process' | 'model' | 'buffer') => {
    logFollowHandlers.onPointerDown();
    const stream = streamRef.current;
    if (!stream) return;
    const index =
      kind === 'buffer'
        ? logs.length - 1
        : logs.findLastIndex((line) => {
            const parsed = parseWorkerLogLine(line);
            if (kind === 'model') return parsed.tone === 'model';
            if (kind === 'process') return /\b(PID|HOST|PROCESS)\b/i.test(line);
            return parsed.scope.toUpperCase() === 'WORKER';
          });
    stream.focus({ preventScroll: true });
    const row = stream.querySelector<HTMLElement>(`[data-log-index="${index}"]`);
    if (row) {
      stream.scrollTo?.({
        top:
          stream.scrollTop + row.getBoundingClientRect().top - stream.getBoundingClientRect().top,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
      setFeedback(`已定位第 ${index + 1} 行日志`);
    } else setFeedback('当前会话暂无对应日志，后续事件会自动显示。');
  };

  return (
    <div className="worker-logs-workspace">
      <section className="worker-log-status" aria-label="Worker 日志状态">
        <CardButton
          onClick={() => locateLog('worker')}
          title="定位最近的 Worker 日志"
          data-tone={isReady ? 'ready' : 'waiting'}
        >
          <span className="worker-log-status-icon">
            <span className={`worker-log-pulse ${isReady ? 'is-ready' : ''}`} />
          </span>
          <div>
            <small>WORKER</small>
            <strong>{isReady ? '运行就绪' : hostStatus.state.toUpperCase()}</strong>
            <span>{isReady ? '诊断通道连接正常' : '正在等待本地服务'}</span>
          </div>
        </CardButton>
        <CardButton onClick={() => locateLog('process')} title="定位进程日志">
          <span className="worker-log-status-icon">
            <Activity size={18} />
          </span>
          <div>
            <small>PROCESS</small>
            <strong>{hostStatus.pid === null ? '等待启动' : `PID ${hostStatus.pid}`}</strong>
            <span>{hostStatus.pid === null ? '进程尚未分配' : '受桌面 Host 监管'}</span>
          </div>
        </CardButton>
        <CardButton onClick={() => locateLog('model')} title="定位模型日志">
          <span className="worker-log-status-icon">
            <Braces size={18} />
          </span>
          <div>
            <small>MODEL</small>
            <strong>{model.state === 'unloaded' ? '按需加载' : model.state.toUpperCase()}</strong>
            <span>{model.modelId ?? '任务开始时自动选择'}</span>
          </div>
        </CardButton>
        <CardButton onClick={() => locateLog('buffer')} title="定位最新日志">
          <span className="worker-log-status-icon">
            <CircleDot size={18} />
          </span>
          <div>
            <small>BUFFER</small>
            <strong>{logs.length} 行日志</strong>
            <span>仅保留当前桌面会话</span>
          </div>
        </CardButton>
      </section>

      <section className="worker-log-console panel" aria-labelledby="worker-log-title">
        <div className="worker-log-console-heading">
          <div className="worker-log-title-group">
            <span className="worker-log-title-icon">
              <Terminal size={20} />
            </span>
            <div>
              <p className="step-label">WORKER / LIFECYCLE / STDERR</p>
              <h2 id="worker-log-title">实时诊断输出</h2>
              <p>集中查看 Worker 启动、模型加载、转录执行与异常信息。</p>
            </div>
          </div>
          <div className="worker-log-heading-actions">
            <span className={`worker-log-live-state ${isReady ? 'is-ready' : ''}`}>
              <i /> {isReady ? '实时接收中' : '等待 Worker'}
            </span>
            <div>
              <button
                className="secondary-button"
                disabled={logs.length === 0}
                onClick={() => void copyLogs()}
                type="button"
              >
                <Copy size={15} /> 复制全部
              </button>
              <button
                className="secondary-button"
                disabled={logs.length === 0}
                onClick={() => void exportLogs()}
                type="button"
              >
                <Download size={15} /> 导出 TXT
              </button>
              <button
                aria-pressed={clearArmed}
                className={`secondary-button is-danger-subtle ${clearArmed ? 'is-delete-armed' : ''}`}
                data-confirm-action="clear-logs"
                disabled={logs.length === 0}
                onClick={() => void clearLogs()}
                type="button"
              >
                <Trash2 size={15} /> {clearArmed ? '再次点击清空' : '清空日志'}
              </button>
            </div>
          </div>
        </div>
        <div
          className="log-view worker-log-stream"
          aria-label="Worker 日志"
          {...logFollowHandlers}
          ref={streamRef}
          role="log"
          tabIndex={0}
        >
          {logs.length === 0 ? (
            <div className="worker-log-empty">
              <span className="worker-log-empty-icon">
                <CheckCircle2 size={24} />
              </span>
              <p className="step-label">DIAGNOSTIC CHANNEL READY</p>
              <strong>诊断通道已就绪</strong>
              <span>当前没有需要展示的日志；后续事件会自动进入此控制台。</span>
              <div className="worker-log-empty-flow" aria-label="日志采集阶段">
                <span>Worker 启动</span>
                <ArrowRight size={14} />
                <span>模型加载</span>
                <ArrowRight size={14} />
                <span>任务执行</span>
              </div>
            </div>
          ) : (
            logs.map((line, index) => {
              const parsed = parseWorkerLogLine(line);
              return (
                <code key={`${index}-${line}`} data-log-index={index}>
                  <span className="worker-log-line-number">
                    {String(index + 1).padStart(3, '0')}
                  </span>
                  <time
                    className="worker-log-timestamp"
                    dateTime={
                      parsed.date && parsed.time ? `${parsed.date}T${parsed.time}` : undefined
                    }
                  >
                    {parsed.date ? <small>{parsed.date}</small> : <small>LOCAL</small>}
                    <strong>{parsed.time ?? '--:--:--'}</strong>
                  </time>
                  <span className="worker-log-source" data-tone={parsed.tone}>
                    {parsed.scope}
                  </span>
                  <span className="worker-log-message">{parsed.message}</span>
                </code>
              );
            })
          )}
        </div>
        <div className="worker-log-footer">
          <p className="worker-log-footnote">
            保留当前会话全部有效日志；人工滚动后暂停追踪，8 秒无操作自动恢复到最新处。
          </p>
          <span aria-live="polite">{feedback}</span>
        </div>
      </section>
    </div>
  );
}
