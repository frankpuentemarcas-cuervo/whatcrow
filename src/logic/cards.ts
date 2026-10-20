import type { SuggestionView } from '../api';
import { planMerge, type CardRef } from './merge';

/** Campos mínimos que necesita la reconciliación de tarjetas. */
export interface MergeableCard {
  id: number;
  data: SuggestionView;
  text: string;
  baseDraft: string;
  replaced: { oldId: number; at: number } | null;
}

export interface MergeHooks<C extends MergeableCard> {
  create: (view: SuggestionView) => C;
  isEditing: (card: C) => boolean;
  isDirty: (card: C) => boolean;
  /** La tarjeta conserva su id y su texto; la vista nueva queda como conflicto. */
  onConflict?: (card: C, view: SuggestionView) => void;
  /** El id viejo se reemplazó por el nuevo (para mover la selección). */
  onReplace?: (oldId: number, newId: number) => void;
}

const refs = (cards: Array<{ id: number; data: SuggestionView }>): CardRef[] =>
  cards.map((card) => ({ id: card.id, chatJid: card.data.chatJid }));

/**
 * Aplica un snapshot de pendientes sobre las tarjetas existentes.
 *
 * Usa `planMerge` para decidir: conserva la tarjeta en edición (conflicto),
 * reemplaza la que no se está tocando y agrega las de chats nuevos. Cuando no
 * hay edición, el texto sigue al borrador del agente; si hay cambios sin
 * guardar, el texto del usuario no se pisa (ui-spec §5.4).
 */
export function mergeCards<C extends MergeableCard>(
  cards: C[],
  incoming: SuggestionView[],
  hooks: MergeHooks<C>,
  now: number,
): C[] {
  const previous = refs(cards);
  const nextRefs = incoming.map((view) => ({ id: view.id, chatJid: view.chatJid }));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const views = new Map(incoming.map((view) => [view.id, view]));

  const decisions = planMerge(
    previous,
    nextRefs,
    (id) => hooks.isEditing(byId.get(id)!),
    (id) => hooks.isDirty(byId.get(id)!),
  );

  const next: C[] = [];
  for (const decision of decisions) {
    if (decision.type === 'keep') {
      const card = byId.get(decision.id)!;
      const view = views.get(decision.id)!;
      const draft = view.draft ?? '';
      const dirty = card.text !== card.baseDraft;
      next.push({ ...card, data: view, baseDraft: draft, text: dirty ? card.text : draft });
    } else if (decision.type === 'add') {
      next.push(hooks.create(views.get(decision.id)!));
    } else if (decision.type === 'replace') {
      const card = hooks.create(views.get(decision.id)!);
      card.replaced = { oldId: decision.oldId, at: now };
      hooks.onReplace?.(decision.oldId, decision.id);
      next.push(card);
    } else if (decision.type === 'conflict') {
      const card = byId.get(decision.oldId)!;
      hooks.onConflict?.(card, views.get(decision.id)!);
      next.push(card);
    }
    // 'remove': la sugerencia ya no está pendiente y la tarjeta se descarta.
  }
  return next;
}
