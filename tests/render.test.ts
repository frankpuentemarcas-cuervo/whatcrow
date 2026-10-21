import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { Renderer, type AppViewState } from '../src/render';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function view(overrides: Partial<AppViewState> = {}): AppViewState {
  return {
    cards: [],
    learningRules: [],
    reviewingLearningRuleIds: new Set(),
    scheduled: [],
    failed: [],
    retries: new Map(),
    health: null,
    readAt: null,
    lastOkAt: null,
    now: 2_000_000,
    paused: false,
    dbMissing: false,
    loadError: null,
    loading: false,
    busy: false,
    tab: 'learning',
    filter: 'all',
    selectedId: null,
    counterMode: false,
    toast: null,
    settings: {
      open: false,
      dbPath: 'C:/tmp/wa.sqlite',
      dbMessage: null,
      autostart: false,
      theme: 'light',
      version: '0.1.3',
      lastSearch: null,
      update: { state: 'idle' },
    },
    dbPath: 'C:/tmp/wa.sqlite',
    mode: { width: 'list-detail', height: 'medium' },
    ...overrides,
  };
}

function createRenderer(): { renderer: Renderer; document: Document } {
  const document = new JSDOM(html).window.document;
  return { renderer: new Renderer(document), document };
}

const staleFailed = {
  id: 4,
  chatJid: 'chat@example',
  chatName: 'Chat de la base anterior',
  text: 'texto antiguo',
  status: 'failed',
  error: 'error antiguo',
  sendAt: null,
  createdAt: 1,
  failedAt: 2,
  suggestionId: null,
};

describe('Renderer learning tab', () => {
  it('clears outbox details while a new snapshot is loading or the database is missing', () => {
    const { renderer, document } = createRenderer();
    renderer.render(view({ failed: [staleFailed] }));
    expect(document.getElementById('colSide')?.textContent).toContain('Chat de la base anterior');

    renderer.render(view({ loading: true, failed: [staleFailed] }));
    expect(document.getElementById('colList')?.textContent).toContain('Cargando');
    expect(document.getElementById('colDetail')?.textContent).toBe('');
    expect(document.getElementById('colSide')?.textContent).not.toContain('Chat de la base anterior');

    renderer.render(view({ dbMissing: true, failed: [staleFailed] }));
    expect(document.getElementById('colList')?.textContent).not.toContain('Chat de la base anterior');
    expect(document.getElementById('colSide')?.textContent).not.toContain('Chat de la base anterior');
  });

  it('disables approve and reject while a candidate review is in flight', () => {
    const { renderer, document } = createRenderer();
    const id = 12;
    const state = view({
      learningRules: [{
        id,
        sourceSuggestionId: 81,
        chatJid: 'chat@example',
        scope: 'contact',
        ruleText: 'Mantener respuestas breves.',
        rationale: 'El usuario acortó el borrador.',
        createdAt: 10,
        updatedAt: 10,
      }],
    });
    state.reviewingLearningRuleIds.add(id);

    renderer.render(state);

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`button[data-rule-id="${id}"]`));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it('exposes review progress through the polite live region', () => {
    const { renderer, document } = createRenderer();

    renderer.announce('Aprobando candidata de aprendizaje #12.');

    expect(document.getElementById('live')?.getAttribute('aria-live')).toBe('polite');
    expect(document.getElementById('live')?.textContent).toBe('Aprobando candidata de aprendizaje #12.');
  });
});
