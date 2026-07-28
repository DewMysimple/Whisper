import { Check, Cpu, Gauge, Microchip, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { HardwarePreference } from '../contracts/desktop';
import { hardwarePreferenceSupported, recommendedHardwarePreference } from '../state/hardware';
import { useWorkspace } from '../state/workspace';

const CUDA_LABELS = {
  float16: 'FP16 · 推荐',
  int8_float16: 'INT8 + FP16 · 较低显存',
  float32: 'FP32 · 兼容回退',
} as const;

const CPU_LABELS = {
  int8: 'INT8 · 推荐',
  float32: 'FP32 · 兼容模式',
} as const;

export function HardwareOptimizationPanel() {
  const environment = useWorkspace((state) => state.environment);
  const selected = useWorkspace((state) => state.hardwarePreference);
  const pendingHardware = useWorkspace((state) => state.pendingHardware);
  const model = useWorkspace((state) => state.model);
  const modelSwitching = useWorkspace((state) => state.modelSwitching);
  const tasks = useWorkspace((state) => state.tasks);
  const setHardwarePreference = useWorkspace((state) => state.setHardwarePreference);
  const restoreHardwareDefaults = useWorkspace((state) => state.restoreHardwareDefaults);
  const [draft, setDraft] = useState<HardwarePreference>(selected);
  const capabilities = environment?.hardware;
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);
  const busy = tasks.some((task) => task.status === 'queued' || task.status === 'running');

  useEffect(() => setDraft(selected), [selected]);

  const activeGpu = capabilities?.gpus.find((gpu) => gpu.index === draft.gpuDeviceIndex);
  const cudaOptions = useMemo(() => {
    const supported = activeGpu?.computeTypes ?? [];
    const preferred: HardwarePreference['cudaComputeType'][] = ['float16', 'int8_float16'].filter(
      (type) => supported.includes(type),
    ) as HardwarePreference['cudaComputeType'][];
    if (preferred.length === 0 && supported.includes('float32')) preferred.push('float32');
    if (supported.includes(draft.cudaComputeType) && !preferred.includes(draft.cudaComputeType)) {
      preferred.push(draft.cudaComputeType);
    }
    return preferred;
  }, [activeGpu, draft.cudaComputeType]);
  const cpuOptions = (['int8', 'float32'] as const).filter((type) =>
    capabilities?.cpuComputeTypes.includes(type),
  );
  const maxThreads = Math.max(1, capabilities?.cpuPhysicalCores ?? 4);
  const draftSupported = hardwarePreferenceSupported(draft, capabilities);

  const patchDraft = (patch: Partial<HardwarePreference>) =>
    !busy && setDraft((current) => ({ ...current, ...patch }));

  return (
    <section className="panel hardware-optimizer" aria-labelledby="hardware-optimizer-title">
      <div className="panel-heading hardware-optimizer-heading">
        <div>
          <p className="step-label">INFERENCE RESOURCE ROUTING</p>
          <h2 id="hardware-optimizer-title">硬件优化</h2>
          <p>选择推理设备、计算精度和 CPU 线程；每个任务会冻结提交时的配置。</p>
        </div>
        <span className={`hardware-pending-chip ${pendingHardware ? 'is-pending' : ''}`}>
          {busy ? '任务执行期间已锁定' : pendingHardware ? '等待后续任务生效' : '配置已生效'}
        </span>
      </div>

      <div className="hardware-capability-strip" aria-label="本机硬件能力">
        <div>
          <Microchip size={17} />
          <span>
            <small>Worker 当前加载</small>
            <strong>
              {model.state === 'ready' && model.device
                ? `${model.device.toUpperCase()}${model.device === 'cuda' ? ` ${model.deviceIndex ?? 0}` : ''} · ${(model.computeType ?? '自动').toUpperCase()}`
                : '等待模型加载'}
            </strong>
          </span>
        </div>
        <div>
          <Cpu size={17} />
          <span>
            <small>CPU</small>
            <strong>
              {capabilities
                ? `${capabilities.cpuPhysicalCores} 核 / ${capabilities.cpuLogicalCores} 线程`
                : '正在检测'}
            </strong>
          </span>
        </div>
        <div>
          <Gauge size={17} />
          <span>
            <small>NVIDIA CUDA</small>
            <strong>
              {capabilities
                ? capabilities.gpus.length > 0
                  ? `${capabilities.gpus.length} 张可用`
                  : '未检测到'
                : '正在检测'}
            </strong>
          </span>
        </div>
      </div>

      <div
        aria-busy={modelSwitching}
        aria-disabled={busy}
        className={`hardware-control-grid ${busy ? 'is-locked' : ''}`}
        title={busy ? '任务执行期间不可更改硬件配置' : undefined}
      >
        <fieldset className="hardware-device-control">
          <legend>推理设备</legend>
          <div className="hardware-segmented-control">
            {(
              [
                ['auto', '自动'],
                ['cuda', 'NVIDIA CUDA'],
                ['cpu', 'CPU'],
              ] as const
            ).map(([mode, label]) => (
              <button
                aria-pressed={draft.mode === mode}
                disabled={
                  busy ||
                  capabilities === undefined ||
                  (mode === 'cuda' && capabilities.gpus.length === 0)
                }
                key={mode}
                onClick={() => patchDraft({ mode })}
                type="button"
              >
                {draft.mode === mode && <Check size={14} />}
                {label}
              </button>
            ))}
          </div>
          <small>自动模式优先使用 CUDA；不可用时回退到 CPU。</small>
        </fieldset>

        <label>
          <span>CUDA 设备</span>
          <select
            aria-label="CUDA 设备"
            disabled={
              capabilities === undefined ||
              capabilities.gpus.length <= 1 ||
              draft.mode === 'cpu' ||
              busy
            }
            onChange={(event) => {
              const gpuDeviceIndex = Number(event.target.value);
              const gpu = capabilities?.gpus.find((item) => item.index === gpuDeviceIndex);
              const cudaComputeType = gpu?.computeTypes.includes('float16')
                ? 'float16'
                : gpu?.computeTypes.includes('int8_float16')
                  ? 'int8_float16'
                  : 'float32';
              patchDraft({ gpuDeviceIndex, cudaComputeType });
            }}
            value={draft.gpuDeviceIndex}
          >
            {(capabilities?.gpus ?? []).map((gpu) => (
              <option key={gpu.index} value={gpu.index}>
                GPU {gpu.index} · {gpu.name}
              </option>
            ))}
          </select>
          <small>{activeGpu?.name ?? '未检测到 CUDA 设备'}</small>
        </label>

        <label>
          <span>CUDA 计算精度</span>
          <select
            aria-label="CUDA 计算精度"
            disabled={
              capabilities === undefined || draft.mode === 'cpu' || cudaOptions.length === 0 || busy
            }
            onChange={(event) =>
              patchDraft({
                cudaComputeType: event.target.value as HardwarePreference['cudaComputeType'],
              })
            }
            value={draft.cudaComputeType}
          >
            {cudaOptions.map((type) => (
              <option key={type} value={type}>
                {CUDA_LABELS[type]}
              </option>
            ))}
          </select>
          <small>INT8 + FP16 可能降低显存占用，不承诺固定速度提升。</small>
        </label>

        <label>
          <span>CPU 计算精度</span>
          <select
            aria-label="CPU 计算精度"
            disabled={busy || capabilities === undefined || draft.mode === 'cuda'}
            onChange={(event) =>
              patchDraft({
                cpuComputeType: event.target.value as HardwarePreference['cpuComputeType'],
              })
            }
            value={draft.cpuComputeType}
          >
            {cpuOptions.map((type) => (
              <option key={type} value={type}>
                {CPU_LABELS[type]}
              </option>
            ))}
          </select>
          <small>CPU 模式默认使用 INT8；FP32 更占内存。</small>
        </label>

        <label className="hardware-thread-control">
          <span>
            CPU 推理线程 <output>{draft.cpuThreads}</output>
          </span>
          <input
            aria-label="CPU 推理线程"
            disabled={busy || capabilities === undefined || draft.mode === 'cuda'}
            max={maxThreads}
            min={1}
            onChange={(event) => patchDraft({ cpuThreads: Number(event.target.value) })}
            type="range"
            value={Math.min(draft.cpuThreads, maxThreads)}
          />
          <small>上限使用本机物理核心数；默认 4 线程。</small>
        </label>
      </div>

      <div className="hardware-optimizer-actions">
        <button
          className="quiet-button"
          disabled={busy || modelSwitching || !dirty}
          onClick={() => setDraft(selected)}
          type="button"
        >
          撤销未应用修改
        </button>
        <button
          className="secondary-button"
          disabled={busy || modelSwitching || capabilities === undefined}
          onClick={() => {
            const recommended = recommendedHardwarePreference(capabilities);
            setDraft(recommended);
            void restoreHardwareDefaults();
          }}
          type="button"
        >
          <RotateCcw size={15} /> 恢复推荐配置
        </button>
        <button
          className="primary-button"
          disabled={
            busy || capabilities === undefined || modelSwitching || !dirty || !draftSupported
          }
          onClick={() => void setHardwarePreference(draft)}
          type="button"
        >
          <SlidersHorizontal size={16} /> 应用硬件设置
        </button>
      </div>
    </section>
  );
}
