import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useWorkspace } from '../state/workspace';
import { OverwriteConfirmDialog } from './OverwriteConfirmDialog';

describe('OverwriteConfirmDialog', () => {
  it('shows every real conflict path and cancellation keeps the frozen workspace draft', async () => {
    const state = useWorkspace.getState();
    useWorkspace.setState({
      inputs: [
        {
          id: 'conflict-input',
          path: 'D:\\Media\\lesson.wav',
          kind: 'file',
          origin: 'dialog',
          valid: true,
        },
      ],
      pendingOverwrite: {
        source: 'workspace',
        mode: 'overwrite',
        finishAction: 'none',
        paths: ['D:\\Text\\lesson.txt', 'D:\\Markdown\\lesson.md'],
        conflicts: [],
        mediaPaths: ['D:\\Media\\lesson.wav'],
        draft: {
          inputs: [
            {
              id: 'conflict-input',
              path: 'D:\\Media\\lesson.wav',
              kind: 'file',
              origin: 'dialog',
              valid: true,
            },
          ],
          modelId: state.selectedModelId,
          hardware: state.hardwarePreference,
          basePresetId: state.selectedPresetId,
          profileMode: state.profileMode,
          overrides: state.overrides,
          effectiveParameters: state.parameters,
          subtitleParameters: state.subtitleParameters,
          output: { ...state.output, conflictPolicy: 'confirm_overwrite' },
        },
      },
    });
    const user = userEvent.setup();
    render(<OverwriteConfirmDialog />);

    const dialog = screen.getByRole('dialog', { name: '确认覆盖同名输出文件' });
    expect(dialog).toHaveTextContent('检测到 2 个冲突目标');
    expect(dialog).toHaveTextContent('D:\\Text\\lesson.txt');
    expect(dialog).toHaveTextContent('D:\\Markdown\\lesson.md');
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(useWorkspace.getState().pendingOverwrite).toBeNull();
    expect(useWorkspace.getState().inputs).toHaveLength(1);
  });
});
