import { Check, FileAudio } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useRef } from 'react';
import type { TaskMediaSnapshot, TaskSnapshot } from '../../contracts/desktop';
import { formatMediaDuration } from '../../state/mediaDuration';
import { formatElapsedSeconds } from '../../state/taskTiming';
import { formatTaskStage } from '../../state/taskStage';
import { useAutoFollow } from '../useAutoFollow';
function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

function parentDirectory(path: string): string {
  const parts = path.split(/[/\\]/);
  parts.pop();
  return parts.join('\\') || '本机媒体';
}

function mediaStatusLabel(media: TaskMediaSnapshot, task: TaskSnapshot): string {
  if (
    (task.status === 'cancelled' || task.status === 'failed') &&
    (media.status === 'running' || media.status === 'pending')
  )
    return media.status === 'running' ? '处理已中断' : '未处理';
  if (media.status === 'completed') return '已完成';
  if (media.status === 'running') return formatTaskStage(media.stage);
  if (media.status === 'failed') return '处理失败';
  if (media.status === 'skipped') return '已跳过';
  return media.stage;
}

export function TaskMediaList({
  task,
  mediaStates,
  currentMedia,
  mediaSeconds,
  isInputTaskPreview,
}: {
  task: TaskSnapshot;
  mediaStates: TaskMediaSnapshot[];
  currentMedia: TaskMediaSnapshot | undefined;
  mediaSeconds: number;
  isInputTaskPreview: boolean;
}) {
  const mediaListRef = useRef<HTMLDivElement>(null);
  const mediaRowRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const followCurrentMedia = useCallback(() => {
    const row = mediaRowRef.current;
    const list = mediaListRef.current;
    if (!row || !list) return;
    const rowBounds = row.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (rowBounds.top >= listBounds.top && rowBounds.bottom <= listBounds.bottom) return;
    list.scrollTo?.({
      top:
        list.scrollTop +
        rowBounds.top -
        listBounds.top -
        (list.clientHeight - rowBounds.height) / 2,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [reducedMotion]);
  const mediaFollowHandlers = useAutoFollow({
    enabled: task.status === 'running' && currentMedia !== undefined,
    follow: followCurrentMedia,
    targetKey: currentMedia ? `${task.id}:${currentMedia.path}` : null,
  });

  return (
    <section className="task-media-monitor" aria-labelledby="task-media-title">
      <header>
        <div>
          <p className="step-label">EXPANDED MEDIA</p>
          <h3 id="task-media-title">{isInputTaskPreview ? '待处理输入清单' : '媒体文件进度'}</h3>
        </div>
        <span>
          {mediaStates.length} {isInputTaskPreview ? '项输入' : '个文件'}
        </span>
      </header>
      <div {...mediaFollowHandlers} ref={mediaListRef} className="task-media-list" tabIndex={0}>
        {mediaStates.map((media, index) => (
          <article
            className={`task-media-row is-${media.status}`}
            key={media.path}
            ref={media.path === currentMedia?.path ? mediaRowRef : undefined}
          >
            <span className="task-media-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="task-media-icon" aria-hidden="true">
              {media.status === 'completed' ? <Check size={16} /> : <FileAudio size={16} />}
            </span>
            <div className="task-media-copy">
              <strong>{fileName(media.path)}</strong>
              <span title={media.path}>{parentDirectory(media.path)}</span>
              <div
                aria-label={
                  media.progress === null
                    ? `${fileName(media.path)} 进度未知`
                    : `${fileName(media.path)} 进度 ${Math.round(media.progress)}%`
                }
                className={`task-media-track ${media.progress === null ? 'is-indeterminate' : ''}`}
              >
                {media.progress !== null && (
                  <span style={{ width: `${Math.max(0, Math.min(100, media.progress))}%` }} />
                )}
              </div>
            </div>
            <div className="task-media-state">
              <strong>{media.progress === null ? '—' : `${Math.round(media.progress)}%`}</strong>
              <span>{mediaStatusLabel(media, task)}</span>
              <small>
                {formatElapsedSeconds(
                  media.path === currentMedia?.path ? mediaSeconds : media.elapsedSeconds,
                )}{' '}
                / {formatMediaDuration(media.durationSeconds)}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
