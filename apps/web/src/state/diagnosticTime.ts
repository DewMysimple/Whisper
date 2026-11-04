export function diagnosticRange(start: number | null, end: number | null): string | null {
  if (
    start === null ||
    end === null ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  )
    return null;
  if (![start, end].every((seconds) => Number.isSafeInteger(Math.round(seconds * 1000))))
    return null;
  // Use the same millisecond timecode for display and clipboard.
  const time = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    return `${Math.floor(ms / 3600000)
      .toString()
      .padStart(
        2,
        '0',
      )}:${(Math.floor(ms / 60000) % 60).toString().padStart(2, '0')}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')},${(ms % 1000).toString().padStart(3, '0')}`;
  };
  return `${time(start)} --> ${time(end)}`;
}
