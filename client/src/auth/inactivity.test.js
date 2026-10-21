import { INACTIVITY_LOCK_MS, markActive, readLastActive, idleTooLong, watchInactivity } from './inactivity';

beforeEach(() => {
  localStorage.clear();
  jest.useRealTimers();
});

describe('inactivity lock', () => {
  it('is not idle with no activity recorded yet', () => {
    expect(idleTooLong()).toBe(false);
  });

  it('is idle once 30 minutes pass after the last activity', () => {
    const t = 1_000_000_000;
    markActive(t, { force: true });
    expect(readLastActive()).toBe(t);
    expect(idleTooLong(t + INACTIVITY_LOCK_MS - 1)).toBe(false);
    expect(idleTooLong(t + INACTIVITY_LOCK_MS)).toBe(true);
  });

  it('calls onIdle when nothing happens for the limit, and a tap resets the clock', () => {
    jest.useFakeTimers();
    jest.setSystemTime(2_000_000_000);
    const onIdle = jest.fn();
    const stop = watchInactivity(onIdle, { limitMs: 60_000, checkEveryMs: 10_000 });

    jest.advanceTimersByTime(50_000);
    window.dispatchEvent(new Event('pointerdown'));
    jest.advanceTimersByTime(50_000);
    expect(onIdle).not.toHaveBeenCalled();

    jest.advanceTimersByTime(20_000);
    expect(onIdle).toHaveBeenCalled();
    stop();
  });
});
