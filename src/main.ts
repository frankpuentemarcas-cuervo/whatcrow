import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import * as api from './api';
import {
  Renderer,
  type AppViewState,
  type CardState,
  type Filter,
  type Tab,
  type Theme,
} from './render';
import { isPaused } from './logic/paused';
import { PRESETS, heightMode, widthMode } from './logic/layout';
import { UndoQueue } from './logic/undo';
import { formatId } from './logic/ids';
import { fromInputs, isoDate, isoTime, saleLabel, schedulePresets } from './logic/format';
import { mergeCards } from './logic/cards';

const PRESET_KEYS = ['counter', 'compact', 'normal', 'wide'] as const;
type PresetKey = (typeof PRESET_KEYS)[number];
const TABS: Tab[] = ['pending', 'sched', 'failed'];
const THEME_KEY = 'whatcrow:theme';

const appWindow = getCurrentWindow();
const renderer = new Renderer(document);
const undo = new UndoQueue();

const state: AppViewState = {
  cards: [],
  scheduled: [],
  failed: [],
  retries: new Map(),
  health: null,
  readAt: null,
  lastOkAt: null,
  now: Date.now(),
  paused: true,
  dbMissing: false,
  loadError: null,
  loading: true,
  busy: false,
  tab: 'pending',
  filter: 'all',
  selectedId: null,
  counterMode: false,
  toast: null,
  settings: {
    open: false,
    dbPath: '',
    dbMessage: null,
    autostart: null,
    theme: readTheme(),
    version: '',
    lastSearch: null,
    update: { state: 'idle' },
  },
  dbPath: '',
  mode: { width: widthMode(window.innerWidth), height: heightMode(window.innerHeight) },
};

let polling = false;
let lastRenderAt = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastUndoFn: (() => void) | null = null;
let saveSizeTimer: ReturnType<typeof setTimeout> | undefined;
let lastSize = { width: 330, height: 660 };
let pendingUpdate: Update | null = null;
let cancelDownload: (() => void) | null = null;

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Sin almacenamiento local se usa el tema del sistema.
  }
  return 'system';
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function cardById(id: number): CardState | undefined {
  return state.cards.find((card) => card.id === id);
}

function newCard(view: api.SuggestionView): CardState {
  const draft = view.draft ?? '';
  return {
    id: view.id,
    data: view,
    text: draft,
    baseDraft: draft,
    phase: 'idle',
    startedAt: null,
    error: null,
    conflict: null,
    replaced: null,
    sched: null,
    schedBusy: false,
  };
}

function isFieldFocused(id: number): boolean {
  const active = document.activeElement;
  if (!active || !active.matches('textarea, input, select')) return false;
  const host = active.closest<HTMLElement>('[data-card-id]');
  return !!host && Number(host.dataset.cardId) === id;
}

function render(): void {
  const now = Date.now();
  state.now = now;
  state.paused = isPaused(state.lastOkAt, now);
  // En tres columnas las pestañas Programados/Fallidos no existen: sus listas
  // viven en la columna lateral. Evita quedar atrapado si se llegó desde angosto.
  if (state.mode.width === 'three-col') state.tab = 'pending';
  state.busy = state.cards.some((card) => card.phase === 'sending') || state.retries.size > 0;
  lastRenderAt = now;
  renderer.render(state);
}

/** Avisos, cuentas regresivas y tiempos relativos necesitan un pulso propio. */
function tick(): void {
  const now = Date.now();
  state.now = now;
  const paused = isPaused(state.lastOkAt, now);
  if (paused !== state.paused) {
    state.paused = paused;
    render();
    return;
  }
  state.paused = paused;

  let expired = false;
  for (const card of state.cards) {
    if (card.replaced && now - card.replaced.at >= 10_000) {
      card.replaced = null;
      expired = true;
    }
  }

  // La cuenta de Reintentar se actualiza en el lugar para no reiniciar su barra.
  if (state.retries.size > 0) renderer.tickRetries(state);

  const transient = state.cards.some((card) => card.phase === 'sending' || card.phase === 'leaving');
  if (expired || transient || now - lastRenderAt >= 5_000) render();
}

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const snapshot = await api.snapshot();
    state.lastOkAt = Date.now();
    state.loading = false;
    state.dbMissing = false;
    state.loadError = null;
    applySnapshot(snapshot);
  } catch (error) {
    state.loading = false;
    const message = errorText(error);
    // El comando devuelve "no se encuentra la base en <ruta>" cuando falta el archivo.
    if (/no se encuentra la base|no encuentra la base/i.test(message)) {
      state.dbMissing = true;
      state.loadError = null;
    } else {
      state.dbMissing = false;
      state.loadError = message;
    }
  } finally {
    polling = false;
    render();
  }
}

