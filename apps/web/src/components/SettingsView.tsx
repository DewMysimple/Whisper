import {
  ArrowRight,
  Check,
  Download,
  Maximize2,
  Minus,
  Palette,
  PanelLeft,
  PanelTop,
  Plus,
  Play,
  RotateCcw,
  Type,
  Upload,
} from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  LOG_FONT_SIZE_RANGE,
  currentInterfaceSizePreset,
  normalizeHexColor,
  SIDEBAR_WIDTH_RANGE,
  UI_FONT_SIZE_RANGE,
  WORKSPACE_FONT_SIZE_RANGE,
  WORKSPACE_WIDTH_RANGE,
  TOPBAR_HEIGHT_RANGE,
  type AccentPreset,
  type InterfaceSizePreset,
  type MonoFontFamily,
  type UiFontFamily,
} from '../state/persistence';
import { useWorkspace } from '../state/workspace';
import { Button } from './Button';
import { PreferenceChoiceCard } from './PreferenceChoiceCard';
import { RoundedSelect } from './RoundedSelect';

const ACCENT_PALETTE: Array<{
  id: string;
  preset?: Exclude<AccentPreset, 'custom'>;
  label: string;
  color: string;
}> = [
  { id: 'orange', preset: 'orange', label: '橙色', color: '#FF5B04' },
  { id: 'blue', preset: 'blue', label: '蓝色', color: '#3478C7' },
  { id: 'green', preset: 'green', label: '绿色', color: '#16845F' },
  { id: 'purple', preset: 'purple', label: '紫色', color: '#6E5AE6' },
  { id: 'coral', label: '珊瑚红', color: '#E5484D' },
  { id: 'magenta', label: '洋红', color: '#B44BC8' },
  { id: 'gold', label: '琥珀金', color: '#8A6414' },
  { id: 'graphite', label: '石墨灰', color: '#495057' },
];

const UI_FONTS: Array<{ id: UiFontFamily; label: string }> = [
  { id: 'system', label: '系统默认' },
  { id: 'segoe-variable', label: 'Segoe UI Variable' },
  { id: 'microsoft-yahei-ui', label: 'Microsoft YaHei UI' },
  { id: 'noto-sans-sc', label: 'Noto Sans SC' },
  { id: 'dengxian', label: 'DengXian' },
];

const MONO_FONTS: Array<{ id: MonoFontFamily; label: string }> = [
  { id: 'cascadia-mono', label: 'Cascadia Mono' },
  { id: 'cascadia-code', label: 'Cascadia Code' },
  { id: 'consolas', label: 'Consolas' },
];

const THEMES = [
  {
    id: 'system',
    label: '跟随 Windows',
  },
  {
    id: 'light',
    label: '浅色',
  },
  {
    id: 'dark',
    label: '深色',
  },
] as const;

const INTERFACE_SIZE_CHOICES: Array<{ id: InterfaceSizePreset; label: string }> = [
  { id: 'small', label: '偏小' },
  { id: 'balanced', label: '平衡' },
  { id: 'large', label: '偏大' },
];

function hexToRgb(hex: string): [number, number, number] {
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  ) as [number, number, number];
}

function rgbToHex(channels: [number, number, number]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

function rgbToHsv([red, green, blue]: [number, number, number]): HsvColor {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }

  return {
    h: hue < 0 ? hue + 360 : hue,
    s: maximum === 0 ? 0 : delta / maximum,
    v: maximum,
  };
}

function hsvToRgb({ h, s, v }: HsvColor): [number, number, number] {
  const normalizedHue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const secondary = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const match = v - chroma;
  let channels: [number, number, number];

  if (normalizedHue < 60) channels = [chroma, secondary, 0];
  else if (normalizedHue < 120) channels = [secondary, chroma, 0];
  else if (normalizedHue < 180) channels = [0, chroma, secondary];
  else if (normalizedHue < 240) channels = [0, secondary, chroma];
  else if (normalizedHue < 300) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  return channels.map((channel) => Math.round((channel + match) * 255)) as [number, number, number];
}

