import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useWorkspace } from '../state/workspace';

export function PowerCountdownBanner() {
  const status = useWorkspace((state) => state.powerActionStatus);
  const cancelPowerAction = useWorkspace((state) => state.cancelPowerAction);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status.state !== 'countdown') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [status.state, status.executeAtEpochMs]);

  const seconds = useMemo(() => {
    if (status.executeAtEpochMs === null) return 0;
    return Math.max(0, Math.ceil((status.executeAtEpochMs - now) / 1000));
  }, [now, status.executeAtEpochMs]);

  if (status.state !== 'countdown' || status.action === null) return null;
  return (
    <section className="power-countdown-banner" role="alert" aria-live="assertive">
      <span className="power-countdown-icon" aria-hidden="true">
        <AlertTriangle size={19} />
      </span>
      <div>
        <strong>队列已全部成功，系统将在 {seconds} 秒后关机</strong>
        <span>这是本次任务的一次性操作；现在取消不会影响已经生成的文件。</span>
      </div>
      <button onClick={() => void cancelPowerAction()} type="button">
        <X size={16} /> 取消关机
      </button>
    </section>
  );
}
