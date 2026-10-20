/** A qué tarjeta apuntan los atajos (Ctrl+Enter, P, D, C…): solo a una visible en Pendientes. */
export function shortcutTarget(opts: {
  focusedId: number | null;
  selectedId: number | null;
  tab: string;
  visibleIds: readonly number[];
}): number | null {
  if (opts.tab !== 'pending') return null;
  const id = opts.focusedId ?? opts.selectedId;
  return id !== null && opts.visibleIds.includes(id) ? id : null;
}
