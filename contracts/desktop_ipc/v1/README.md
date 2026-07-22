# WhisperSubtitle Desktop IPC v1

Status: `Implemented / Accepted`; batch 2 adds the runtime-only success acknowledgement described below.

Transport: one UTF-8 JSON object per line over controlled desktop stdin/stdout. Batch 2 implements this transport through `python -m whisper_subtitle worker`; stdout is protocol-only and ordinary logs use stderr.

Schema source of truth: [`desktop_ipc.schema.json`](desktop_ipc.schema.json).

## Envelope types

### Command

```json
{
  "schema_version": 1,
  "type": "command",
  "request_id": "req-001",
  "method": "system.health",
  "params": {}
}
```

### Event

```json
{
  "schema_version": 1,
  "type": "event",
  "request_id": "req-002",
  "task_id": "task-001",
  "event": "task.queued",
  "data": {
    "position": 0,
    "input_count": 1,
    "effective_parameters": {}
  },
  "message": "任务已加入队列"
}
```

### Error

```json
{
  "schema_version": 1,
  "type": "error",
  "request_id": "req-003",
  "code": "request.invalid",
  "data": {
    "field": "params.inputs"
  },
  "message": "输入列表不能为空"
}
```

`message` may be localized and must not be parsed for state. `method`, `event`, `code`, identifiers and `data` are the machine contract.

## Commands

- `system.health`
- `system.environment`
- `system.metrics`
- `model.load`
- `model.unload`
- `transcription.start`
- `transcription.cancel`
- `worker.shutdown`

### `system.metrics` result

`system.metrics` remains a read-only command with empty parameters. Its
`command.completed.data.result` always retains the original v1 fields and may
include the additive nullable telemetry fields below. Older consumers can
ignore the additions; unavailable sensors are returned as `null` rather than
invented values.

| Group | Fields |
| --- | --- |
| Existing utilization | `timestamp_ms`, `cpu_percent`, `memory_percent`, `memory_used_gib`, `memory_total_gib`, `gpu_percent`, `vram_used_gib`, `vram_total_gib`, `gpu_name` |
| CPU / system | `cpu_name`, `cpu_frequency_mhz`, `cpu_physical_cores`, `cpu_logical_cores`, `system_process_count`, `system_uptime_seconds` |
| Memory / Worker | `memory_available_gib`, `swap_used_gib`, `swap_total_gib`, `worker_rss_gib`, `worker_thread_count`, `worker_handle_count` |
| NVIDIA NVML | `gpu_memory_controller_percent`, `gpu_temperature_c`, `gpu_clock_mhz`, `gpu_memory_clock_mhz`, `gpu_power_watts`, `gpu_power_limit_watts`, `gpu_fan_percent`, `gpu_driver_version`, `gpu_performance_state` |

CPU temperature, motherboard voltage/fans, DRAM frequency/timings and shared
GPU memory are not part of v1 because the packaged runtime has no reliable,
vendor-independent source for them. `cpu_frequency_mhz` is explicitly the
frequency reported by the operating system and may differ from a momentary
Boost clock shown by vendor utilities.

`transcription.start` carries an `InputSource[]`, a base preset plus validated overrides, an explicit compatibility/custom output policy, and may include a local `model_id`. Supported task model IDs are `tiny`, `base`, `small`, `medium`, `large-v3`, and `large-v3-turbo`. The Worker freezes the model with the task and echoes it in `task.queued.data.model_id`; omitting it preserves the original `large-v3-turbo` behavior. The existing CLI continues to accept one physical input argument.

`model.load` and `transcription.start` may also include the same optional hardware preference:

```json
{
  "hardware": {
    "mode": "auto",
    "gpu_device_index": 0,
    "cuda_compute_type": "float16",
    "cpu_compute_type": "int8",
    "cpu_threads": 4
  }
}
```

`mode` is `auto`, `cuda`, or `cpu`. CUDA compute types are limited to
`float16`, `int8_float16`, and the compatibility fallback `float32`; CPU
compute types are `int8` and `float32`. The Worker resolves the preference
against CTranslate2's runtime capabilities and echoes the frozen result in
`task.queued.data.hardware`. A task keeps that model/hardware pair even when
the desktop changes defaults while it is queued or running. Omitting
`hardware` preserves the original automatic CUDA/FP16, otherwise CPU/INT8
behavior.

For output confirmation, the desktop first submits the existing Worker
`fail` conflict policy. An `output.failed` error whose data contains
`exception: "OutputConflictError"` and a non-empty `paths` array represents
the exact disk or queued-reservation conflicts. Only explicit user
confirmation causes the desktop to resubmit the same frozen draft once with
the existing `overwrite` policy. Other output errors are not treated as
overwrite confirmation.

SRT is an additive v1 output capability. Existing clients may omit `srt` and
`subtitle`; that is identical to `srt.enabled = false`. When SRT is enabled,
the request must include all subtitle layout parameters:

```json
{
  "srt": { "enabled": true, "directory": null },
  "subtitle": {
    "max_characters_per_line": 18,
    "max_lines_per_cue": 1,
    "min_cue_duration_ms": 800,
    "max_cue_duration_ms": 7000,
    "max_characters_per_second": 20,
    "cue_gap_ms": 80
  }
}
```

`preserve_source_markdown` is also an additive optional v1 field. It defaults
to `false`. In custom-root mode, `preserve_source_txt` and
`preserve_source_markdown` independently request an additional copy beside
each source media under `Text` and `Markdown` respectively. In compatibility
mode the primary outputs already use those media-adjacent folders, so no
duplicate copy is planned.

SRT requests enable faster-whisper word timestamps at execution time and use
the real word `start`/`end` values for cue boundaries. If an injected or legacy
engine does not expose word data, the Worker falls back to the real segment
`start`/`end` values. Subtitle parameters control cue splitting and layout;
they do not replace model timestamps or change the four canonical inference
Preset definitions.

## Events

- `worker.ready`
- `command.completed`
- `model.loading`
- `model.ready`
- `task.queued`
- `task.progress`
- `task.completed`
- `task.failed`
- `task.cancelled`

Task lifecycle is:

```text
task.queued
  -> task.progress*
  -> task.completed | task.failed | task.cancelled
```

Model events are Worker-level events and are not inserted into the task lifecycle sequence.

`command.completed` is the request-correlated success acknowledgement for commands
that do not naturally create a task terminal event. Its `data` contains the original
`method` and a machine-readable `result` object. It was added as a minimal v1 runtime
amendment before any Tauri consumer existed; existing command, task and error shapes
remain unchanged.

## Compatibility

- `schema_version` is the integer `1` for every v1 message.
- Unknown fields are rejected to prevent accidental silent protocol drift.
- The optional SRT fields and `preserve_source_markdown` are accepted additive
  v1 extensions; the original TXT/Markdown request shape remains valid.
- Optional `model_id`, hardware preferences, resolved task hardware and
  structured output-conflict paths are backward-compatible v1 extensions.
- Unknown methods produce `protocol.unknown_method`.
- Unsupported versions produce `protocol.unsupported_version`.
- The retained CLI JSONL shape with `type: progress` is not a v1 desktop IPC message. Its PyQt5 consumer was retired in batch 7; the CLI channel remains available independently.
