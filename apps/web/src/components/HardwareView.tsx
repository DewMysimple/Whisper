import { useEffect, useState } from 'react';
import { Cpu, Gauge, MonitorCog, RefreshCw, RotateCcw } from 'lucide-react';
import { desktopBridge } from '../bridge';
import type { ExecutionOptions, HardwareCapabilities } from '../contracts/desktop';
import { EXECUTION_RULES, executionDevice, executionProblem } from '../state/executionOptions';
import { formatResolvedHardware } from '../state/hardware';
import { errorMessage } from '../state/workspaceDraft';
import { useWorkspace } from '../state/workspace';
import { Button } from './Button';
import { SegmentedCard } from './SegmentedCard';
import { SummaryText } from './SummaryText';
import './hardware-optimization.css';

const SCHEMES = [
  { id: 'auto', label: 'AUTO', title: '自动选择', description: '沿用默认设备与精度' },
  { id: 'gpu', label: 'GPU', title: 'GPU 加速', description: 'CUDA · 优先半精度' },
  { id: 'compact', label: 'VRAM', title: '节省显存', description: 'CUDA · INT8 混合精度' },
  { id: 'cpu', label: 'CPU', title: 'CPU 推理', description: 'CPU · INT8 量化' },
] as const;

function ThreadControl({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange(value: number | undefined): void;
}) {
  const [text, setText] = useState(String(value ?? 4));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const number = Number(text);
    const valid =
      text.trim() !== '' &&
      Number.isInteger(number) &&
      number >= 1 &&
      number <= (EXECUTION_RULES.cpu_threads.maximum ?? 256);
    setInvalid(!valid);
    if (valid) onChange(number);
  };
  return (
    <div className="optimization-thread-controls">
      <select
        aria-label="CPU 线程策略"
        value={value === undefined ? 'default' : value === 0 ? 'auto' : 'manual'}
        onChange={(event) => {
          setInvalid(false);
          onChange(
            event.target.value === 'default' ? undefined : event.target.value === 'auto' ? 0 : 4,
          );
        }}
      >
        <option value="default">沿用默认</option>
        <option value="auto">运行时自动</option>
        <option value="manual">手动指定</option>
      </select>
      {value !== undefined && value > 0 && (
        <input
          aria-label="CPU 推理线程数"
          inputMode="numeric"
          value={text}
          aria-invalid={invalid}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      )}
      {invalid && (
        <p role="alert">请输入 1–{EXECUTION_RULES.cpu_threads.maximum} 的整数，尚未应用。</p>
      )}
    </div>
  );
}