function applySnapshot(snapshot: api.Snapshot): void {
  state.health = snapshot.health;
  state.readAt = snapshot.readAt;
  state.scheduled = snapshot.scheduled;
  state.failed = snapshot.failed;

  const before = new Set(state.cards.map((card) => card.id));
  state.cards = mergeCards(
    state.cards,
    snapshot.pending,
    {
      create: newCard,
      isEditing: (card) => card.phase === 'schedule' || isFieldFocused(card.id),
      isDirty: (card) => card.text !== card.baseDraft,
      onConflict: (card, view) => {
        card.conflict = { data: view, view: card.conflict?.view ?? false };
      },
      onReplace: (oldId, id) => {
        // Una sugerencia reemplazada ya no se puede enviar ni descartar.
        undo.cancel(`send:${oldId}`);
        undo.cancel(`dismiss:${oldId}`);
        if (state.selectedId === oldId) state.selectedId = id;
        renderer.announce(`Sugerencia actualizada: ahora es la #${id}, reemplaza a la #${oldId}.`);
      },
    },
    Date.now(),
  );

  const arrivals = state.cards.filter((card) => !before.has(card.id) && !card.replaced);
  if (arrivals.length === 1) renderer.announce(`Sugerencia nueva de ${arrivals[0].data.chatName}.`);
  if (arrivals.length > 1) renderer.announce(`${arrivals.length} sugerencias nuevas.`);

  const failedIds = new Set(snapshot.failed.map((item) => item.id));
  for (const id of [...state.retries.keys()]) {
    if (!failedIds.has(id)) state.retries.delete(id);
  }

  if (state.selectedId === null || !state.cards.some((card) => card.id === state.selectedId && card.phase !== 'gone')) {
    state.selectedId = state.cards.find((card) => card.phase !== 'gone')?.id ?? null;
  }
}

function currentCard(element: Element): CardState | undefined {
  const host = element.closest<HTMLElement>('[data-card-id]');
  return host ? cardById(Number(host.dataset.cardId)) : undefined;
}

function outboxId(element: Element): number | null {
  const host = element.closest<HTMLElement>('[data-outbox-id]');
  return host ? Number(host.dataset.outboxId) : null;
}

function visibleCards(): CardState[] {
  return state.cards.filter(
    (card) =>
      card.phase !== 'gone' &&
      card.phase !== 'leaving' &&
      (state.filter === 'all' || card.data.category === state.filter),
  );
}

function activeCard(): CardState | undefined {
  const focused = document.activeElement?.closest<HTMLElement>('[data-card-id]');
  if (focused) return cardById(Number(focused.dataset.cardId));
  return state.selectedId === null ? undefined : cardById(state.selectedId);
}

function focusCard(id: number): void {
  requestAnimationFrame(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-card-id="${id}"]`));
    const visible = candidates.find((element) => element.offsetParent !== null);
    if (!visible) return;
    visible.focus({ preventScroll: true });
    visible.scrollIntoView({ block: 'nearest' });
  });
}

function focusDraft(id: number): void {
  requestAnimationFrame(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-card-id="${id}"]`));
    // En tres columnas la tarjeta de la lista oculta su cuerpo: hay que elegir el
    // borrador que realmente está visible (el del panel de detalle).
    const draft = candidates
      .map((element) => element.querySelector<HTMLTextAreaElement>('textarea.c-draft'))
      .find((field) => field !== null && field.offsetParent !== null);
    if (!draft) {
      focusCard(id);
      return;
    }
    draft.focus();
    const end = draft.value.length;
    draft.setSelectionRange(end, end);
    draft.scrollIntoView({ block: 'nearest' });
  });
}

