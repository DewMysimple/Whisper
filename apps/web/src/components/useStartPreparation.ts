import { useWorkspace } from '../state/workspace';

export function useStartPreparation() {
  const preparation = useWorkspace((state) => state.startPreparation);
  const cancel = useWorkspace((state) => state.cancelStartPreparation);
  const label =
    preparation?.phase === 'cancelling'
      ? '取消准备中'
      : preparation?.phase === 'loading'
        ? '加载模型中'
        : '正在检查启动条件';
  return {
    label,
    canCancel: preparation?.canCancel === true,
    cancelling: preparation?.phase === 'cancelling',
    cancel:
      preparation?.canCancel && preparation.phase !== 'cancelling'
        ? () => void cancel()
        : undefined,
  };
}
