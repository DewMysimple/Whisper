import { Activity, Braces, CircleDot, Copy, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { desktopBridge } from '../bridge';
import { useWorkspace } from '../state/workspace';

export function WorkerLogsView() {
  const logs = useWorkspace((state) => state.logs);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const model = useWorkspace((state) => state.model);
  const isReady = hostStatus.state === 'ready';
  const visibleLogs = logs.slice(-200);
  const streamRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [feedback, setFeedback] = useState('');
  const logText = visibleLogs.length === 0 ? '' : `${visibleLogs.join('\r\n')}\r\n`;

  useEffect(() => {
    if (!followingRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleLogs.length]);

  const copyLogs = async () => {
    try {
      await desktopBridge.copyWorkerLogs(logText);
      setFeedback(`已复制 ${visibleLogs.length} 行日志`);
    } catch {
      setFeedback('复制失败，请检查系统剪贴板权限');
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
        <div>
          <span className={`worker-log-pulse ${isReady ? 'is-ready' : ''}`} />
          <div>
            <small>WORKER</small>
            <strong>{hostStatus.state.toUpperCase()}</strong>
          </div>
        </div>
        <div>
          <Activity size={17} />
          <div>
            <small>PROCESS</small>
            <strong>{hostStatus.pid === null ? '等待启动' : `PID ${hostStatus.pid}`}</strong>
          </div>
        </div>
        <div>
          <Braces size={17} />
          <div>
            <small>MODEL</small>
            <strong>{model.state.toUpperCase()}</strong>
          </div>
        </div>
        <div>
          <CircleDot size={17} />
          <div>
            <small>BUFFER</small>
            <strong>{visibleLogs.length} / 200</strong>
          </div>
        </div>
      </section>

      <section className="worker-log-console panel" aria-labelledby="worker-log-title">
        <div className="worker-log-console-heading">
          <div>
            <p className="step-label">WORKER / LIFECYCLE / STDERR · LIVE</p>
            <h2 id="worker-log-title">实时诊断输出</h2>
          </div>
          <div className="worker-log-heading-actions">
            <span>{isReady ? '持续接收' : '等待 Worker'}</span>
            <button
              className="secondary-button"
              disabled={visibleLogs.length === 0}
              onClick={() => void copyLogs()}
              type="button"
            >
              <Copy size={15} /> 复制全部
            </button>
            <button
              className="secondary-button"
              disabled={visibleLogs.length === 0}
              onClick={() => void exportLogs()}
              type="button"
            >
              <Download size={15} /> 导出 TXT
            </button>
          </div>
        </div>
        <div
          className="log-view worker-log-stream"
          aria-label="Worker 日志"
          onScroll={(event) => {
            const element = event.currentTarget;
            followingRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
          ref={streamRef}
          role="log"
        >
          {visibleLogs.length === 0 ? (
            <div className="worker-log-empty">
              <Braces size={22} />
              <strong>暂无 Worker 日志</strong>
              <span>Worker 启动、模型加载和任务诊断信息会在这里实时出现。</span>
            </div>
          ) : (
            visibleLogs.map((line, index) => (
              <code key={`${index}-${line}`}>
                <span>{String(index + 1).padStart(3, '0')}</span>
                {line}
              </code>
            ))
          )}
        </div>
        <div className="worker-log-footer">
          <p className="worker-log-footnote">
            只显示当前会话最近 200 行；向上滚动时暂停跟随，回到底部后自动恢复。
          </p>
          <span aria-live="polite">{feedback}</span>
        </div>
      </section>
    </div>
  );
}
