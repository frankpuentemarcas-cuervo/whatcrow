export const UNDO_MS = 5_000;

type SetT = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
type ClearT = (t: ReturnType<typeof setTimeout>) => void;

/** Enviar y Descartar esperan 5 s antes de escribir en la base; cerrar la ventana cancela todo. */
export class UndoQueue {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly setTimer: SetT = setTimeout, private readonly clearTimer: ClearT = clearTimeout) {}

  // Los timers se llaman sueltos, nunca como this.setTimer(...): en el WebView, setTimeout con un
  // this que no es window lanza "Illegal invocation" y Enviar quedaba pegado en "en 0 s".
  start(key: string, commit: () => void): void {
    if (this.timers.has(key)) return;
    const set = this.setTimer;
    this.timers.set(key, set(() => { this.timers.delete(key); commit(); }, UNDO_MS));
  }

  cancel(key: string): boolean {
    const t = this.timers.get(key);
    if (t === undefined) return false;
    const clear = this.clearTimer;
    clear(t);
    this.timers.delete(key);
    return true;
  }

  cancelAll(): void { for (const key of [...this.timers.keys()]) this.cancel(key); }

  pending(key: string): boolean { return this.timers.has(key); }
}
