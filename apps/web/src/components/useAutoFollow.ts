import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

const FOLLOW_RESUME_DELAY_MS = 8000;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

interface AutoFollowOptions {
  enabled: boolean;
  follow: () => void;
  targetKey: string | number | null;
}

export function useAutoFollow({ enabled, follow, targetKey }: AutoFollowOptions) {
  const followingRef = useRef(true);
  const timeoutRef = useRef<number | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  const clearResumeTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const pauseForManualActivity = useCallback(() => {
    if (!enabled) return;
    followingRef.current = false;
    clearResumeTimer();
    timeoutRef.current = window.setTimeout(() => {
      followingRef.current = true;
      timeoutRef.current = null;
      followRef.current();
    }, FOLLOW_RESUME_DELAY_MS);
  }, [clearResumeTimer, enabled]);

  useEffect(() => {
    if (!enabled) {
      followingRef.current = true;
      clearResumeTimer();
      return;
    }
    if (!followingRef.current) return;
    const frame = requestAnimationFrame(() => followRef.current());
    return () => cancelAnimationFrame(frame);
  }, [clearResumeTimer, enabled, targetKey]);

  useEffect(() => clearResumeTimer, [clearResumeTimer]);

  return {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (SCROLL_KEYS.has(event.key)) pauseForManualActivity();
    },
    onPointerDown: () => pauseForManualActivity(),
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.buttons !== 0) pauseForManualActivity();
    },
    onTouchMove: () => pauseForManualActivity(),
    onTouchStart: () => pauseForManualActivity(),
    onWheel: () => pauseForManualActivity(),
  };
}
