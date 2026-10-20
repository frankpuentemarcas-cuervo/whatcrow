import { describe, expect, it } from 'vitest';
import { planMerge, type CardRef } from './merge';

const ref = (id: number, chatJid: string): CardRef => ({ id, chatJid });

describe('planMerge (ui-spec §5.4)', () => {
  const never = (): boolean => false;

  it('conserva las tarjetas que siguen en el snapshot', () => {
    expect(planMerge([ref(1, 'a'), ref(2, 'b')], [ref(1, 'a'), ref(2, 'b')], never, never)).toEqual([
      { type: 'keep', id: 1 },
      { type: 'keep', id: 2 },
    ]);
  });

  it('elimina las que ya no están', () => {
    expect(planMerge([ref(1, 'a')], [], never, never)).toEqual([{ type: 'remove', id: 1 }]);
  });

  it('reemplaza el id del mismo chat cuando no hay edición', () => {
    expect(planMerge([ref(146, 'a')], [ref(160, 'a')], never, never)).toEqual([
      { type: 'replace', oldId: 146, id: 160 },
    ]);
  });

  it('marca conflicto si la tarjeta se está editando', () => {
    expect(planMerge([ref(146, 'a')], [ref(160, 'a')], (id) => id === 146, never)).toEqual([
      { type: 'conflict', oldId: 146, id: 160 },
    ]);
  });

  it('marca conflicto si hay cambios sin guardar aunque el foco esté afuera', () => {
    expect(planMerge([ref(146, 'a')], [ref(160, 'a')], never, (id) => id === 146)).toEqual([
      { type: 'conflict', oldId: 146, id: 160 },
    ]);
  });

  it('agrega una sugerencia de un chat nuevo', () => {
    expect(planMerge([ref(1, 'a')], [ref(1, 'a'), ref(2, 'b')], never, never)).toEqual([
      { type: 'keep', id: 1 },
      { type: 'add', id: 2 },
    ]);
  });
});