function selectCard(id: number): void {
  state.selectedId = id;
  state.tab = 'pending';
  render();
}

function showToast(message: string, undoAction?: () => void): void {
  state.toast = { message, hasUndo: !!undoAction };
  toastUndoFn = undoAction ?? null;
  renderer.announce(message);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    toastUndoFn = null;
    render();
  }, 5_000);
  render();
}

function hideToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = undefined;
  state.toast = null;
  toastUndoFn = null;
  render();
}

async function copyId(id: number): Promise<void> {
  const text = formatId(id);
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copiado ${text}`);
  } catch {
    showToast('No se pudo copiar. Selecciona el id y usa Ctrl+C.');
  }
}

function flashStale(id: number): void {
  for (const block of Array.from(document.querySelectorAll<HTMLElement>(`[data-card-id="${id}"] .c-stale`))) {
    block.classList.remove('flash');
    void block.offsetWidth;
    block.classList.add('flash');
  }
  renderer.announce('La sugerencia está desactualizada. Usa Control Mayúscula Enter para enviar igual.');
}

function startSend(card: CardState, allowStale = false): void {
  if (state.paused || state.dbMissing || card.phase !== 'idle') return;
  if (card.data.category !== 'respuesta' || !card.text.trim()) return;
  if (card.data.newer && !allowStale) {
    flashStale(card.id);
    return;
  }

  const text = card.text;
  card.phase = 'sending';
  card.startedAt = Date.now();
  card.error = null;
  state.selectedId = card.id;
  render();
  renderer.announce(`Se enviará a ${card.data.chatName} en 5 segundos. Escape para deshacer.`);

  // La tarjeta se resuelve por id al vencer el temporizador: `poll` reemplaza el
  // objeto en cada mezcla de snapshot, así que una referencia capturada quedaría
  // huérfana dentro de los 5 s de la cuenta regresiva.
  undo.start(`send:${card.id}`, () => {
    void commitSend(card.id, text);
  });
}

async function commitSend(id: number, text: string): Promise<void> {
  const chatName = cardById(id)?.data.chatName ?? 'el chat';
  try {
    await api.send(id, text);
    const card = cardById(id);
    if (card) {
      card.phase = 'gone';
      card.startedAt = null;
    }
    const queued = !state.health?.daemonHealthy;
    showToast(queued ? `En cola: sale cuando WhatsApp vuelva (${chatName}).` : `Enviado a ${chatName}.`);
    void poll();
  } catch (error) {
    const card = cardById(id);
    if (card) {
      card.phase = 'idle';
      card.startedAt = null;
      card.error = errorText(error);
    }
    render();
  }
}

function undoSend(card: CardState): void {
  if (!undo.cancel(`send:${card.id}`)) return;
  card.phase = 'idle';
  card.startedAt = null;
  render();
  showToast('Envío cancelado. No se envió nada.');
  focusCard(card.id);
}

function startDismiss(card: CardState): void {
  if (state.paused || state.dbMissing || card.phase !== 'idle') return;
  const id = card.id;
  card.error = null;
  card.phase = 'leaving';
  render();

  setTimeout(() => {
    const current = cardById(id);
    if (current?.phase === 'leaving') {
      current.phase = 'gone';
      render();
    }
  }, 160);

  // Igual que en el envío, la tarjeta se resuelve por id al vencer el tiempo.
  undo.start(`dismiss:${id}`, () => {
    void commitDismiss(id);
  });

  showToast(`Descartada: ${card.data.chatName}.`, () => undoTarget(id));
  renderer.announce(`Descartada: ${card.data.chatName}. Cinco segundos para deshacer.`);
}

async function commitDismiss(id: number): Promise<void> {
  try {
    await api.dismiss(id);
    const card = cardById(id);
    if (card) card.phase = 'gone';
    render();
    void poll();
  } catch (error) {
    const card = cardById(id);
    if (card) {
      card.phase = 'idle';
      card.error = errorText(error);
    }
    render();
  }
}

function undoTarget(id: number): void {
  if (!undo.cancel(`dismiss:${id}`)) return;
  const card = cardById(id);
  if (!card) return;
  card.phase = 'idle';
  render();
  showToast('Descarte cancelado.');
  focusCard(id);
}

function openSchedule(card: CardState): void {
  if (state.paused || state.dbMissing || card.data.category !== 'respuesta') return;
  const [first] = schedulePresets(Date.now());
  if (!first) return;
  card.phase = 'schedule';
  card.error = null;
  card.sched = { date: isoDate(first.at), time: isoTime(first.at), presetAt: first.at };
  state.selectedId = card.id;
  state.tab = 'pending';
  render();
  focusCard(card.id);
}

async function commitSchedule(card: CardState): Promise<void> {
  if (!card.sched) return;
  const at = fromInputs(card.sched.date, card.sched.time);
  if (at === null || at <= Date.now() || !card.text.trim()) return;

  card.schedBusy = true;
  render();
  try {
    await api.schedule(card.id, card.text, at);
    card.phase = 'gone';
    showToast(`Programado para ${saleLabel(at)}.`);
    renderer.announce(`Programado para ${saleLabel(at)}.`);
    void poll();
  } catch (error) {
    card.phase = 'idle';
    card.error = errorText(error);
  } finally {
    card.schedBusy = false;
    render();
  }
}

async function cancelScheduled(id: number): Promise<void> {
  if (state.paused || state.dbMissing) return;
  try {
    await api.cancelScheduled(id);
    showToast('Programación cancelada. La sugerencia volvió a Pendientes.');
    renderer.announce('Programación cancelada. La sugerencia volvió a Pendientes.');
    void poll();
  } catch (error) {
    showToast(errorText(error));
  }
}

function startRetry(id: number): void {
  if (state.paused || state.dbMissing || state.retries.has(id)) return;
  state.retries.set(id, Date.now());
  render();

  undo.start(`retry:${id}`, () => {
    void commitRetry(id);
  });
  renderer.announce('Se reintentará en 5 segundos. Escape para deshacer.');
}

async function commitRetry(id: number): Promise<void> {
  const item = state.failed.find((row) => row.id === id);
  try {
    await api.retry(id);
    state.retries.delete(id);
    showToast(`Reintentado: ${item?.chatName ?? 'envío'}.`);
    void poll();
  } catch (error) {
    state.retries.delete(id);
    render();
    showToast(errorText(error));
  }
}

function undoRetry(id: number): void {
  if (!undo.cancel(`retry:${id}`)) return;
  state.retries.delete(id);
  render();
  showToast('Reintento cancelado.');
}

function resolveConflict(card: CardState, useNew: boolean): void {
  const conflict = card.conflict;
  if (!conflict) return;
  const view = conflict.data;
  const oldId = card.id;

  if (useNew) card.text = view.draft ?? '';
  card.baseDraft = view.draft ?? '';
  card.id = view.id;
  card.data = view;
  card.conflict = null;
  card.replaced = { oldId, at: Date.now() };
  if (state.selectedId === oldId) state.selectedId = view.id;

  render();
  showToast(useNew ? `Usando la sugerencia nueva #${view.id}.` : `Seguís con tu texto en la #${view.id}.`);
}

