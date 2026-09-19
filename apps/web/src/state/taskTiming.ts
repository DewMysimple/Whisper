export function elapsedTextSeconds(value: string): number {
  if (!/^\d+:\d{2}(?::\d{2})?$/.test(value)) return 0;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatElapsedSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = hours > 0 ? [hours, minutes, remainder] : [minutes, remainder];
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}