function CustomColorPicker({ onChange, value }: { onChange(value: string): void; value: string }) {
  const [open, setOpen] = useState(false);
  const [hue, setHue] = useState(() => rgbToHsv(hexToRgb(value)).h);
  const containerRef = useRef<HTMLDivElement>(null);
  const saturationRef = useRef<HTMLDivElement>(null);
  const channels = hexToRgb(value);
  const colorHsv = rgbToHsv(channels);
  const hsv = { ...colorHsv, h: hue };

  useEffect(() => {
    const nextColor = rgbToHsv(hexToRgb(value));
    if (nextColor.s > 0) setHue(nextColor.h);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const updateChannel = (channelIndex: number, nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    const nextChannels = [...channels] as [number, number, number];
    nextChannels[channelIndex] = Math.min(255, Math.max(0, Math.round(nextValue)));
    onChange(rgbToHex(nextChannels));
  };

  const updateHsv = (nextColor: Partial<HsvColor>) => {
    onChange(rgbToHex(hsvToRgb({ ...hsv, ...nextColor })));
  };

  const updateSaturationValue = (clientX: number, clientY: number) => {
    const bounds = saturationRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const saturation = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const brightness = 1 - Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height));
    updateHsv({ s: saturation, v: brightness });
  };

  const handleSaturationPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId);
    if (event.type === 'pointermove' && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    updateSaturationValue(event.clientX, event.clientY);
  };

  return (
    <div className={`custom-color-picker ${open ? 'is-open' : ''}`} ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="打开自定义强调色编辑器"
        className="custom-color-trigger"
        onClick={() => setOpen((current) => !current)}
        style={{ '--custom-color': value } as CSSProperties}
        type="button"
      >
        <span />
      </button>
      {open && (
        <div aria-label="自定义强调色编辑器" className="custom-color-popover" role="dialog">
          <div className="custom-color-popover-heading">
            <span style={{ '--custom-color': value } as CSSProperties} />
            <div>
              <strong>自定义强调色</strong>
              <small>{value}</small>
            </div>
          </div>
          <div
            aria-label="调节饱和度与明度"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`}
            className="custom-color-saturation"
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.1 : 0.02;
              if (event.key === 'ArrowLeft') updateHsv({ s: Math.max(0, hsv.s - step) });
              else if (event.key === 'ArrowRight') updateHsv({ s: Math.min(1, hsv.s + step) });
              else if (event.key === 'ArrowDown') updateHsv({ v: Math.max(0, hsv.v - step) });
              else if (event.key === 'ArrowUp') updateHsv({ v: Math.min(1, hsv.v + step) });
              else return;
              event.preventDefault();
            }}
            onPointerDown={handleSaturationPointer}
            onPointerMove={handleSaturationPointer}
            ref={saturationRef}
            role="slider"
            style={
              {
                '--picker-hue': `hsl(${hue} 100% 50%)`,
                '--picker-x': `${hsv.s * 100}%`,
                '--picker-y': `${(1 - hsv.v) * 100}%`,
              } as CSSProperties
            }
            tabIndex={0}
          >
            <span className="custom-color-saturation-thumb" />
          </div>
          <div className="custom-color-slider-row">
            <span className="custom-color-slider-icon" aria-hidden="true" />
            <input
              aria-label="自定义强调色色相"
              className="custom-color-hue"
              max={360}
              min={0}
              onChange={(event) => {
                const nextHue = event.currentTarget.valueAsNumber;
                setHue(nextHue);
                updateHsv({ h: nextHue });
              }}
              type="range"
              value={Math.round(hue)}
            />
          </div>
          <div className="custom-color-slider-row custom-color-alpha-row">
            <span className="custom-color-checker" aria-hidden="true" />
            <div
              aria-label="强调色不透明度固定为 100%"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={100}
              className="custom-color-alpha"
              role="meter"
              style={{ '--custom-color': value } as CSSProperties}
            >
              <span />
            </div>
          </div>
          <div className="custom-color-channel-heading">
            <strong>RGB</strong>
            <span>不透明度固定为 100%</span>
          </div>
          <div className="custom-color-channels">
            {(['R', 'G', 'B'] as const).map((channel, channelIndex) => (
              <label key={channel}>
                <span>{channel}</span>
                <input
                  aria-label={`${channel} 通道`}
                  max={255}
                  min={0}
                  onChange={(event) =>
                    updateChannel(channelIndex, event.currentTarget.valueAsNumber)
                  }
                  type="number"
                  value={channels[channelIndex]}
                />
              </label>
            ))}
            <div aria-label="不透明度 100%" className="custom-color-opacity-value">
              100%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberStepper({
  label,
  maximum,
  minimum,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onChange(value: number): void;
  step?: number;
  value: number;
}) {
  return (
    <div className="appearance-stepper" role="group" aria-label={label}>
      <button
        aria-label={`减小${label}`}
        disabled={value <= minimum}
        onClick={() => onChange(Math.max(minimum, value - step))}
        type="button"
      >
        <Minus size={15} />
      </button>
      <IntegerInput
        className="appearance-number-input"
        label={`${label}数值`}
        maximum={maximum}
        minimum={minimum}
        onChange={onChange}
        step={step}
        value={value}
      />
      <button
        aria-label={`增大${label}`}
        disabled={value >= maximum}
        onClick={() => onChange(Math.min(maximum, value + step))}
        type="button"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

function IntegerInput({
  className,
  label,
  maximum,
  minimum,
  onChange,
  step,
  value,
}: {
  className: string;
  label: string;
  maximum: number;
  minimum: number;
  onChange(value: number): void;
  step: number;
  value: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const discardOnBlur = useRef(false);

  useEffect(() => setDraft(String(value)), [value]);

  const commitDraft = () => {
    if (discardOnBlur.current) {
      discardOnBlur.current = false;
      return;
    }
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(maximum, Math.max(minimum, Math.round(parsed)));
    setDraft(String(next));
    onChange(next);
  };

  const updateValue = (next: number) => {
    const clamped = Math.min(maximum, Math.max(minimum, next));
    setDraft(String(clamped));
    onChange(clamped);
  };

  return (
    <label className={className}>
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        aria-valuemax={maximum}
        aria-valuemin={minimum}
        aria-valuenow={value}
        aria-valuetext={`${value} px`}
        autoComplete="off"
        inputMode="numeric"
        maxLength={String(maximum).length}
        onBlur={commitDraft}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value.replace(/\D+/g, '');
          setDraft(nextDraft);
          const parsed = Number.parseInt(nextDraft, 10);
          if (Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum) {
            onChange(parsed);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            discardOnBlur.current = true;
            setDraft(String(value));
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            updateValue(value + step);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            updateValue(value - step);
          }
        }}
        pattern="[0-9]*"
        role="spinbutton"
        spellCheck={false}
        type="text"
        value={draft}
      />
      <small aria-hidden="true">px</small>
    </label>
  );
}

function DimensionControl({
  description,
  icon,
  label,
  maximum,
  minimum,
  onChange,
  step,
  value,
}: {
  description: string;
  icon: ReactNode;
  label: string;
  maximum: number;
  minimum: number;
  onChange(value: number): void;
  step: number;
  value: number;
}) {
  return (
    <div className="dimension-control">
      <div className="dimension-control-copy">
        <span>{icon}</span>
        <div>
          <strong>{label}</strong>
          <small>{description}</small>
        </div>
      </div>
      <div className="dimension-control-input">
        <button
          aria-label={`缩小${label}`}
          disabled={value <= minimum}
          onClick={() => onChange(Math.max(minimum, value - step))}
          type="button"
        >
          <Minus size={15} />
        </button>
        <input
          aria-label={`${label}滑杆`}
          max={maximum}
          min={minimum}
          onChange={(event) => onChange(Number(event.target.value))}
          step={1}
          type="range"
          value={value}
        />
        <button
          aria-label={`扩大${label}`}
          disabled={value >= maximum}
          onClick={() => onChange(Math.min(maximum, value + step))}
          type="button"
        >
          <Plus size={15} />
        </button>
        <IntegerInput
          className="dimension-number-input"
          label={`${label}数值`}
          maximum={maximum}
          minimum={minimum}
          onChange={onChange}
          step={step}
          value={value}
        />
      </div>
    </div>
  );
}

export function SettingsView() {
  const theme = useWorkspace((state) => state.theme);
  const setTheme = useWorkspace((state) => state.setTheme);
  const accentPreset = useWorkspace((state) => state.accentPreset);
  const setAccentPreset = useWorkspace((state) => state.setAccentPreset);
  const customAccentColor = useWorkspace((state) => state.customAccentColor);
  const setCustomAccentColor = useWorkspace((state) => state.setCustomAccentColor);
  const uiFontSize = useWorkspace((state) => state.uiFontSize);
  const setUiFontSize = useWorkspace((state) => state.setUiFontSize);
  const workspaceFontSize = useWorkspace((state) => state.workspaceFontSize);
  const setWorkspaceFontSize = useWorkspace((state) => state.setWorkspaceFontSize);
  const logFontSize = useWorkspace((state) => state.logFontSize);
  const setLogFontSize = useWorkspace((state) => state.setLogFontSize);
  const setInterfaceSizePreset = useWorkspace((state) => state.setInterfaceSizePreset);
  const uiFontFamily = useWorkspace((state) => state.uiFontFamily);
  const setUiFontFamily = useWorkspace((state) => state.setUiFontFamily);
  const monoFontFamily = useWorkspace((state) => state.monoFontFamily);
  const setMonoFontFamily = useWorkspace((state) => state.setMonoFontFamily);
  const sidebarWidth = useWorkspace((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspace((state) => state.setSidebarWidth);
  const workspaceWidth = useWorkspace((state) => state.workspaceWidth);
  const setWorkspaceWidth = useWorkspace((state) => state.setWorkspaceWidth);
  const topbarHeight = useWorkspace((state) => state.topbarHeight);
  const setTopbarHeight = useWorkspace((state) => state.setTopbarHeight);
  const restoreAppearanceDefaults = useWorkspace((state) => state.restoreAppearanceDefaults);
  const environment = useWorkspace((state) => state.environment);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const model = useWorkspace((state) => state.model);
  const configText = useWorkspace((state) => state.configText);
  const setConfigText = useWorkspace((state) => state.setConfigText);
  const exportConfig = useWorkspace((state) => state.exportConfig);
  const importConfig = useWorkspace((state) => state.importConfig);
  const restartWorker = useWorkspace((state) => state.restartWorker);
  const [accentDraft, setAccentDraft] = useState(customAccentColor);
  const normalizedAccent = normalizeHexColor(accentDraft);
  const selectedInterfaceSize = currentInterfaceSizePreset({
    uiFontSize,
    workspaceFontSize,
    logFontSize,
  });

  useEffect(() => setAccentDraft(customAccentColor), [customAccentColor]);

  return (
    <div className="settings-workspace">
      <section className="panel settings-card settings-hero">
        <div className="appearance-heading">
          <div>
            <p className="step-label">DESK APPEARANCE</p>
            <h2>桌面外观</h2>
            <p>分别管理桌面框架、工作台内容和诊断日志，不再由一个字号牵动全部页面。</p>
          </div>
          <button
            className="secondary-button appearance-reset"
            onClick={restoreAppearanceDefaults}
            type="button"
          >
            <RotateCcw size={15} /> 恢复外观默认值
          </button>
        </div>

        <div
          className="appearance-preview"
          aria-label="当前外观实时预览"
          style={
            { '--preview-sidebar-width': `${Math.round(sidebarWidth / 4)}px` } as CSSProperties
          }
        >
          <div className="appearance-preview-rail">
            <span />
            <i />
            <i />
            <i />
          </div>
          <div className="appearance-preview-canvas">
            <p>LOCAL TRANSCRIPTION</p>
            <strong>清晰、稳定的本地工作台</strong>
            <span>
              框架 {uiFontSize}px · 内容 {workspaceFontSize}px · 日志 {logFontSize}px
            </span>
            <div>
              <Button
                variant="primary"
                motion
                className="appearance-preview-start"
                onClick={() => useWorkspace.getState().setActiveView('workspace')}
              >
                <Play aria-hidden="true" fill="currentColor" size={13} />
                开始本地转录
                <ArrowRight aria-hidden="true" size={15} />
              </Button>
              <code className="diagnostic-text">[WORKER] ready · LOCAL IPC</code>
            </div>
          </div>
          <div className="appearance-preview-facts" aria-hidden="true">
            <span>
              <small>导航栏</small>
              <strong>{sidebarWidth}px</strong>
            </span>
            <span>
              <small>工作台</small>
              <strong>{workspaceWidth}px</strong>
            </span>
            <span>
              <small>顶栏</small>
              <strong>{topbarHeight}px</strong>
            </span>
          </div>
        </div>
      </section>

      <div className="settings-preference-grid">
        <section className="panel settings-card settings-section-card theme-settings-card">
          <div className="appearance-section-title">
            <Palette size={18} />
            <div>
              <h3>主题与强调色</h3>
              <span>背景保持正式克制，强调色只服务操作、焦点与状态。</span>
            </div>
          </div>
          <fieldset className="theme-choice-grid">
            <legend className="sr-only">主题</legend>
            {THEMES.map((option) => (
              <PreferenceChoiceCard
                checked={theme === option.id}
                key={option.id}
                label={option.label}
                name="theme"
                onChange={() => setTheme(option.id)}
                value={option.id}
              >
                <span className={`theme-sample is-${option.id}`} aria-hidden="true">
                  {option.id === 'system' && <span className="theme-mode-badge">AUTO</span>}
                  <i />
                  <b />
                  <em />
                </span>
              </PreferenceChoiceCard>
            ))}
          </fieldset>

          <div className="accent-setting-row">
            <div className="accent-palette-heading">
              <div>
                <strong>工作台调色板</strong>
                <small>均已适配浅色与深色界面；成功、警告和错误色保持固定语义。</small>
              </div>
              <span>{ACCENT_PALETTE.length} 组推荐色</span>
            </div>
            <div className="accent-palette-grid" role="group" aria-label="工作台强调色调色板">
              {ACCENT_PALETTE.map((accent) => {
                const selected = accent.preset
                  ? accentPreset === accent.preset
                  : accentPreset === 'custom' && customAccentColor === accent.color;
                return (
                  <button
                    aria-label={`${accent.label}强调色`}
                    aria-pressed={selected}
                    className="accent-palette-option"
                    key={accent.id}
                    onClick={() =>
                      accent.preset
                        ? setAccentPreset(accent.preset)
                        : setCustomAccentColor(accent.color)
                    }
                    style={{ '--swatch': accent.color } as CSSProperties}
                    type="button"
                  >
                    <span className="accent-palette-swatch" aria-hidden="true">
                      {selected && <Check size={14} />}
                    </span>
                    <span className="accent-palette-copy">
                      <strong>{accent.label}</strong>
                      <small>{accent.color}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="accent-custom-row">
              <div className="custom-color-control">
                <span>自定义颜色</span>
                <CustomColorPicker
                  onChange={(value) => {
                    setAccentDraft(value);
                    setCustomAccentColor(value);
                  }}
                  value={normalizedAccent ?? customAccentColor}
                />
                <input
                  aria-describedby={normalizedAccent === null ? 'accent-color-error' : undefined}
                  aria-invalid={normalizedAccent === null}
                  aria-label="自定义强调色十六进制"
                  onChange={(event) => {
                    const value = event.target.value;
                    setAccentDraft(value);
                    const normalized = normalizeHexColor(value);
                    if (normalized !== null) setCustomAccentColor(normalized);
                  }}
                  spellCheck={false}
                  value={accentDraft}
                />
              </div>
              <button
                className="quiet-button restore-orange"
                disabled={accentPreset === 'orange'}
                onClick={() => setAccentPreset('orange')}
                type="button"
              >
                <RotateCcw size={14} /> 恢复橙色
              </button>
            </div>
          </div>
          {normalizedAccent === null && (
            <p className="appearance-inline-error" id="accent-color-error" role="alert">
              请输入完整的十六进制颜色，例如 #FF5B04。
            </p>
          )}
        </section>

        <section className="panel settings-card settings-section-card layout-settings-card">
          <div className="appearance-section-title">
            <Maximize2 size={18} />
            <div>
              <h3>工作区尺寸</h3>
              <span>独立调节内容承载宽度、左侧工作台导航与顶部标题区域。</span>
            </div>
          </div>
          <div className="dimension-control-list">
            <DimensionControl
              description="控制卡片工作区在大屏上的最大展开宽度"
              icon={<Maximize2 size={17} />}
              label="工作台内容宽度"
              maximum={WORKSPACE_WIDTH_RANGE.maximum}
              minimum={WORKSPACE_WIDTH_RANGE.minimum}
              onChange={setWorkspaceWidth}
              step={WORKSPACE_WIDTH_RANGE.step}
              value={workspaceWidth}
            />
            <DimensionControl
              description="控制工作台选择栏的横向占用空间"
              icon={<PanelLeft size={17} />}
              label="导航栏宽度"
              maximum={SIDEBAR_WIDTH_RANGE.maximum}
              minimum={SIDEBAR_WIDTH_RANGE.minimum}
              onChange={setSidebarWidth}
              step={SIDEBAR_WIDTH_RANGE.step}
              value={sidebarWidth}
            />
            <DimensionControl
              description="控制标题、状态与全局操作所在顶栏的纵向空间"
              icon={<PanelTop size={17} />}
              label="顶栏高度"
              maximum={TOPBAR_HEIGHT_RANGE.maximum}
              minimum={TOPBAR_HEIGHT_RANGE.minimum}
              onChange={setTopbarHeight}
              step={TOPBAR_HEIGHT_RANGE.step}
              value={topbarHeight}
            />
          </div>
          <p className="layout-setting-note">
            小窗口仍会自动采用响应式布局；这里调整的是全屏和宽屏下的舒适阅读比例。
          </p>
        </section>

        <section className="panel settings-card settings-section-card typography-settings-card">
          <div className="appearance-section-title">
            <Type size={18} />
            <div>
              <h3>字体与字号</h3>
              <span>字体家族全局统一；桌面框架、工作台内容与日志字号分别生效。</span>
            </div>
          </div>
          <div className="interface-size-preset-heading">
            <strong>整体界面大小</strong>
            <small>同时调整框架、工作台内容和 Worker 日志字号；下方仍可分别微调。</small>
          </div>
          <fieldset className="interface-size-choice-grid">
            <legend className="sr-only">整体界面大小</legend>
            {INTERFACE_SIZE_CHOICES.map((option) => (
              <PreferenceChoiceCard
                checked={selectedInterfaceSize === option.id}
                key={option.id}
                label={option.label}
                name="interface-size"
                onChange={() => setInterfaceSizePreset(option.id)}
                value={option.id}
              >
                <span className={`interface-size-sample is-${option.id}`} aria-hidden="true">
                  <i />
                  <span>
                    <b />
                    <em />
                    <strong />
                  </span>
                  {option.id === 'balanced' && (
                    <span className="interface-size-default-badge">默认</span>
                  )}
                </span>
              </PreferenceChoiceCard>
            ))}
          </fieldset>
          <div className="font-family-grid">
            <div className="font-family-control">
              <span>
                <strong>UI 字体</strong>
                <small>用于导航、标题、卡片和控件</small>
              </span>
              <RoundedSelect
                label="UI 字体"
                onChange={setUiFontFamily}
                options={UI_FONTS}
                value={uiFontFamily}
              />
            </div>
            <div className="font-family-control">
              <span>
                <strong>等宽字体</strong>
                <small>用于数值、路径与日志时间和来源标识</small>
              </span>
              <RoundedSelect
                label="等宽字体"
                onChange={setMonoFontFamily}
                options={MONO_FONTS}
                value={monoFontFamily}
              />
            </div>
          </div>
          <div className="typography-setting-grid">
            <div className="typography-size-row">
              <span>
                <strong>界面框架字号</strong>
                <small>仅侧栏、顶栏与全局框架</small>
              </span>
              <NumberStepper
                label="界面框架字号"
                maximum={UI_FONT_SIZE_RANGE.maximum}
                minimum={UI_FONT_SIZE_RANGE.minimum}
                onChange={setUiFontSize}
                value={uiFontSize}
              />
            </div>
            <div className="typography-size-row">
              <span>
                <strong>工作台内容字号</strong>
                <small>卡片、说明、数据与操作项</small>
              </span>
              <NumberStepper
                label="工作台内容字号"
                maximum={WORKSPACE_FONT_SIZE_RANGE.maximum}
                minimum={WORKSPACE_FONT_SIZE_RANGE.minimum}
                onChange={setWorkspaceFontSize}
                value={workspaceFontSize}
              />
            </div>
            <div className="typography-size-row">
              <span>
                <strong>Worker 日志字号</strong>
                <small>只改变实时诊断代码行</small>
              </span>
              <NumberStepper
                label="Worker 日志字号"
                maximum={LOG_FONT_SIZE_RANGE.maximum}
                minimum={LOG_FONT_SIZE_RANGE.minimum}
                onChange={setLogFontSize}
                value={logFontSize}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="settings-support-grid">
        <section className="panel settings-card runtime-card">
          <p className="step-label">LOCAL RUNTIME</p>
          <h2>本地运行环境</h2>
          <p>只读展示当前桌面 Host、Worker 与模型的真实运行状态。</p>
          <dl>
            <dt>启动模式</dt>
            <dd>{hostStatus.launchKind?.toUpperCase() ?? 'PENDING'}</dd>
            <dt>Worker</dt>
            <dd>{hostStatus.state.toUpperCase()}</dd>
            <dt>Desktop IPC</dt>
            <dd>{hostStatus.launchKind === 'mock' ? 'MOCK' : 'LOCAL'}</dd>
            <dt>模型状态</dt>
            <dd>{model.state.toUpperCase()}</dd>
            <dt>Python 环境</dt>
            <dd>{environment?.available ? `PYTHON ${environment.python}` : 'PENDING'}</dd>
            <dt>网络端口</dt>
            <dd>0</dd>
          </dl>
          <div className="settings-actions">
            <button className="secondary-button" onClick={() => void restartWorker()} type="button">
              <RotateCcw size={16} /> 重启 Worker
            </button>
          </div>
        </section>

        <section className="panel settings-card config-card">
          <p className="step-label">PORTABLE SETTINGS</p>
          <h2>便携配置</h2>
          <p>导出外观、布局、Preset、参数覆盖和输出策略，不包含任务历史或日志。</p>
          <textarea
            aria-label="配置 JSON"
            onChange={(event) => setConfigText(event.target.value)}
            placeholder="点击导出生成 schemaVersion 1 配置，或粘贴配置后导入。"
            rows={10}
            value={configText}
          />
          <div className="settings-actions">
            <button className="secondary-button" onClick={exportConfig} type="button">
              <Download size={16} /> 生成导出配置
            </button>
            <button className="secondary-button" onClick={importConfig} type="button">
              <Upload size={16} /> 应用导入配置
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
