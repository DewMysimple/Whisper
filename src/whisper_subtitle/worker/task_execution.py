"""Execute one frozen Worker task outside the runtime scheduler."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from ..application.transcribe import TranscriptionCancelled, TranscriptionService
from ..domain.contracts import TranscriptionRequest
from ..infrastructure.output_store import OutputConflictError
from ..protocol import ErrorCode, EventCode, EventMessage, TaskStage
from .runtime_types import WorkerCommandError
from .task import WorkerTask

if TYPE_CHECKING:
    from .runtime import WorkerRuntime

def execute_task(runtime: "WorkerRuntime", task: WorkerTask) -> None:
    task.state = "running"
    task.started_at_monotonic = time.monotonic()
    try:
        runtime._emit_progress(
            task,
            TaskStage.INPUT_VALIDATING,
            0,
            len(task.inputs),
            message="正在校验输入",
        )
        if task.cancel.is_set():
            raise TranscriptionCancelled()
        media_paths = task.media_paths
        runtime._emit_progress(
            task,
            TaskStage.INPUT_DISCOVERING,
            0,
            len(media_paths),
            message="输入展开完成",
        )
        plans = task.output_plans
        if task.cancel.is_set():
            raise TranscriptionCancelled()
        runtime._emit_progress(
            task,
            TaskStage.MODEL_LOADING,
            0,
            len(media_paths),
            message="正在准备模型",
        )
        with runtime._model_cache.acquire(
            task.model_id,
            hardware_preference=task.hardware_preference,
            request_id=task.request_id,
        ) as (engine, _hardware):
            service = TranscriptionService(
                progress=runtime._progress_adapter(task),
                cancelled=task.cancel.is_set,
            )
            success_count = 0
            failure_count = 0
            outputs: list[str] = []
            for current, (media_path, plan) in enumerate(
                zip(media_paths, plans), start=1
            ):
                if task.cancel.is_set():
                    raise TranscriptionCancelled()
                request = TranscriptionRequest(
                    media_path,
                    task.preset.id,
                    recognition_strategy=task.recognition_strategy,
                )
                try:
                    result = service.transcribe_file(
                        request,
                        engine,
                        current=current,
                        total=len(media_paths),
                        preset=task.preset,
                        output_plan=plan,
                        subtitle_options=(
                            dict(task.subtitle_options)
                            if task.subtitle_options is not None
                            else None
                        ),
                        model_id=task.model_id,
                    )
                except TranscriptionCancelled:
                    raise
                except Exception:
                    failure_count += 1
                    runtime._logger.exception("task %s failed for %s", task.task_id, media_path)
                    runtime._emit_progress(
                        task,
                        TaskStage.TRANSCRIPTION_RUNNING,
                        current,
                        len(media_paths),
                        input_path=media_path,
                        message="当前媒体处理失败，继续队列中的其他媒体",
                        media_status="failed",
                    )
                    continue
                success_count += 1
                outputs.extend(str(path) for path in plan.content_paths)
                if not result.success:
                    failure_count += 1
                    success_count -= 1
        if task.cancel.is_set():
            raise TranscriptionCancelled()
        runtime._emit_progress(
            task,
            TaskStage.TASK_FINALIZING,
            len(media_paths),
            len(media_paths),
            message="正在汇总任务结果",
        )
        task.state = "completed"
        runtime._emit(
            EventMessage(
                EventCode.TASK_COMPLETED,
                {
                    "success_count": success_count,
                    "failure_count": failure_count,
                    "outputs": list(dict.fromkeys(outputs)),
                    "skipped_media": [
                        {
                            "input_path": str(conflict.media_path),
                            "paths": [str(path) for path in conflict.paths],
                        }
                        for conflict in task.skipped_media
                    ],
                },
                task_id=task.task_id,
                message="任务完成",
            )
        )
    except TranscriptionCancelled:
        runtime._emit_cancelled(task, "shutdown" if runtime._stopping else "user")
    except WorkerCommandError as exc:
        runtime._emit_failed(task, exc.code, exc, details=exc.data)
    except OutputConflictError as exc:
        runtime._emit_failed(task, ErrorCode.OUTPUT_FAILED, exc)
    except (OSError, ValueError, TypeError) as exc:
        runtime._emit_failed(task, ErrorCode.OUTPUT_FAILED, exc)
    except Exception as exc:
        runtime._logger.exception("unhandled task failure for %s", task.task_id)
        runtime._emit_failed(task, ErrorCode.TRANSCRIPTION_FAILED, exc)
