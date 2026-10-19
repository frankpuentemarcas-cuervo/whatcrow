export const PAUSE_AFTER_MS = 10_000;

/** ui-spec: con datos de más de 10 s se pausan Enviar, Programar, Reintentar y Descartar. */
export function isPaused(lastOkAt: number | null, now: number): boolean {
  return lastOkAt === null || now - lastOkAt > PAUSE_AFTER_MS;
}
