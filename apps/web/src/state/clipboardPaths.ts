const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;
const WINDOWS_UNC_PATH = /^\\\\[^\\]/;

function isWindowsPath(value: string): boolean {
  return WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value);
}

function stripOuterQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function pathsFromLine(line: string): string[] {
  const quoted = [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]!.trim());
  if (quoted.length > 0) return quoted;
  return [stripOuterQuotes(line.trim())];
}

export function parseWindowsClipboardPaths(content: string): string[] {
  const paths = content
    .split(/\r?\n/)
    .flatMap(pathsFromLine)
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && isWindowsPath(path));
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = path.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
