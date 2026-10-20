import { describe, expect, it } from 'vitest';
import { shortcutTarget } from './target';

describe('shortcutTarget (review Codex P1)', () => {
  const visible = [1, 2];
  it('con foco en una tarjeta visible, esa', () => {
    expect(shortcutTarget({ focusedId: 2, selectedId: 1, tab: 'pending', visibleIds: visible })).toBe(2);
  });
  it('sin foco, la seleccionada si está a la vista en Pendientes', () => {
    expect(shortcutTarget({ focusedId: null, selectedId: 1, tab: 'pending', visibleIds: visible })).toBe(1);
  });
  it('nunca una tarjeta oculta por el filtro ni fuera de Pendientes', () => {
    expect(shortcutTarget({ focusedId: null, selectedId: 3, tab: 'pending', visibleIds: visible })).toBeNull();
    expect(shortcutTarget({ focusedId: null, selectedId: 1, tab: 'scheduled', visibleIds: visible })).toBeNull();
    expect(shortcutTarget({ focusedId: 3, selectedId: 1, tab: 'pending', visibleIds: visible })).toBeNull();
  });
});