function undoLast(): void {
  const sending = state.cards.find((card) => card.phase === 'sending');
  if (sending) {
    undoSend(sending);
    return;
  }
  const dismissing = state.cards.find((card) => undo.pending(`dismiss:${card.id}`));
  if (dismissing) {
    undoTarget(dismissing.id);
    return;
  }
  const retrying = [...state.retries.keys()].find((id) => undo.pending(`retry:${id}`));
  if (retrying !== undefined) {
    undoRetry(retrying);
    return;
  }
  const toastAction = toastUndoFn;
  if (toastAction) {
    hideToast();
    toastAction();
  }
}

function moveSelection(delta: number): void {
  const list = visibleCards();
  if (!list.length) return;
  const current = list.findIndex((card) => card.id === state.selectedId);
  const next = current < 0 ? 0 : Math.max(0, Math.min(list.length - 1, current + delta));
  state.selectedId = list[next].id;
  state.tab = 'pending';
  render();
  focusCard(state.selectedId);
}

function cancelTransient(): void {
  for (const card of state.cards) {
    if (card.phase === 'sending' && undo.pending(`send:${card.id}`)) {
      card.phase = 'idle';
      card.startedAt = null;
    } else if (
      (card.phase === 'leaving' || card.phase === 'gone') &&
      undo.pending(`dismiss:${card.id}`)
    ) {
      card.phase = 'idle';
    }
  }
  undo.cancelAll();
  state.retries.clear();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = undefined;
  state.toast = null;
  toastUndoFn = null;
  render();
}

