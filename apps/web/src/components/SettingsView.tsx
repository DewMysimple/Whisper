import { Download, Minus, Palette, Plus, RotateCcw, Type, Upload } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import {
  LOG_FONT_SIZE_RANGE,
  normalizeHexColor,
  UI_FONT_SIZE_RANGE,
  type AccentPreset,
  type MonoFontFamily,
  type UiFontFamily,
} from '../state/persistence';
import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

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

function NumberStepper({
  label,
  maximum,
  minimum,
  onChange,
  value,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onChange(value: number): void;
  value: number;
}) {
  return (
    <div className="appearance-stepper" role="group" aria-label={label}>
      <button
        aria-label={`减小${label}`}
        disabled={value <= minimum}
        onClick={() => onChange(value - 1)}
        type="button"
      >
        <Minus size={15} />
      </button>
      <output aria-live="polite">
        {value}
        <small>px</small>
      </output>
      <button
        aria-label={`增大${label}`}
        disabled={value >= maximum}
        onClick={() => onChange(value + 1)}
        type="button"
      >
        <Plus size={15} />
      </button>
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
  const logFontSize = useWorkspace((state) => state.logFontSize);
  const setLogFontSize = useWorkspace((state) => state.setLogFontSize);
  const uiFontFamily = useWorkspace((state) => state.uiFontFamily);
  const setUiFontFamily = useWorkspace((state) => state.setUiFontFamily);
  const monoFontFamily = useWorkspace((state) => state.monoFontFamily);
  const setMonoFontFamily = useWorkspace((state) => state.setMonoFontFamily);
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
      <section className="panel settings-card appearance-card">
        <div className="appearance-heading">
          <div>
            <p className="step-label">DESK APPEARANCE</p>
            <div className="heading-with-help">
              <h2>桌面外观</h2>
              <HelpTip id="theme-scope-help" label="查看外观作用范围">
                外观设置覆盖五个工作台、侧栏与顶栏，不改变任务、转录参数或输出内容。
              </HelpTip>
            </div>
          </div>
          <button
            className="secondary-button appearance-reset"
            onClick={restoreAppearanceDefaults}
            type="button"
          >
            <RotateCcw size={15} /> 恢复外观默认值
          </button>
        </div>

        <div className="appearance-preview" aria-label="当前外观实时预览">
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
              当前 UI {uiFontSize}px · 日志 {logFontSize}px
            </span>
            <div>
              <button type="button" tabIndex={-1}>
                开始本地转录
              </button>
              <code>[WORKER] ready · LOCAL IPC</code>
            </div>
          </div>
        </div>

        <div className="appearance-section">
          <div className="appearance-section-title">
            <Palette size={17} />
            <div>
              <strong>主题与强调色</strong>
              <span>背景与文字保持正式配色，强调色用于操作、焦点与状态。</span>
            </div>
          </div>
          <fieldset className="theme-choice-grid">
            <legend className="sr-only">主题</legend>
            {(
              [
                ['system', '跟随 Windows'],
                ['light', '浅色'],
                ['dark', '深色'],
              ] as const
            ).map(([value, label]) => (
              <label className={theme === value ? 'is-selected' : ''} key={value}>
                <input
                  checked={theme === value}
                  name="theme"
                  onChange={() => setTheme(value)}
                  type="radio"
                  value={value}
                />
                <span className={`theme-sample is-${value}`} aria-hidden="true">
                  <i />
                  <b />
                  <em />
                </span>
                <strong>{label}</strong>
              </label>
            ))}
          </fieldset>
          {theme === 'system' && (
            <p className="theme-choice-note">软件会跟随 Windows 的浅色或深色应用模式自动切换。</p>
          )}

          <div className="accent-setting-row">
            <div className="accent-swatches" role="group" aria-label="强调色预设">
              {ACCENTS.map((accent) => (
                <button
                  aria-label={`${accent.label}强调色`}
                  aria-pressed={accentPreset === accent.id}
                  key={accent.id}
                  onClick={() => setAccentPreset(accent.id)}
                  style={{ '--swatch': accent.color } as CSSProperties}
                  title={accent.label}
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
                title="自定义"
                type="button"
              >
                <span />
              </button>
            </div>
            <label className="custom-color-control">
              <span>自定义</span>
              <input
                aria-label="选择自定义强调色"
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  setAccentDraft(value);
                  setCustomAccentColor(value);
                }}
                type="color"
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
            </label>
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
        </div>

        <div className="appearance-section">
          <div className="appearance-section-title">
            <Type size={17} />
            <div>
              <strong>字体与字号</strong>
              <span>UI 作用于所有工作台和桌面框架；日志与等宽数据独立设置。</span>
            </div>
          </div>
          <div className="typography-setting-grid">
            <label>
              <span>UI 字体</span>
              <select
                aria-label="UI 字体"
                onChange={(event) => setUiFontFamily(event.target.value as UiFontFamily)}
                value={uiFontFamily}
              >
                {UI_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="typography-size-row">
              <span>UI 字号</span>
              <NumberStepper
                label="UI 字号"
                maximum={UI_FONT_SIZE_RANGE.maximum}
                minimum={UI_FONT_SIZE_RANGE.minimum}
                onChange={setUiFontSize}
                value={uiFontSize}
              />
            </div>
            <label>
              <span>等宽字体</span>
              <select
                aria-label="等宽字体"
                onChange={(event) => setMonoFontFamily(event.target.value as MonoFontFamily)}
                value={monoFontFamily}
              >
                {MONO_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="typography-size-row">
              <span>日志字号</span>
              <NumberStepper
                label="日志字号"
                maximum={LOG_FONT_SIZE_RANGE.maximum}
                minimum={LOG_FONT_SIZE_RANGE.minimum}
                onChange={setLogFontSize}
                value={logFontSize}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="settings-support-grid">
        <section className="panel settings-card">
          <p className="step-label">LOCAL RUNTIME</p>
          <h2>本地运行环境</h2>
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
          <div className="heading-with-help">
            <h2>便携配置</h2>
            <HelpTip id="portable-config-help" label="查看便携配置范围">
              包含外观、Preset、参数覆盖和输出策略，不包含任务历史、日志或媒体路径。
            </HelpTip>
          </div>
          <p>导出外观、Preset、参数覆盖和输出策略，不包含任务历史或日志。</p>
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
