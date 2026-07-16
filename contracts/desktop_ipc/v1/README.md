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

`transcription.start` carries an `InputSource[]`, a base preset plus validated overrides, and an explicit compatibility/custom output policy. The Worker freezes and executes this structure; the existing CLI continues to accept one physical input argument.

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
- Unknown methods produce `protocol.unknown_method`.
- Unsupported versions produce `protocol.unsupported_version`.
- The retained CLI JSONL shape with `type: progress` is not a v1 desktop IPC message. Its PyQt5 consumer was retired in batch 7; the CLI channel remains available independently.
