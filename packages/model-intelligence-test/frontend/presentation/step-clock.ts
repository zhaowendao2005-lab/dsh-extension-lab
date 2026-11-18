import React from '../runtime';

// Read-only presentation clock: share one timer among visible, actively growing rows.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let now: number | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 125);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
      now = null;
    }
  };
}

const getSnapshot = () => now;
const inactive = () => null;
const subscribeInactive = () => () => {};

export function useStepClock(active: boolean): number | null {
  return React.useSyncExternalStore(active ? subscribe : subscribeInactive, active ? getSnapshot : inactive, inactive);
}