async function hideWindow(): Promise<void> {
  cancelTransient();
  try {
    await appWindow.hide();
  } catch (error) {
    showToast(errorText(error));
  }
}

function setTheme(theme: Theme): void {
  state.settings.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Sin almacenamiento local el tema vale para esta sesión.
  }
  render();
}

function applyMode(width: number, height: number): void {
  const w = widthMode(width);
  const h = heightMode(height);
  state.mode = { width: w, height: h };
  for (const name of Array.from(document.body.classList)) {
    if (name.startsWith('w-') || name.startsWith('h-')) document.body.classList.remove(name);
  }
  document.body.classList.add(`w-${w}`, `h-${h}`);
  if (w === 'three-col' && state.tab !== 'pending') state.tab = 'pending';
}

function markPreset(name: PresetKey | null): void {
  for (const button of Array.from(document.querySelectorAll<HTMLElement>('.seg [data-preset]'))) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === name));
  }
}

function scheduleSaveSize(width: number, height: number): void {
  if (saveSizeTimer) clearTimeout(saveSizeTimer);
  saveSizeTimer = setTimeout(() => {
    void api.saveWindowSize(width, height).catch(() => undefined);
  }, 500);
}

async function setPreset(name: PresetKey): Promise<void> {
  const [width, height] = PRESETS[name];
  if (name === 'counter') {
    state.counterMode = true;
  } else {
    lastSize = { width, height };
    state.counterMode = false;
  }
  applyMode(width, height);
  markPreset(name === 'counter' ? null : name);
  render();
  try {
    await appWindow.setSize(new LogicalSize(width, height));
  } catch (error) {
    showToast(errorText(error));
  }
}

/** El contador vuelve al último tamaño manual, aunque no coincida con un preset. */
function matchingPreset(size: { width: number; height: number }): PresetKey | null {
  return (
    (['compact', 'normal', 'wide'] as const).find(
      (key) => PRESETS[key][0] === Math.round(size.width) && PRESETS[key][1] === Math.round(size.height),
    ) ?? null
  );
}

async function restoreLastSize(): Promise<void> {
  state.counterMode = false;
  applyMode(lastSize.width, lastSize.height);
  markPreset(matchingPreset(lastSize));
  render();
  try {
    await appWindow.setSize(new LogicalSize(lastSize.width, lastSize.height));
  } catch (error) {
    showToast(errorText(error));
  }
}

function onWindowResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  applyMode(width, height);
  if (!state.counterMode) {
    lastSize = { width, height };
    scheduleSaveSize(width, height);
  }
  render();
}

function closeSizeMenu(): void {
  const menu = document.getElementById('sizeMenu');
  const button = document.getElementById('sizeBtn');
  if (menu) menu.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}

function toggleSizeMenu(button: HTMLElement): void {
  const menu = document.getElementById('sizeMenu');
  if (!menu) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
}

async function loadSettingsInfo(): Promise<void> {
  if (!state.settings.version) {
    try {
      state.settings.version = await getVersion();
    } catch {
      // La versión se muestra como "—" si la API no responde.
    }
  }
  try {
    state.settings.autostart = await autostartEnabled();
  } catch {
    state.settings.autostart = null;
  }
  render();
}

function openSettings(): void {
  state.settings.open = true;
  if (!state.settings.dbPath && state.dbPath) state.settings.dbPath = state.dbPath;
  render();
  void loadSettingsInfo();
}

