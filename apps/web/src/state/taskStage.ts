const LEGACY_TASK_STAGE_LABELS: Readonly<Record<string, string>> = {
  'GPU 转录中': '转录中',
  '等待本地 GPU': '等待执行',
};

export function formatTaskStage(stage: string): string {
  return LEGACY_TASK_STAGE_LABELS[stage] ?? stage;
}
