import { Check } from 'lucide-react';
import type { TaskSnapshot } from '../../contracts/desktop';
import { taskProcessStates } from '../../state/taskMonitor';
import { formatTaskStage } from '../../state/taskStage';
export function TaskProcessChain({ task }: { task: TaskSnapshot }) {
  return (
    <section className="task-process-monitor" aria-labelledby="task-process-title">
      <header>
        <div>
          <p className="step-label">PROCESS</p>
          <h3 id="task-process-title">当前任务处理链路</h3>
        </div>
        <span>{formatTaskStage(task.stage)}</span>
      </header>
      <ol>
        {taskProcessStates(task).map((step) => (
          <li className={`is-${step.state}`} key={step.label}>
            <span>{step.state === 'complete' ? <Check size={14} /> : <i />}</span>
            <strong>{step.label}</strong>
            {step.state !== 'complete' && <small>{step.detail}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}