function closeSettings(): void {
  state.settings.open = false;
  render();
  document.getElementById('setBtn')?.focus();
}

async function saveDbPath(): Promise<void> {
  const input = document.getElementById('dbPath') as HTMLInputElement | null;
  const value = input?.value.trim() ?? '';
  if (!value) {
    state.settings.dbMessage = { text: 'Escribe la ruta de la base.', ok: false };
    render();
    return;
  }

  try {
    const config = await api.setDbPath(value);
    state.dbPath = config.dbPath;
    state.settings.dbPath = config.dbPath;
    state.settings.dbMessage = { text: 'Base encontrada.', ok: true };
    state.dbMissing = false;
    state.loadError = null;
    state.loading = true;
    state.lastOkAt = null;
    render();
    void poll();
  } catch (error) {
    state.settings.dbMessage = { text: errorText(error), ok: false };
    render();
  }
}

async function toggleAutostart(): Promise<void> {
  try {
    if (state.settings.autostart === true) await disableAutostart();
    else await enableAutostart();
    state.settings.autostart = await autostartEnabled();
  } catch (error) {
    showToast(errorText(error));
  }
  render();
}

async function checkForUpdates(): Promise<void> {
  state.settings.lastSearch = Date.now();
  state.settings.update = { state: 'checking' };
  render();

  if (pendingUpdate) {
    await pendingUpdate.close().catch(() => undefined);
    pendingUpdate = null;
  }

  try {
    const update = await check();
    if (!update) {
      state.settings.update = { state: 'ok', version: state.settings.version || '—' };
    } else {
      pendingUpdate = update;
      state.settings.update = {
        state: 'available',
        version: update.version,
        body: update.body,
      };
    }
  } catch (error) {
    state.settings.update = { state: 'error', message: errorText(error) };
  }
  render();
}

async function downloadUpdate(): Promise<void> {
  const update = pendingUpdate;
  if (!update) return;

  const version = update.version;
  let downloaded = 0;
  let total: number | null = null;
  let cancelled = false;
  cancelDownload = () => {
    cancelled = true;
  };

  state.settings.update = { state: 'downloading', version, pct: 0, downloaded: 0, total: null };
  render();

  try {
    await update.download((event) => {
      if (cancelled) return;
      if (event.event === 'Started') {
        total = event.data.contentLength ?? null;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
      }
      const pct = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
      state.settings.update = { state: 'downloading', version, pct, downloaded, total };
      render();
    });

    if (cancelled) {
      state.settings.update = { state: 'available', version, body: update.body };
    } else {
      state.settings.update = { state: 'ready', version };
      renderer.announce(`${version} lista. Se instala al reiniciar.`);
    }
  } catch (error) {
    state.settings.update = cancelled
      ? { state: 'available', version, body: update.body }
      : { state: 'error', message: errorText(error) };
  } finally {
    cancelDownload = null;
    render();
  }
}

function cancelUpdateDownload(): void {
  cancelDownload?.();
  if (state.settings.update.state === 'downloading') {
    state.settings.update = {
      state: 'available',
      version: state.settings.update.version,
      body: pendingUpdate?.body,
    };
    render();
  }
}

async function installAndRelaunch(): Promise<void> {
  const update = pendingUpdate;
  if (!update) return;
  try {
    await update.install();
    await relaunch();
  } catch (error) {
    state.settings.update = { state: 'error', message: errorText(error) };
    render();
  }
}

async function copyCommand(): Promise<void> {
  const command = 'scripts\\start-agent.ps1';
  try {
    await navigator.clipboard.writeText(command);
    showToast(`Comando copiado: ${command}`);
  } catch {
    showToast('No se pudo copiar el comando.');
  }
}

