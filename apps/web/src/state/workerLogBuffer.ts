export const WORKER_LOG_LIMIT = 1500;
export const WORKER_LOG_LINE_LIMIT = 8000;

export function appendWorkerLog(
  logs: string[],
  offset: number,
  latestError: string | null,
  line: string,
) {
  const clipped = line.length > WORKER_LOG_LINE_LIMIT;
  const retained = clipped ? `${line.slice(0, WORKER_LOG_LINE_LIMIT - 12)}…[本行已截断]` : line;
  const dropped = Math.max(0, logs.length + 1 - WORKER_LOG_LIMIT);
  const next = logs.slice(dropped);
  next.push(retained);
  return {
    logs: next,
    logsOffset: offset + dropped,
    latestErrorLog: /\[(ERROR|CRITICAL)\]|\b(ERROR|CRITICAL|Traceback)\b/i.test(line)
      ? retained
      : latestError,
    clipped,
  };
}
