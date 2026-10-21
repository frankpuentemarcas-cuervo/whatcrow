import { describe, expect, it, vi } from 'vitest';
import { createCoalescedTask } from '../../src/logic/coalesced-task';

describe('createCoalescedTask', () => {
  it('runs one follow-up after requests arrive during an active task', async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const task = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const run = createCoalescedTask(task);

    const active = run();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    const queuedA = run();
    const queuedB = run();
    expect(task).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([active, queuedA, queuedB]);
    expect(task).toHaveBeenCalledTimes(2);

    await run();
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('runs a queued follow-up after failure and then reports the original error', async () => {
    const expected = new Error('first poll failed');
    let rejectFirst!: () => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = () => reject(expected);
    });
    const task = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const run = createCoalescedTask(task);

    const active = run();
    await Promise.resolve();
    const queued = run();
    rejectFirst();

    await expect(active).rejects.toBe(expected);
    await expect(queued).rejects.toBe(expected);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not drop a request arriving between task completion and finalization', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const run = createCoalescedTask(task);

    const active = run();
    await Promise.resolve(); // task has started and its await continuation is registered
    const arrivingAtBoundary = first.then(() => run());
    release();

    await Promise.all([active, arrivingAtBoundary]);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('allows a fresh run after a rejected operation settles', async () => {
    const expected = new Error('poll failed');
    const task = vi.fn().mockRejectedValueOnce(expected).mockResolvedValue(undefined);
    const run = createCoalescedTask(task);

    await expect(run()).rejects.toBe(expected);
    await expect(run()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(2);
  });
});
