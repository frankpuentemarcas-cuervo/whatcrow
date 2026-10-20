import { describe, expect, it } from 'vitest';
import type { SuggestionView } from '../api';
import { mergeCards, type MergeableCard } from './cards';

interface Card extends MergeableCard {
  phase: string;
}

const view = (id: number, chatJid: string, draft: string | null): SuggestionView => ({
  id,
  chatJid,
  chatName: chatJid,
  isGroup: false,
  lastMsgText: 'hola',
  draft,
  category: 'respuesta',
  note: null,
  createdAt: 1,
  updatedAt: 2,
  lastMsgAt: null,
  newer: null,
});

const card = (id: number, chatJid: string, text: string, draft: string | null, phase = 'idle'): Card => ({
  id,
  data: view(id, chatJid, draft),
  text,
  baseDraft: draft ?? '',
  replaced: null,
  phase,
});

const hooks = {
  create: (item: SuggestionView): Card => card(item.id, item.chatJid, item.draft ?? '', item.draft),
  isEditing: (): boolean => false,
  isDirty: (): boolean => false,
};

describe('mergeCards (ui-spec §5.4)', () => {
  it('actualiza la vista y sigue al borrador cuando no hay edición', () => {
    const merged = mergeCards([card(1, 'a', 'viejo', 'viejo')], [view(1, 'a', 'nuevo')], hooks, 100);
    expect(merged).toHaveLength(1);
    expect(merged[0].data.draft).toBe('nuevo');
    expect(merged[0].text).toBe('nuevo');
    expect(merged[0].baseDraft).toBe('nuevo');
  });

  it('conserva el texto editado y mueve la base al borrador nuevo', () => {
    const merged = mergeCards([card(1, 'a', 'lo mío', 'original')], [view(1, 'a', 'del agente')], hooks, 100);
    expect(merged[0].text).toBe('lo mío');
    expect(merged[0].baseDraft).toBe('del agente');
    expect(merged[0].data.draft).toBe('del agente');
  });

  it('reemplaza el id y deja el aviso de 10 s', () => {
    const replaced: Array<[number, number]> = [];
    const merged = mergeCards([card(146, 'a', 'x', 'x')], [view(160, 'a', 'nueva')], {
      ...hooks,
      onReplace: (oldId, id) => replaced.push([oldId, id]),
    }, 500);
    expect(merged.map((item) => item.id)).toEqual([160]);
    expect(merged[0].replaced).toEqual({ oldId: 146, at: 500 });
    expect(replaced).toEqual([[146, 160]]);
  });

  it('marca conflicto si la tarjeta se está editando y no la pisa', () => {
    let conflict: SuggestionView | null = null;
    const editing = card(146, 'a', 'lo mío', 'original');
    const merged = mergeCards([editing], [view(160, 'a', 'nueva')], {
      ...hooks,
      isEditing: (item) => item.id === 146,
      onConflict: (_item, item) => {
        conflict = item;
      },
    }, 500);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(146);
    expect(merged[0].text).toBe('lo mío');
    expect(conflict).not.toBeNull();
    expect((conflict as SuggestionView | null)?.id).toBe(160);
  });

  it('descarta las sugerencias que ya no están pendientes', () => {
    const merged = mergeCards([card(1, 'a', 'x', 'x'), card(2, 'b', 'y', 'y')], [view(1, 'a', 'x')], hooks, 100);
    expect(merged.map((item) => item.id)).toEqual([1]);
  });
});
