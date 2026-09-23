import { useEffect, useState } from 'react';
import { Check, Cpu, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { desktopBridge } from '../bridge';
import type { LocalModelDescriptor } from '../contracts/desktop';
import { PRESETS, getPreset } from '../data/presets';
import { getModelLabel } from '../data/models';
import { PARAMETER_GROUPS } from '../data/parameterPresentation';
import { errorMessage } from '../state/workspaceDraft';
import { useWorkspace } from '../state/workspace';
import { Button, IconButton } from './Button';
import { CardButton } from './CardButton';
import { ParameterField } from './ParameterField';
import { RoundedSelect } from './RoundedSelect';
import { SegmentedCard } from './SegmentedCard';
import './configuration.css';

function LocalModels() {
  const selectedModelId = useWorkspace((s) => s.selectedModelId);
  const selectModel = useWorkspace((s) => s.selectModel);
  const current = useWorkspace((s) => s.model);
  const [models, setModels] = useState<LocalModelDescriptor[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingModelId, setOpeningModelId] = useState<string | null>(null);
  const [pathNotice, setPathNotice] = useState('');
  async function openModelDirectory(model: LocalModelDescriptor) {
    setOpeningModelId(model.id);
    setPathNotice('');
    try {
      await desktopBridge.openModelDirectory(model.id);
      setPathNotice(
        desktopBridge.mode === 'mock'
          ? '浏览器预览无法打开资源管理器；请在桌面开发版中使用此入口。'
          : model.installed
            ? `已打开 ${model.label} 的模型目录。`
            : `已打开模型存放目录；将模型文件放入“${model.id}”子文件夹后刷新模型。`,
      );
    } catch (reason: unknown) {
      setPathNotice(`打开模型目录失败：${errorMessage(reason)}`);
    } finally {
      setOpeningModelId(null);
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void desktopBridge
      .listLocalModels()
      .then((items) => {
        if (active) setModels(items);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <section className="config-models" aria-labelledby="local-model-title">
      <header className="config-section-heading">
        <div>
          <p className="step-label">LOCAL MODELS</p>
          <h2 id="local-model-title">本地模型</h2>
          <p className="config-description">
            选择下一次任务使用的模型，启动任务时加载。未安装的模型暂不可选。
          </p>
        </div>
        <Button
          disabled={loading}
          onClick={() => {
            setPathNotice('');
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={15} />
          刷新模型
        </Button>
      </header>
      {loading && <p role="status">正在检查本地模型…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="config-model-grid">
        {models.map((model) => (
          <article
            className={`config-model ${selectedModelId === model.id ? 'is-selected' : ''}`}
            key={model.id}
          >
            <CardButton
              className="config-model-choice"
              selected={selectedModelId === model.id}
              disabled={!model.installed || loading || Boolean(error)}
              onClick={() => selectModel(model.id)}
              aria-label={`选择 ${model.label} 模型${model.installed ? '' : '，未安装'}`}
            >
              <span className="config-model-heading">
                <span className="config-model-icon" aria-hidden="true">
                  <Cpu size={19} />
                </span>
                <strong>{model.label}</strong>
                {selectedModelId === model.id && (
                  <Check className="config-model-check" size={17} aria-hidden="true" />
                )}
              </span>
              <span className="config-model-description">
                {model.id === 'large-v3-turbo'
                  ? '速度优先 · 原声转录'
                  : model.id === 'large-v3'
                    ? '精度优先 · 支持翻译为英语'
                    : '较低资源占用 · 支持翻译为英语'}
              </span>
            </CardButton>
            <div className="config-model-footer">
              <span className={`config-model-status ${model.installed ? 'is-available' : ''}`}>
                <span aria-hidden="true" />
                {model.installed ? '本地可用' : '未安装'}
              </span>
              {model.sizeBytes && (
                <span className="config-model-size">
                  {(model.sizeBytes / 1024 ** 3).toFixed(2)} GB
                </span>
              )}
              <IconButton
                className="config-model-folder"
                label={`打开 ${model.label} 模型目录`}
                title={model.installed ? '打开模型所在文件夹' : '打开模型存放目录'}
                disabled={openingModelId !== null}
                onClick={() => void openModelDirectory(model)}
              >
                <FolderOpen size={17} />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
      {pathNotice && (
        <p className="config-description config-path-notice" role="status">
          {pathNotice}
        </p>
      )}
      <p className="config-description config-note">
        {current.state === 'ready' && current.modelId
          ? `当前驻留：${getModelLabel(current.modelId)}。`
          : '当前没有驻留模型。'}{' '}
        切换不会改动正在执行或已经排队的任务。
      </p>
    </section>
  );
}

export function ConfigurationView() {
  const tab = useWorkspace((s) => s.configurationTab);
  const openConfiguration = useWorkspace((s) => s.openConfiguration);
  const modelId = useWorkspace((s) => s.selectedModelId);
  const presetId = useWorkspace((s) => s.selectedPresetId);
  const profileMode = useWorkspace((s) => s.profileMode);
  const selectProfile = useWorkspace((s) => s.selectProfile);
  const reset = useWorkspace((s) => s.resetParameter);
  const customCount = useWorkspace((s) => Object.keys(s.overrides).length);
  return (
    <div className="configuration-view">
      <section className="config-workbench insight-card">
        <nav className="config-tabs" aria-label="模型与参数功能">
          <SegmentedCard
            label="模型切换"
            value={getModelLabel(modelId)}
            description="下一任务使用的本地模型"
            selected={tab === 'models'}
            onClick={() => openConfiguration('models')}
          />
          <SegmentedCard
            label="参数调节"
            value={customCount ? `${customCount} 项自定义` : '默认参数'}
            description={`${getPreset(presetId).label} · 修改后自动保存`}
            selected={tab === 'parameters'}
            onClick={() => openConfiguration('parameters')}
          />
        </nav>
        {tab === 'models' ? (
          <LocalModels />
        ) : (
          <div className="config-parameter-toolbar">
            <div className="config-profile-select">
              <span>当前识别模式</span>
              <RoundedSelect
                label="参数所属识别模式"
                value={presetId}
                onChange={(value) => selectProfile(profileMode, value)}
                options={PRESETS.map((preset) => ({ id: preset.id, label: preset.label }))}
              />
            </div>
            <p className="config-description">
              修改后移出输入框即保存；“恢复默认”重新采用当前模型的校准值。
            </p>
            <Button disabled={customCount === 0} onClick={() => reset()}>
              <RotateCcw size={15} />
              恢复当前配置默认值
            </Button>
          </div>
        )}
      </section>
      {tab === 'parameters' && (
        <>
          {PARAMETER_GROUPS.map((group) => (
            <section
              className="config-section insight-card"
              key={group.title}
              aria-label={group.title}
            >
              <header className="config-section-heading">
                <div>
                  <p className="step-label">INFERENCE PARAMETERS</p>
                  <h2>{group.title}</h2>
                  <p className="config-description">{group.description}</p>
                </div>
                <span className="config-section-count">{group.keys.length} 项参数</span>
              </header>
              <div className="config-parameter-grid">
                {group.keys.map((name) => (
                  <ParameterField key={`${modelId}:${presetId}:${name}`} name={name} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
