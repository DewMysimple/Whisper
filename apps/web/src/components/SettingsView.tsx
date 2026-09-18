import {
  Check,
  ChevronDown,
  Download,
  Maximize2,
  Minus,
  Palette,
  PanelLeft,
  Plus,
  RotateCcw,
  Type,
  Upload,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import {
  LOG_FONT_SIZE_RANGE,
  normalizeHexColor,
  SIDEBAR_WIDTH_RANGE,
  UI_FONT_SIZE_RANGE,
  WORKSPACE_FONT_SIZE_RANGE,
  WORKSPACE_WIDTH_RANGE,
  type AccentPreset,
  type MonoFontFamily,
  type UiFontFamily,
} from '../state/persistence';
import { useWorkspace } from '../state/workspace';

const ACCENTS: Array<{ id: Exclude<AccentPreset, 'custom'>; label: string; color: string }> = [
  { id: 'orange', label: '橙色', color: '#FF5B04' },
  { id: 'blue', label: '蓝色', color: '#3478C7' },
  { id: 'green', label: '绿色', color: '#16845F' },
  { id: 'purple', label: '紫色', color: '#6E5AE6' },
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
    description: '跟随 Windows 的浅色或深色应用模式',
    id: 'system',
    label: '跟随 Windows',
  },
  {
    description: '固定使用明亮背景与深色文字',
    id: 'light',
    label: '浅色',
  },
  {
    description: '固定使用深色背景与浅色文字',
    id: 'dark',
    label: '深色',
  },
] as const;

const CUSTOM_COLOR_SUGGESTIONS = [
  '#FF5B04',
  '#E5484D',
  '#B44BC8',
  '#6E5AE6',
  '#3478C7',
  '#16845F',
  '#8A6414',
  '#495057',
] as const;

function RoundedSelect<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange(value: T): void;
  options: Array<{ id: T; label: string }>;
  value: T;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value) ?? options[0];

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

  return (
    <div className={`rounded-select ${open ? 'is-open' : ''}`} ref={containerRef}>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="rounded-select-trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        role="combobox"
        type="button"
      >
        <span>{selected?.label}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="rounded-select-list" id={listboxId} role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.id === value}
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {option.id === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  ) as [number, number, number];
}

function rgbToHex(channels: [number, number, number]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function CustomColorPicker({ onChange, value }: { onChange(value: string): void; value: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const channels = hexToRgb(value);

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
          <div className="custom-color-suggestions" role="group" aria-label="常用强调色">
            {CUSTOM_COLOR_SUGGESTIONS.map((color) => (
              <button
                aria-label={`选择颜色 ${color}`}
                aria-pressed={color === value}
                key={color}
                onClick={() => onChange(color)}
                style={{ '--custom-color': color } as CSSProperties}
                type="button"
              />
            ))}
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
      <output aria-live="polite">
        <strong>{value}</strong>
        <small>px</small>
      </output>
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
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commitDraft = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(maximum, Math.max(minimum, Math.round(parsed)));
    setDraft(String(next));
    onChange(next);
  };

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
        <label className="dimension-number-input">
          <span className="sr-only">{label}数值</span>
          <input
            aria-label={`${label}数值`}
            max={maximum}
            min={minimum}
            onBlur={commitDraft}
            onChange={(event) => {
              const nextDraft = event.currentTarget.value;
              setDraft(nextDraft);
              const parsed = Number.parseInt(nextDraft, 10);
              if (Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum) {
                onChange(parsed);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            step={1}
            type="number"
            value={draft}
          />
          <small>px</small>
        </label>
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
  const uiFontFamily = useWorkspace((state) => state.uiFontFamily);
  const setUiFontFamily = useWorkspace((state) => state.setUiFontFamily);
  const monoFontFamily = useWorkspace((state) => state.monoFontFamily);
  const setMonoFontFamily = useWorkspace((state) => state.setMonoFontFamily);
  const sidebarWidth = useWorkspace((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspace((state) => state.setSidebarWidth);
  const workspaceWidth = useWorkspace((state) => state.workspaceWidth);
  const setWorkspaceWidth = useWorkspace((state) => state.setWorkspaceWidth);
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
              <button type="button" tabIndex={-1}>
                开始本地转录
              </button>
              <code>[WORKER] ready · LOCAL IPC</code>
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
              <small>层级</small>
              <strong>3 组独立字号</strong>
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
              <label className={theme === option.id ? 'is-selected' : ''} key={option.id}>
                <input
                  aria-label={option.label}
                  checked={theme === option.id}
                  name="theme"
                  onChange={() => setTheme(option.id)}
                  type="radio"
                  value={option.id}
                />
                <span className={`theme-sample is-${option.id}`} aria-hidden="true">
                  {option.id === 'system' && <span className="theme-mode-badge">AUTO</span>}
                  <i />
                  <b />
                  <em />
                </span>
                <span className="theme-choice-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="accent-setting-row">
            <div className="accent-swatches" role="group" aria-label="强调色预设">
              {ACCENTS.map((accent) => (
                <button
                  aria-label={`${accent.label}强调色`}
                  aria-pressed={accentPreset === accent.id}
                  key={accent.id}
                  onClick={() => setAccentPreset(accent.id)}
                  style={{ '--swatch': accent.color } as CSSProperties}
                  type="button"
                >
                  <span />
                </button>
              ))}
              <button
                aria-label="自定义强调色"
                aria-pressed={accentPreset === 'custom'}
                className="is-custom"
                onClick={() => setAccentPreset('custom')}
                style={{ '--swatch': customAccentColor } as CSSProperties}
                type="button"
              >
                <span />
              </button>
            </div>
            <div className="custom-color-control">
              <span>自定义</span>
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
              <span>独立调节内容承载宽度与左侧工作台导航，不影响收起后的紧凑模式。</span>
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
                <small>用于 Worker 日志、路径与诊断数据</small>
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
