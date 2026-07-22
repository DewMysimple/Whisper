import {
  Check,
  Cpu,
  FolderOpen,
  Gauge,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useEffect } from 'react';

import type { ModelId } from '../contracts/desktop';
import { MODEL_PRESENTATIONS } from '../data/models';
import { useWorkspace } from '../state/workspace';
import { HardwareOptimizationPanel } from './HardwareOptimizationPanel';

function formatBytes(value: number | null): string {
  if (value === null) return '未安装';
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function ModelSwitchView() {
  const localModels = useWorkspace((state) => state.localModels);
  const selectedModelId = useWorkspace((state) => state.selectedModelId);
  const pendingModelId = useWorkspace((state) => state.pendingModelId);
  const model = useWorkspace((state) => state.model);
  const modelsLoading = useWorkspace((state) => state.modelsLoading);
  const modelSwitching = useWorkspace((state) => state.modelSwitching);
  const tasks = useWorkspace((state) => state.tasks);
  const refreshModels = useWorkspace((state) => state.refreshModels);
  const openModelDirectory = useWorkspace((state) => state.openModelDirectory);
  const selectModel = useWorkspace((state) => state.selectModel);
  const busy = tasks.some((task) => task.status === 'queued' || task.status === 'running');
  const installedCount = localModels.filter((item) => item.installed).length;
  const loadedLabel = model.modelId ? MODEL_PRESENTATIONS[model.modelId].label : '尚未加载';
  const selectedLabel = MODEL_PRESENTATIONS[selectedModelId].label;

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  return (
    <div className="model-workspace">
      <section className="model-console" aria-labelledby="model-console-title">
        <div className="model-console-mark" aria-hidden="true">
          <Cpu size={28} />
        </div>
        <div className="model-console-copy">
          <p className="step-label">LOCAL INFERENCE BAY</p>
          <h2 id="model-console-title">当前推理模型</h2>
          <p>模型只从本机读取；运行中的任务不会被切换操作中断。</p>
        </div>
        <dl className="model-console-status">
          <div>
            <dt>Worker 已加载</dt>
            <dd>
              {model.state === 'loading' && <LoaderCircle className="spin" size={16} />}
              {loadedLabel}
            </dd>
            <small>
              {model.device
                ? `${model.device.toUpperCase()} · ${model.computeType ?? '自动计算精度'}`
                : model.state === 'loading'
                  ? '正在准备本地模型'
                  : '首次任务前按需加载'}
            </small>
          </div>
          <div>
            <dt>新任务默认</dt>
            <dd>{selectedLabel}</dd>
            <small>
              {pendingModelId
                ? '当前队列结束后生效'
                : busy
                  ? '新提交任务将冻结此模型'
                  : '空闲状态，可立即预加载'}
            </small>
          </div>
          <div>
            <dt>本地库存</dt>
            <dd>{installedCount} / 6</dd>
            <small>仅识别完整 CTranslate2 模型</small>
          </div>
        </dl>
      </section>

      <section className="panel model-library" aria-labelledby="model-library-title">
        <div className="panel-heading model-library-heading">
          <div>
            <p className="step-label">OFFLINE MODEL LIBRARY</p>
            <h2 id="model-library-title">本地模型库</h2>
            <p>缺失模型不会联网下载；放入指定目录后点击刷新。</p>
          </div>
          <div className="model-library-actions">
            <button
              className="secondary-button"
              disabled={modelsLoading}
              onClick={() => void refreshModels()}
              type="button"
            >
              <RefreshCw className={modelsLoading ? 'spin' : undefined} size={16} />
              刷新模型
            </button>
            <button
              className="secondary-button"
              onClick={() => void openModelDirectory()}
              type="button"
            >
              <FolderOpen size={16} /> 打开模型目录
            </button>
          </div>
        </div>

        <div className="model-card-grid" aria-busy={modelsLoading}>
          {localModels.map((descriptor) => {
            const presentation = MODEL_PRESENTATIONS[descriptor.id];
            const selected = selectedModelId === descriptor.id;
            const loaded = model.state === 'ready' && model.modelId === descriptor.id;
            const loading = model.state === 'loading' && model.modelId === descriptor.id;
            return (
              <article
                className={`model-card ${selected ? 'is-selected' : ''} ${loaded ? 'is-loaded' : ''} ${descriptor.installed ? '' : 'is-missing'}`}
                key={descriptor.id}
              >
                <div className="model-card-topline">
                  <span>{presentation.tier}</span>
                  {descriptor.id === 'large-v3-turbo' && (
                    <em>
                      <Sparkles size={13} /> 默认
                    </em>
                  )}
                </div>
                <div className="model-card-title">
                  <div>
                    <h3>{presentation.label}</h3>
                    <code>{descriptor.id}</code>
                  </div>
                  <span
                    className={`model-install-dot ${descriptor.installed ? '' : 'is-missing'}`}
                  />
                </div>
                <p>{presentation.summary}</p>
                <dl className="model-card-metrics">
                  <div>
                    <dt>
                      <Gauge size={14} /> 相对速度
                    </dt>
                    <dd>{presentation.speed}</dd>
                  </div>
                  <div>
                    <dt>
                      <Sparkles size={14} /> 识别定位
                    </dt>
                    <dd>{presentation.accuracy}</dd>
                  </div>
                  <div>
                    <dt>
                      <HardDrive size={14} /> 本地占用
                    </dt>
                    <dd>{formatBytes(descriptor.sizeBytes)}</dd>
                  </div>
                </dl>
                <div className="model-card-footer">
                  <span title={descriptor.path ?? descriptor.detail}>
                    {descriptor.installed ? '已完整安装' : descriptor.detail}
                  </span>
                  <button
                    aria-pressed={selected}
                    className="model-select-button"
                    disabled={!descriptor.installed || modelSwitching || loading}
                    onClick={() => void selectModel(descriptor.id as ModelId)}
                    type="button"
                  >
                    {loading ? (
                      <>
                        <LoaderCircle className="spin" size={15} /> 加载中
                      </>
                    ) : loaded && selected ? (
                      <>
                        <Check size={15} /> 当前模型
                      </>
                    ) : selected && pendingModelId === descriptor.id ? (
                      '等待生效'
                    ) : selected ? (
                      '新任务默认'
                    ) : (
                      '设为转录模型'
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <HardwareOptimizationPanel />
    </div>
  );
}