function handleAction(action: string, element: HTMLElement): void {
  const card = currentCard(element);
  const id = outboxId(element);

  switch (action) {
    case 'open-settings':
      openSettings();
      break;
    case 'close-settings':
      closeSettings();
      break;
    case 'hide':
      void hideWindow();
      break;
    case 'retry-snapshot':
      state.loading = true;
      render();
      void poll();
      break;
    case 'copy-command':
      void copyCommand();
      break;
    case 'toggle-size-menu':
      toggleSizeMenu(element);
      break;
    case 'restore-size':
      void restoreLastSize();
      break;
    case 'toast-undo': {
      const action = toastUndoFn;
      hideToast();
      action?.();
      break;
    }
    case 'send':
      if (card) startSend(card, true);
      break;
    case 'restore':
      if (card) {
        card.text = card.baseDraft;
        render();
      }
      break;
    case 'discard':
      if (card) startDismiss(card);
      break;
    case 'undo-send':
      if (card) undoSend(card);
      break;
    case 'schedule':
      if (card) openSchedule(card);
      break;
    case 'sched-back':
      if (card) {
        card.phase = 'idle';
        card.error = null;
        render();
        focusCard(card.id);
      }
      break;
    case 'sched-ok':
      if (card) void commitSchedule(card);
      break;
    case 'sched-chip': {
      if (!card) break;
      const at = Number(element.dataset.at);
      if (!Number.isFinite(at)) break;
      card.sched = { date: isoDate(at), time: isoTime(at), presetAt: at };
      render();
      break;
    }
    case 'cf-view':
      if (card?.conflict) {
        card.conflict.view = !card.conflict.view;
        render();
      }
      break;
    case 'cf-use':
      if (card) resolveConflict(card, true);
      break;
    case 'cf-keep':
      if (card) resolveConflict(card, false);
      break;
    case 'err-close':
      if (card) {
        card.phase = 'gone';
        state.selectedId = visibleCards()[0]?.id ?? null;
        render();
        void poll();
      }
      break;
    case 'cancel-scheduled':
      if (id !== null) void cancelScheduled(id);
      break;
    case 'retry':
      if (id !== null) startRetry(id);
      break;
    case 'undo-retry':
      if (id !== null) undoRetry(id);
      break;
    case 'save-db':
      void saveDbPath();
      break;
    case 'toggle-autostart':
      void toggleAutostart();
      break;
    case 'update-check':
      void checkForUpdates();
      break;
    case 'update-download':
      void downloadUpdate();
      break;
    case 'update-cancel':
      cancelUpdateDownload();
      break;
    case 'update-relaunch':
      if (!state.busy) void installAndRelaunch();
      break;
    case 'update-later':
      closeSettings();
      break;
    default:
      break;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const copy = target.closest<HTMLElement>('[data-copy]');
  if (copy) {
    event.stopPropagation();
    void copyId(Number(copy.dataset.copy));
    return;
  }

  const preset = target.closest<HTMLElement>('[data-preset]');
  if (preset?.dataset.preset) {
    closeSizeMenu();
    void setPreset(preset.dataset.preset as PresetKey);
    return;
  }

  const theme = target.closest<HTMLElement>('[data-th]');
  if (theme?.dataset.th) {
    setTheme(theme.dataset.th as Theme);
    return;
  }

  const action = target.closest<HTMLElement>('[data-act]');
  if (action?.dataset.act) {
    if (action.getAttribute('aria-disabled') === 'true') return;
    handleAction(action.dataset.act, action);
    return;
  }

  const filter = target.closest<HTMLElement>('[data-filter]');
  if (filter?.dataset.filter) {
    state.filter = filter.dataset.filter as Filter;
    render();
    return;
  }

  const goto = target.closest<HTMLElement>('[data-goto]');
  if (goto?.dataset.goto) {
    state.tab = goto.dataset.goto as Tab;
    render();
    return;
  }

  const tab = target.closest<HTMLElement>('[data-tab]');
  if (tab?.dataset.tab) {
    state.tab = tab.dataset.tab as Tab;
    render();
    return;
  }

  const cardElement = target.closest<HTMLElement>('[data-card-id]');
  if (cardElement) {
    if (!target.closest('textarea, input, select, button')) {
      selectCard(Number(cardElement.dataset.cardId));
    }
    return;
  }

  if (!target.closest('#sizeMenu') && !target.closest('#sizeBtn')) closeSizeMenu();
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (target.matches('[data-draft]')) {
    const card = currentCard(target);
    if (!card) return;
    card.text = (target as HTMLTextAreaElement).value;
    render();
    return;
  }

  if (target.matches('[data-sched-date], [data-sched-time]')) {
    const host = target.closest<HTMLElement>('[data-card-id]');
    const card = host ? cardById(Number(host.dataset.cardId)) : undefined;
    if (!host || !card || !card.sched) return;
    const date = host.querySelector<HTMLInputElement>('[data-sched-date]')?.value ?? card.sched.date;
    const time = host.querySelector<HTMLInputElement>('[data-sched-time]')?.value ?? card.sched.time;
    card.sched = { date, time, presetAt: null };
    render();
  }
});

