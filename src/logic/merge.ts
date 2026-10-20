export interface CardRef {
  id: number;
  chatJid: string;
}

export type MergeDecision =
  | { type: 'keep'; id: number }
  | { type: 'replace'; oldId: number; id: number }
  | { type: 'conflict'; oldId: number; id: number }
  | { type: 'add'; id: number }
  | { type: 'remove'; id: number };

/**
 * Decide qué hacer con las tarjetas al llegar un snapshot nuevo.
 *
 * El backend mantiene una sola sugerencia `pending` por chat: si aparece un
 * id nuevo para el mismo `chatJid`, la anterior fue reemplazada. Pero si el
 * usuario está editando (o tiene cambios sin guardar), no se pisa: se marca
 * como conflicto para que él elija (ui-spec §5.4).
 */
export function planMerge(
  previous: CardRef[],
  incoming: CardRef[],
  isEditing: (id: number) => boolean,
  isDirty: (id: number) => boolean,
): MergeDecision[] {
  const incomingIds = new Set(incoming.map((item) => item.id));
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const matchedOldIds = new Set<number>();
  const decisions: MergeDecision[] = [];

  for (const item of incoming) {
    if (previousById.has(item.id)) {
      decisions.push({ type: 'keep', id: item.id });
      continue;
    }
    const old = previous.find(
      (candidate) =>
        candidate.chatJid === item.chatJid &&
        !incomingIds.has(candidate.id) &&
        !matchedOldIds.has(candidate.id),
    );
    if (old) {
      matchedOldIds.add(old.id);
      const blocked = isEditing(old.id) || isDirty(old.id);
      decisions.push({ type: blocked ? 'conflict' : 'replace', oldId: old.id, id: item.id });
    } else {
      decisions.push({ type: 'add', id: item.id });
    }
  }

  for (const item of previous) {
    if (!incomingIds.has(item.id) && !matchedOldIds.has(item.id)) {
      decisions.push({ type: 'remove', id: item.id });
    }
  }

  return decisions;
}
