import { useEffect, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { EditableParameters } from '../contracts/desktop';
import { PARAMETER_COPY, type ParameterKey } from '../data/parameterPresentation';
import { isParameterValue, PARAMETER_RULES } from '../state/parameterValidation';
import { useWorkspace } from '../state/workspace';
import { translationTaskSupported } from '../state/parameterProfiles';
import { IconButton } from './Button';

function inputValue(value: unknown): string {
  if (value === null) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function ParameterField({ name }: { name: ParameterKey }) {
  const value = useWorkspace((s) => s.parameters[name]);
  const customized = useWorkspace((s) => Object.hasOwn(s.overrides, name));
  const setParameter = useWorkspace((s) => s.setParameter);
  const resetParameter = useWorkspace((s) => s.resetParameter);
  const canTranslate = useWorkspace((s) =>
    translationTaskSupported(s.selectedModelId, s.selectedPresetId),
  );
  const srtEnabled = useWorkspace((s) => s.output.srtEnabled);
  const vadEnabled = useWorkspace((s) => s.parameters.vad_filter);
  const contextEnabled = useWorkspace((s) => s.parameters.condition_on_previous_text);
  const wordEnabled = useWorkspace((s) => s.parameters.word_timestamps) || srtEnabled;
  const id = useId();
  const copy = PARAMETER_COPY[name];
  const schema = PARAMETER_RULES[name];
  const rule = schema.anyOf?.[0] ?? schema;
  const [draft, setDraft] = useState(inputValue(value));
  const [error, setError] = useState('');
  const [editingEmpty, setEditingEmpty] = useState(false);
  useEffect(() => {
    setDraft(inputValue(value));
    setError('');
    setEditingEmpty(false);
  }, [value]);
  const locked = name === 'word_timestamps' && srtEnabled;
  const inactive =
    (!vadEnabled &&
      [
        'vad_threshold',
        'vad_neg_threshold',
        'min_speech_duration_ms',
        'max_speech_duration_s',
        'min_silence_duration_ms',
        'speech_pad_ms',
      ].includes(name)) ||
    (!contextEnabled && name === 'prompt_reset_on_temperature') ||
    (!wordEnabled &&
      ['prepend_punctuations', 'append_punctuations', 'hallucination_silence_threshold'].includes(
        name,
      ));
  const isText = [
    'initial_prompt',
    'hotwords',
    'prefix',
    'prepend_punctuations',
    'append_punctuations',
  ].includes(name);
  const isSequence = name === 'temperature' || name === 'suppress_tokens';
  const save = () => {
    let next: unknown = draft;
    if (isSequence) {
      const parts =
        draft.trim() === ''
          ? []
          : draft.split(/[,，]/).map((part) => (part.trim() === '' ? NaN : Number(part.trim())));
      next = name === 'temperature' && parts.length === 1 ? parts[0] : parts;
    } else if (!isText && name !== 'language') next = draft.trim() === '' ? NaN : Number(draft);
    if (!isParameterValue(name, next)) {
      const hint = isSequence
        ? '请输入范围内的有效数列；温度须递增。'
        : name === 'language'
          ? '请输入模型支持的语言代码。'
          : isText
            ? '内容超过长度或包含无效字符。'
            : `请输入 ${rule.minimum}–${rule.maximum} 之间的${rule.type === 'integer' ? '整数' : '数值'}。`;
      setError(`尚未应用：${hint}`);
      return;
    }
    setError('');
    setParameter(name, next as EditableParameters[ParameterKey]);
  };
  const shared = {
    id,
    'aria-label': copy.label,
    'aria-describedby': `${id}-help`,
    'aria-invalid': Boolean(error),
  };
  return (
    <div className={`config-field ${customized ? 'is-custom' : ''}`}>
      <div className="config-field-heading">
        <label htmlFor={id}>{copy.label}</label>
        <span>{customized ? '自定义' : '默认'}</span>
        {customized && (
          <IconButton label={`恢复${copy.label}默认值`} onClick={() => resetParameter(name)}>
            <RotateCcw size={14} />
          </IconButton>
        )}
      </div>
      <code>{name}</code>
      {schema.anyOf && (
        <select
          aria-label={`${copy.label}模式`}
          value={value === null && !editingEmpty ? 'auto' : 'manual'}
          onChange={(event) => {
            if (event.target.value === 'auto') {
              setEditingEmpty(false);
              setParameter(name, null as EditableParameters[ParameterKey]);
            } else if (isText) {
              setEditingEmpty(true);
              setDraft('');
            } else {
              const initial = name === 'language' ? 'zh' : isText ? '' : (rule.minimum ?? 0);
              setParameter(name, initial as EditableParameters[ParameterKey]);
            }
          }}
        >
          <option value="auto">{copy.nullLabel ?? '自动'}</option>
          <option value="manual">手动设置</option>
        </select>
      )}
      {name === 'task' ? (
        <select
          {...shared}
          value={String(value)}
          onChange={(e) => setParameter('task', e.target.value as 'transcribe' | 'translate')}
        >
          <option value="transcribe">原声转录</option>
          <option disabled={!canTranslate} value="translate">
            翻译为英语{!canTranslate ? '（当前组合不支持）' : ''}
          </option>
        </select>
      ) : rule.type === 'boolean' ? (
        <label className="config-toggle">
          <input
            {...shared}
            checked={locked || Boolean(value)}
            disabled={locked}
            type="checkbox"
            onChange={(e) =>
              setParameter(name, e.target.checked as EditableParameters[ParameterKey])
            }
          />
          <span>{locked ? 'SRT 输出要求启用' : value ? '启用' : '关闭'}</span>
        </label>
      ) : (
        (value !== null || editingEmpty) &&
        (isText && ['initial_prompt', 'hotwords', 'prefix'].includes(name) ? (
          <textarea
            {...shared}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
          />
        ) : (
          <input
            {...shared}
            type="text"
            inputMode={!isText && name !== 'language' ? 'decimal' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                save();
                e.currentTarget.blur();
              }
            }}
          />
        ))
      )}
      <p id={`${id}-help`}>
        {copy.help}
        {inactive ? ' 当前设置下暂不参与处理，数值仍会保存。' : ''}
      </p>
      {error && (
        <p className="config-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
