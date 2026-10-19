export const UNDO_MS = 5_000;

type SetT = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
type ClearT = (t: ReturnType<typeof setTimeout>) => void;

/** Enviar y Descartar esperan 5 s antes de escribir en la base; cerrar la ventana cancela todo. */
export class UndoQueue {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly setTimer: SetT = setTimeout, private readonly clearTimer: ClearT = clearTimeout) {}

  start(key: string, commit: () => void): void {
    if (this.timers.has(key)) return;
    this.timers.set(key, this.setTimer(() => { this.timers.delete(key); commit(); }, UNDO_MS));
  }

  cancel(key: string): boolean {
    const t = this.timers.get(key);
    if (t === undefined) return false;
    this.clearTimer(t);
    this.timers.delete(key);
    return true;
  }

  cancelAll(): void { for (const key of [...this.timers.keys()]) this.cancel(key); }

  pending(key: string): boolean { return this.timers.has(key); }
}
