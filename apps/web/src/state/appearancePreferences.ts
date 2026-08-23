export type ThemePreference = 'dark' | 'light' | 'system';
export type AccentPreset = 'orange' | 'blue' | 'green' | 'purple' | 'custom';
export type UiFontFamily =
  'system' | 'segoe-variable' | 'microsoft-yahei-ui' | 'noto-sans-sc' | 'dengxian';
export type MonoFontFamily = 'cascadia-mono' | 'cascadia-code' | 'consolas';

export interface AppearancePreferences {
  theme: ThemePreference;
  accentPreset: AccentPreset;
  customAccentColor: string;
  uiFontSize: number;
  logFontSize: number;
  uiFontFamily: UiFontFamily;
  monoFontFamily: MonoFontFamily;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: 'system',
  accentPreset: 'orange',
  customAccentColor: '#FF5B04',
  uiFontSize: 14,
  logFontSize: 12,
  uiFontFamily: 'system',
  monoFontFamily: 'cascadia-mono',
};

export const UI_FONT_SIZE_RANGE = { minimum: 12, maximum: 18 } as const;
export const LOG_FONT_SIZE_RANGE = { minimum: 10, maximum: 16 } as const;

export function applyThemePreference(theme: ThemePreference): void {
  const resolved =
    theme === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false)
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#151515' : '#FAFAFA');
}

const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Microsoft YaHei UI', 'Segoe UI', sans-serif",
  'segoe-variable': "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif",
  'microsoft-yahei-ui': "'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  'noto-sans-sc': "'Noto Sans SC', 'Microsoft YaHei UI', 'Segoe UI', sans-serif",
  dengxian: "DengXian, 'Microsoft YaHei UI', 'Segoe UI', sans-serif",
};

const MONO_FONT_STACKS: Record<MonoFontFamily, string> = {
  'cascadia-mono': "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
  'cascadia-code': "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  consolas: "Consolas, 'Cascadia Mono', monospace",
};

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function contrastColor(hex: string): '#111111' | '#FFFFFF' {
  const luminanceWeights = [0.2126, 0.7152, 0.0722] as const;
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  const luminance = channels.reduce(
    (sum, channel, index) =>
      sum +
      (channel / 255 <= 0.03928
        ? channel / 255 / 12.92
        : ((channel / 255 + 0.055) / 1.055) ** 2.4) *
        luminanceWeights[index]!,
    0,
  );
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? '#FFFFFF' : '#111111';
}

export function applyAppearancePreferences(preferences: AppearancePreferences): void {
  applyThemePreference(preferences.theme);
  const root = document.documentElement;
  root.removeAttribute('data-content-font-size');
  root.dataset.accentPreset = preferences.accentPreset;
  root.style.setProperty('--ui-font-size', `${preferences.uiFontSize}px`);
  root.style.setProperty('--log-font-size', `${preferences.logFontSize}px`);
  root.style.setProperty('--ui-font-family', UI_FONT_STACKS[preferences.uiFontFamily]);
  root.style.setProperty('--mono', MONO_FONT_STACKS[preferences.monoFontFamily]);
  if (preferences.accentPreset === 'custom') {
    const custom =
      normalizeHexColor(preferences.customAccentColor) ?? DEFAULT_APPEARANCE.customAccentColor;
    root.style.setProperty('--accent', custom);
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${custom} 84%, black)`);
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${custom} 14%, transparent)`);
    root.style.setProperty('--on-accent', contrastColor(custom));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--accent-soft');
    root.style.removeProperty('--on-accent');
  }
}