export function HardwareView() {
  const options = useWorkspace((state) => state.executionOptions);
  const setOptions = useWorkspace((state) => state.setExecutionOptions);
  const model = useWorkspace((state) => state.model);
  const host = useWorkspace((state) => state.hostStatus);
  const setView = useWorkspace((state) => state.setActiveView);
  const [capabilities, setCapabilities] = useState<HardwareCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    desktopBridge
      .getHardwareCapabilities()
      .then((value) => {
        if (!cancelled) {
          setCapabilities(value);
          setError(null);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setCapabilities(null);
          setError(errorMessage(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [revision, host.pid]);

  const selectedDevice = capabilities ? executionDevice(options, capabilities) : undefined;
  const gpuDevices = capabilities?.devices.filter((item) => item.device === 'cuda') ?? [];
  const problem = capabilities ? executionProblem(options, capabilities) : null;
  const computeType = options.compute_type ?? 'auto';
  const apply = (next: ExecutionOptions) => {
    setOptions(next);
    setNotice('设置已保存，将在下一次提交任务时使用。');
  };
  const setDevice = (device: ExecutionOptions['device']) =>
    apply({ ...options, device, device_index: 0, compute_type: 'auto' });
  const schemeOptions = (id: (typeof SCHEMES)[number]['id']): ExecutionOptions | null => {
    if (id === 'auto') return {};
    const device =
      id === 'cpu' ? capabilities?.devices.find((item) => item.device === 'cpu') : gpuDevices[0];
    if (!device) return null;
    const preferred =
      id === 'compact'
        ? ['int8_float16', 'int8_float32', 'int8']
        : id === 'cpu'
          ? ['int8', 'int8_float32']
          : ['float16', 'float32'];
    const precision = preferred.find((item) => device.computeTypes.includes(item));
    if (!precision) return null;
    return {
      device: device.device,
      device_index: device.deviceIndex,
      compute_type: precision as ExecutionOptions['compute_type'],
    };
  };
  const currentHardware =
    model.state === 'ready' && model.device && model.computeType && model.cpuThreads !== null
      ? formatResolvedHardware({
          device: model.device === 'cuda' ? 'cuda' : 'cpu',
          deviceIndex: model.deviceIndex ?? 0,
          computeType: model.computeType,
          cpuThreads: model.cpuThreads,
        })
      : '尚未加载模型';

  return (
    <div className="optimization-view">
      <section className="optimization-panel" aria-label="硬件执行方案">
        <div className="optimization-schemes">
          {SCHEMES.map((scheme) => {
            const next = schemeOptions(scheme.id);
            const selected = next !== null && JSON.stringify(options) === JSON.stringify(next);
            return (
              <SegmentedCard
                key={scheme.id}
                label={scheme.label}
                value={scheme.title}
                description={next || loading ? scheme.description : '当前设备不支持'}
                selected={selected}
                disabled={loading || next === null}
                onClick={() => {
                  if (next) apply(next);
                }}
              />
            );
          })}
        </div>
        <div className="optimization-toolbar">
          <p>选择适合当前任务的计算方式。设置自动保存，运行中与排队任务保持原配置。</p>
          <Button
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            <RefreshCw size={15} />
            重新检测
          </Button>
        </div>
        <div className="optimization-summary">
          <SummaryText
            label="能力来源"
            value={desktopBridge.mode === 'mock' ? '演示硬件' : '本机硬件'}
            description={loading ? '正在检测…' : error ? '检测失败' : '设备与可用精度已检测'}
          />
          <SummaryText
            label="下一任务设备"
            value={selectedDevice?.name ?? '等待检测'}
            description={
              options.device === 'cpu'
                ? 'CPU 推理'
                : options.device === 'cuda'
                  ? `CUDA ${options.device_index ?? 0}`
                  : '自动选择'
            }
          />
          <SummaryText
            label="CPU 逻辑处理器"
            value={capabilities ? `${capabilities.cpuThreads} 个` : '—'}
            description="线程数并非越多越快"
          />
          <SummaryText
            label="当前已加载配置"
            value={currentHardware}
            description="修改设置后，下一任务按需重载模型"
          />
        </div>
        {error && (
          <p className="optimization-message is-error" role="alert">
            {error}
          </p>
        )}
        {problem && (
          <p className="optimization-message is-error" role="alert">
            {problem}
          </p>
        )}
        {notice && (
          <p className="optimization-message" role="status">
            {notice}
          </p>
        )}
      </section>

      <div className="optimization-settings">
        <section
          className="optimization-panel optimization-section"
          aria-labelledby="optimization-device-title"
        >
          <header className="compact-heading">
            <div>
              <p className="step-label">DEVICE & PRECISION</p>
              <h3 id="optimization-device-title">设备与计算精度</h3>
            </div>
            <MonitorCog size={21} />
          </header>
          <label className="optimization-field">
            <span>执行设备</span>
            <select
              aria-label="执行设备"
              value={options.device ?? 'auto'}
              disabled={!capabilities || loading}
              onChange={(event) => setDevice(event.target.value as ExecutionOptions['device'])}
            >
              <option value="auto">自动选择</option>
              <option value="cuda" disabled={gpuDevices.length === 0}>
                NVIDIA GPU / CUDA
              </option>
              <option value="cpu">CPU</option>
            </select>
            <small>自动模式优先使用可用的 CUDA GPU；无 GPU 时使用 CPU。</small>
          </label>
          <label className="optimization-field">
            <span>GPU 设备</span>
            <select
              aria-label="GPU 设备"
              value={options.device_index ?? 0}
              disabled={
                !capabilities || loading || options.device === 'cpu' || gpuDevices.length === 0
              }
              onChange={(event) =>
                apply({
                  ...options,
                  device: 'cuda',
                  device_index: Number(event.target.value),
                  compute_type: 'auto',
                })
              }
            >
              {gpuDevices.length === 0 ? (
                <option value={0}>无可用 CUDA GPU</option>
              ) : (
                gpuDevices.map((device) => (
                  <option key={device.deviceIndex} value={device.deviceIndex}>
                    GPU {device.deviceIndex} · {device.name}
                  </option>
                ))
              )}
            </select>
            <small>一次任务使用一张 GPU，按设备编号选择。</small>
          </label>
          <label className="optimization-field">
            <span>计算精度</span>
            <select
              aria-label="计算精度"
              value={computeType}
              disabled={!selectedDevice || loading}
              onChange={(event) =>
                apply({
                  ...options,
                  compute_type: event.target.value as ExecutionOptions['compute_type'],
                })
              }
            >
              <option value="auto">自动选择</option>
              {EXECUTION_RULES.compute_type.enum
                ?.filter((value) => value !== 'auto')
                .map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={!selectedDevice?.computeTypes.includes(value)}
                  >
                    {value.toUpperCase()}
                    {!selectedDevice?.computeTypes.includes(value) ? ' · 当前设备不支持' : ''}
                  </option>
                ))}
            </select>
            <small>
              FP16 适用于支持半精度的 GPU；INT8 混合精度可降低内存或显存需求，识别结果可能略有差异。
            </small>
          </label>
        </section>
        <section
          className="optimization-panel optimization-section"
          aria-labelledby="optimization-cpu-title"
        >
          <header className="compact-heading">
            <div>
              <p className="step-label">CPU & EXECUTION</p>
              <h3 id="optimization-cpu-title">CPU 与执行策略</h3>
            </div>
            <Cpu size={21} />
          </header>
          <div className="optimization-field">
            <span>CPU 推理线程</span>
            <ThreadControl
              key={String(options.cpu_threads)}
              value={options.cpu_threads}
              onChange={(value) => {
                const next = { ...options };
                if (value === undefined) delete next.cpu_threads;
                else next.cpu_threads = value;
                apply(next);
              }}
            />
            <small>
              沿用默认：CPU 为 4 线程，GPU 为运行时自动。手动设置控制推理引擎的 CPU
              线程，不改变系统进程或其他应用。
            </small>
          </div>
          <div className="optimization-explanation">
            <Gauge size={20} />
            <div>
              <strong>结合性能监控调节</strong>
              <p>
                先观察 CPU、GPU
                与显存使用率，再调整设备、精度或线程。任务继续串行执行；增大线程数并不保证提速。
              </p>
              <Button onClick={() => setView('performance')}>查看性能监控</Button>
            </div>
          </div>
          <div className="optimization-footer">
            <span>默认方案保持现有识别模式和输出设置。</span>
            <Button onClick={() => apply({})}>
              <RotateCcw size={15} />
              恢复硬件默认
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
