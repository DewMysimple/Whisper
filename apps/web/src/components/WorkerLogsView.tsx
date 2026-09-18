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
import { useCallback, useEffect, useRef, useState } from 'react';

import { desktopBridge } from '../bridge';
import { useWorkspace } from '../state/workspace';
import { useAutoFollow } from './useAutoFollow';

export function WorkerLogsView() {
  const logs = useWorkspace((state) => state.logs);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const model = useWorkspace((state) => state.model);
  const isReady = hostStatus.state === 'ready';
  const streamRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
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

  useEffect(() => {
    if (!clearArmed) return;
    const timeout = window.setTimeout(() => setClearArmed(false), 4000);
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClearArmed(false);
    };
    const cancelOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-log-clear]') === null) setClearArmed(false);
    };
    document.addEventListener('keydown', cancelOnEscape);
    document.addEventListener('pointerdown', cancelOutside, true);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('keydown', cancelOnEscape);
      document.removeEventListener('pointerdown', cancelOutside, true);
    };
  }, [clearArmed]);

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
      setClearArmed(true);
      setFeedback('4 秒内再次点击以清空当前会话日志');
      return;
    }
    try {
      await desktopBridge.clearWorkerLogs();
      setClearArmed(false);
      setFeedback('当前会话日志已清空');
    } catch {
      setClearArmed(false);
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

  return (
    <div className="worker-logs-workspace">
      <section className="worker-log-status" aria-label="Worker 日志状态">
        <article data-tone={isReady ? 'ready' : 'waiting'}>
          <span className="worker-log-status-icon">
            <span className={`worker-log-pulse ${isReady ? 'is-ready' : ''}`} />
          </span>
          <div>
            <small>WORKER</small>
            <strong>{isReady ? '运行就绪' : hostStatus.state.toUpperCase()}</strong>
            <span>{isReady ? '诊断通道连接正常' : '正在等待本地服务'}</span>
          </div>
        </article>
        <article>
          <span className="worker-log-status-icon">
            <Activity size={18} />
          </span>
          <div>
            <small>PROCESS</small>
            <strong>{hostStatus.pid === null ? '等待启动' : `PID ${hostStatus.pid}`}</strong>
            <span>{hostStatus.pid === null ? '进程尚未分配' : '受桌面 Host 监管'}</span>
          </div>
        </article>
        <article>
          <span className="worker-log-status-icon">
            <Braces size={18} />
          </span>
          <div>
            <small>MODEL</small>
            <strong>{model.state === 'unloaded' ? '按需加载' : model.state.toUpperCase()}</strong>
            <span>{model.modelId ?? '任务开始时自动选择'}</span>
          </div>
        </article>
        <article>
          <span className="worker-log-status-icon">
            <CircleDot size={18} />
          </span>
          <div>
            <small>BUFFER</small>
            <strong>{logs.length} 行日志</strong>
            <span>仅保留当前桌面会话</span>
          </div>
        </article>
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
                data-log-clear
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
            logs.map((line, index) => (
              <code key={`${index}-${line}`}>
                <span>{String(index + 1).padStart(3, '0')}</span>
                {line}
              </code>
            ))
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
