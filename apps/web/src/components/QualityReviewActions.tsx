import { Copy, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { desktopBridge } from '../bridge';
import { diagnosticRange } from '../state/diagnosticTime';
import { Button } from './Button';

export function QualityReviewActions({
  text,
  start,
  end,
  mediaPath,
}: {
  text: string;
  start: number | null;
  end: number | null;
  mediaPath: string;
}) {
  const [feedback, setFeedback] = useState('');
  const range = diagnosticRange(start, end);
  const run = async (action: 'text' | 'time' | 'media') => {
    try {
      if (action === 'media') await desktopBridge.revealOutput(mediaPath);
      else await desktopBridge.copyWorkerLogs(action === 'text' ? text : range!);
      setFeedback(
        action === 'media'
          ? '已定位源媒体'
          : action === 'text'
            ? '已复制片段文本'
            : '已复制起止时间',
      );
    } catch {
      setFeedback(
        action === 'media' ? '定位失败，请检查源媒体是否存在' : '复制失败，请检查剪贴板权限',
      );
    }
  };
  return (
    <div>
      <div className="quality-review-actions" role="group" aria-label="片段快捷复核">
        <Button type="button" disabled={!text.trim()} onClick={() => void run('text')}>
          <Copy size={14} />
          复制片段
        </Button>
        <Button type="button" disabled={range === null} onClick={() => void run('time')}>
          <Copy size={14} />
          复制时间
        </Button>
        <Button type="button" disabled={!mediaPath.trim()} onClick={() => void run('media')}>
          <FolderOpen size={14} />
          定位媒体
        </Button>
      </div>
      <small role="status">{feedback}</small>
    </div>
  );
}
