import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('confirmation dialog lifecycle', () => {
  it('keeps keyboard focus when progress refreshes recreate callbacks', () => {
    const confirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        title="终止任务"
        description="第一次进度"
        confirmLabel="确认"
        onCancel={() => undefined}
        onConfirm={confirm}
      />,
    );
    const button = screen.getByRole('button', { name: '确认' });
    button.focus();
    rerender(
      <ConfirmDialog
        open
        title="终止任务"
        description="新的进度"
        confirmLabel="确认"
        onCancel={() => undefined}
        onConfirm={confirm}
      />,
    );
    expect(button).toHaveFocus();
  });

  it('isolates nested backdrop clicks and Escape from the parent dialog', () => {
    const parent = vi.fn();
    const cancel = vi.fn();
    const dialog = (childOpen: boolean) => (
      <div onMouseDown={parent}>
        <ConfirmDialog
          open
          title="父层"
          description="父层"
          confirmLabel="父层确认"
          onCancel={parent}
          onConfirm={() => undefined}
        >
          <ConfirmDialog
            open={childOpen}
            title="子层"
            description="子层"
            confirmLabel="子层确认"
            onCancel={cancel}
            onConfirm={() => undefined}
          />
        </ConfirmDialog>
      </div>
    );
    const { rerender } = render(dialog(false));
    rerender(dialog(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
    const child = screen.getByRole('dialog', { name: '子层' });
    fireEvent.mouseDown(child.parentElement!);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(parent).not.toHaveBeenCalled();
  });
});
