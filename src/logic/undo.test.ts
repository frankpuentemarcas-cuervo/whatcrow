import { describe, expect, it, vi } from 'vitest';
import { UndoQueue, UNDO_MS } from './undo';

describe('UndoQueue', () => {
  it('confirma a los 5 s salvo que se cancele', () => {
    vi.useFakeTimers();
    const q = new UndoQueue();
    const a = vi.fn(); const b = vi.fn();
    q.start('1', a); q.start('2', b);
    expect(q.cancel('2')).toBe(true);
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    expect(q.pending('1')).toBe(false);
    vi.useRealTimers();
  });
  it('cancelAll (cierre de ventana) no confirma nada', () => {
    vi.useFakeTimers();
    const q = new UndoQueue(); const a = vi.fn();
    q.start('1', a); q.cancelAll(); vi.advanceTimersByTime(UNDO_MS);
    expect(a).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('start dos veces con la misma clave no duplica', () => {
    vi.useFakeTimers();
    const q = new UndoQueue(); const a = vi.fn();
    q.start('1', a); q.start('1', a); vi.advanceTimersByTime(UNDO_MS);
    expect(a).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