function handleEscape(inField: boolean): void {
  const sending = state.cards.find((card) => card.phase === 'sending');
  if (sending) {
    undoSend(sending);
    return;
  }
  if (state.settings.open) {
    closeSettings();
    return;
  }
  const scheduling = state.cards.find((card) => card.phase === 'schedule');
  if (scheduling) {
    scheduling.phase = 'idle';
    render();
    focusCard(scheduling.id);
    return;
  }
  if (toastUndoFn) {
    const action = toastUndoFn;
    hideToast();
    action();
    return;
  }
  if (inField) {
    (document.activeElement as HTMLElement | null)?.blur();
    const card = activeCard();
    if (card) focusCard(card.id);
    return;
  }
  closeSizeMenu();
}

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const inField = !!target?.closest('textarea, input, select');

  if (event.ctrlKey && !event.altKey && /^[0-3]$/.test(event.key)) {
    event.preventDefault();
    void setPreset(PRESET_KEYS[Number(event.key)]);
    return;
  }

  if (event.ctrlKey && event.key === ',') {
    event.preventDefault();
    openSettings();
    return;
  }

  if (event.altKey && /^[1-3]$/.test(event.key)) {
    event.preventDefault();
    state.tab = TABS[Number(event.key) - 1];
    render();
    return;
  }

  if (event.key === 'Escape') {
    handleEscape(inField);
    return;
  }

  // Con los ajustes abiertos, los atajos de tarjeta no deben actuar sobre el fondo.
  if (state.settings.open) return;

  if (event.ctrlKey && event.key.toLowerCase() === 'z') {
    if (!inField) {
      event.preventDefault();
      undoLast();
    }
    return;
  }

  if (event.ctrlKey && event.key === 'Enter') {
    const card = activeCard();
    if (card && card.data.category === 'respuesta') {
      event.preventDefault();
      startSend(card, event.shiftKey);
    }
    return;
  }

  if (inField || event.ctrlKey || event.altKey || event.metaKey) return;

  const card = activeCard();
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'j' || event.key === 'k') && state.tab === 'pending') {
    event.preventDefault();
    moveSelection(event.key === 'ArrowDown' || event.key === 'j' ? 1 : -1);
    return;
  }

  if (!card) return;

  if (event.key === 'c') {
    void copyId(card.id);
    return;
  }
  if (event.key === 'Enter' || event.key === 'e') {
    event.preventDefault();
    state.selectedId = card.id;
    state.tab = 'pending';
    render();
    focusDraft(card.id);
    return;
  }
  if (event.key === 'p' && card.data.category === 'respuesta') {
    openSchedule(card);
    return;
  }
  if (event.key === 'd' || event.key === 'Delete') {
    event.preventDefault();
    startDismiss(card);
  }
});

async function init(): Promise<void> {
  applyMode(window.innerWidth, window.innerHeight);
  render();

  try {
    const config = await api.getConfig();
    state.dbPath = config.dbPath;
    state.settings.dbPath = config.dbPath;
  } catch (error) {
    state.loadError = errorText(error);
  }

  lastSize = { width: window.innerWidth, height: window.innerHeight };
  markPreset(matchingPreset(lastSize));
  window.addEventListener('resize', onWindowResize);
  void appWindow.onCloseRequested(() => cancelTransient()).catch(() => undefined);

  render();
  void poll();
  setInterval(() => void poll(), 3_000);
  setInterval(tick, 250);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
