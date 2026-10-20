import type { Health, OutboxView, SuggestionView } from './api';
import { formatId } from './logic/ids';
import { clock, clockSeconds, fromInputs, isoDate, isoTime, relativeAgo, saleLabel, schedulePresets } from './logic/format';
import { UNDO_MS } from './logic/undo';
import type { HeightMode, WidthMode } from './logic/layout';

export type Tab = 'pending' | 'sched' | 'failed';
export type Filter = 'all' | 'respuesta' | 'tarea' | 'esperando';
export type Theme = 'system' | 'light' | 'dark';
export type CardPhase = 'idle' | 'sending' | 'schedule' | 'leaving' | 'gone';

export interface ConflictState {
  data: SuggestionView;
  view: boolean;
}

export interface ScheduleForm {
  date: string;
  time: string;
  presetAt: number | null;
}

/** Campo enfocado dentro de una tarjeta, para devolverle el foco tras pintar. */
interface FieldFocus {
  selector: string;
  start: number | null;
  end: number | null;
}

export interface CardState {
  id: number;
  data: SuggestionView;
  /** Texto actual del editor. Puede diferir del borrador del agente. */
  text: string;
  /** Borrador del agente contra el que se mide "Editado". */
  baseDraft: string;
  phase: CardPhase;
  startedAt: number | null;
  error: string | null;
  conflict: ConflictState | null;
  replaced: { oldId: number; at: number } | null;
  sched: ScheduleForm | null;
  schedBusy: boolean;
}

export type UpdateView =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; version: string }
  | { state: 'available'; version: string; body?: string }
  | { state: 'downloading'; version: string; pct: number; downloaded: number; total: number | null }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export interface SettingsView {
  open: boolean;
  dbPath: string;
  dbMessage: { text: string; ok: boolean } | null;
  autostart: boolean | null;
  theme: Theme;
  version: string;
  lastSearch: number | null;
  update: UpdateView;
}

export interface AppViewState {
  cards: CardState[];
  scheduled: OutboxView[];
  failed: OutboxView[];
  /** outbox id -> instante en que empezó la cuenta de Reintentar. */
  retries: Map<number, number>;
  health: Health | null;
  readAt: number | null;
  lastOkAt: number | null;
  now: number;
  paused: boolean;
  dbMissing: boolean;
  loadError: string | null;
  loading: boolean;
  busy: boolean;
  tab: Tab;
  filter: Filter;
  selectedId: number | null;
  counterMode: boolean;
  toast: { message: string; hasUndo: boolean } | null;
  settings: SettingsView;
  dbPath: string;
  mode: { width: WidthMode; height: HeightMode };
}

const CAT_LABEL: Record<string, string> = {
  respuesta: 'Responder',
  tarea: 'Tarea',
  esperando: 'Esperando',
};

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));

const icon = (id: string): string => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

const timeOf = (view: SuggestionView): number => view.updatedAt || view.createdAt;

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el as T;
}

function isField(element: Element | null): boolean {
  return !!element && element.matches('textarea, input, select');
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB`;
}

/** Porta el markup del mockup aprobado y reconcilia sin pisar la tarjeta en edición. */
export class Renderer {
  private readonly doc: Document;
  private readonly win: HTMLElement;
  private readonly banners: HTMLElement;
  private readonly bannerMore: HTMLElement;
  private readonly health: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly cN: HTMLElement;
  private readonly cF: HTMLElement;
  private readonly cH: HTMLElement;
  private readonly tP: HTMLElement;
  private readonly tS: HTMLElement;
  private readonly tF: HTMLElement;
  private readonly filters: HTMLElement;
  private readonly colList: HTMLElement;
  private readonly colDetail: HTMLElement;
  private readonly colSide: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly toastMsg: HTMLElement;
  private readonly toastUndo: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly dbPath: HTMLInputElement;
  private readonly dbMsg: HTMLElement;
  private readonly swStart: HTMLElement;
  private readonly upd: HTMLElement;
  private readonly updDot: HTMLElement;
  private readonly versionLabel: HTMLElement;
  private readonly live: HTMLElement;
  /** Firma del contenido de la pestaña Programados/Fallidos ya pintado. */
  private listTab: Tab | null = null;
  private listSig = '';
  /** Firma de la columna lateral (Programados + Fallidos). */
  private sideSig = '';

  constructor(doc: Document = document) {
    this.doc = doc;
    this.win = byId(doc, 'win');
    this.banners = byId(doc, 'banners');
    this.bannerMore = byId(doc, 'bannerMore');
    this.health = byId(doc, 'health');
    this.counter = byId(doc, 'counter');
    this.cN = byId(doc, 'cN');
    this.cF = byId(doc, 'cF');
    this.cH = byId(doc, 'cH');
    this.tP = byId(doc, 'tP');
    this.tS = byId(doc, 'tS');
    this.tF = byId(doc, 'tF');
    this.filters = byId(doc, 'filters');
    this.colList = byId(doc, 'colList');
    this.colDetail = byId(doc, 'colDetail');
    this.colSide = byId(doc, 'colSide');
    this.status = byId(doc, 'status');
    this.toast = byId(doc, 'toast');
    this.toastMsg = byId(doc, 'toastMsg');
    this.toastUndo = byId(doc, 'toastUndo');
    this.sheet = byId(doc, 'sheet');
    this.dbPath = byId<HTMLInputElement>(doc, 'dbPath');
    this.dbMsg = byId(doc, 'dbMsg');
    this.swStart = byId(doc, 'swStart');
    this.upd = byId(doc, 'upd');
    this.updDot = byId(doc, 'updDot');
    this.versionLabel = byId(doc, 'versionLabel');
    this.live = byId(doc, 'live');
  }

  announce(message: string): void {
    this.live.textContent = message;
  }

  render(s: AppViewState): void {
    this.win.dataset.theme = s.settings.theme;
    this.win.dataset.width = s.mode.width;
    this.win.dataset.height = s.mode.height;
    this.win.classList.toggle('is-counter', s.counterMode);

    this.renderCounts(s);
    this.renderHealth(s);
    this.renderBanners(s);
    this.renderTabs(s);
    this.renderFilters(s);
    this.renderPending(s);
    this.renderDetail(s);
    this.renderSide(s);
    this.renderStatus(s);
    this.renderToast(s);
    this.renderSheet(s);
    this.fitDrafts();
  }

  private renderCounts(s: AppViewState): void {
    const pending = s.cards.filter((card) => card.phase !== 'gone').length;
    const failed = s.failed.length;
    this.tP.textContent = String(pending);
    this.tS.textContent = String(s.scheduled.length);
    this.tF.textContent = String(failed);
    this.tF.className = `c${failed ? ' bad' : ''}`;

    this.cN.textContent = String(pending);
    this.cF.textContent = failed ? `${failed} fallido${failed > 1 ? 's' : ''}` : '';
    this.counter.setAttribute(
      'aria-label',
      `whatcrow: ${pending} por aprobar, ${failed} fallidos. Abrir`,
    );
  }

  private renderHealth(s: AppViewState): void {
    const level = s.dbMissing || (s.health && !s.health.daemonHealthy)
      ? 'bad'
      : (s.health && !s.health.agentHealthy) || (s.paused && !s.loading)
        ? 'warn'
        : '';
    for (const dot of [this.health, this.cH]) dot.className = `health ${level}`;
    this.health.setAttribute(
      'aria-label',
      level === 'bad' ? 'Hay un problema grave' : level === 'warn' ? 'Hay un aviso' : 'Todo funciona',
    );
  }

  private renderBanners(s: AppViewState): void {
    const items: string[] = [];

    if (s.dbMissing) {
      items.push(`<div class="banner err" role="alert">${icon('i-db')}<p><strong>No encuentro la base de datos.</strong> whatcrow no puede leer las sugerencias.</p>
        <div class="acts"><button class="btn sm" data-act="open-settings">Elegir archivo…</button><button class="btn sm" data-act="retry-snapshot">Reintentar</button></div></div>`);
    }
    if (s.health && !s.health.daemonHealthy) {
      items.push(`<div class="banner err" role="alert">${icon('i-warn')}<p><strong>WhatsApp está desconectado.</strong> Lo que envíes queda en cola y sale cuando vuelva.</p>
        <details><summary>Detalles</summary>El daemon informa "${esc(s.health.daemonStatus)}". Revisa la sesión de WhatsApp en la otra app.</details></div>`);
    }
    if (s.health && !s.health.agentHealthy) {
      const at = s.health.agentLastAt;
      const when = at ? `desde las ${clock(at)} (${relativeAgo(at, s.now)})` : 'todavía no dio señales';
      items.push(`<div class="banner warn" role="status">${icon('i-warn')}<p><strong>El agente no da señales ${when}.</strong> No van a llegar sugerencias nuevas.</p>
        <div class="acts"><button class="btn sm" data-act="copy-command">Copiar comando de arranque</button></div></div>`);
    }
    if (s.paused && !s.dbMissing && !s.loading) {
      const since = s.lastOkAt ? `desde ${clockSeconds(s.lastOkAt)}` : 'todavía no hay una lectura';
      items.push(`<div class="banner warn" role="status">${icon('i-db')}<p><strong>Sin lectura de la base ${since}.</strong> Reintentando… Enviar está en pausa.</p></div>`);
    }
    if (s.loadError && !s.dbMissing) {
      items.push(`<div class="banner err" role="alert">${icon('i-warn')}<p><strong>No se pudo leer la base.</strong> ${esc(s.loadError)}</p>
        <div class="acts"><button class="btn sm" data-act="retry-snapshot">Reintentar</button></div></div>`);
    }

    this.banners.innerHTML = items.join('');
    const extra = items.length > 1;
    this.bannerMore.textContent = extra
      ? `${items.length - 1} aviso${items.length > 2 ? 's' : ''} más: amplía la ventana para verlos`
      : '';
    this.bannerMore.style.display = extra ? '' : 'none';
  }

  private renderTabs(s: AppViewState): void {
    for (const tab of Array.from(this.doc.querySelectorAll<HTMLElement>('.tab'))) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === s.tab));
    }
  }

  private renderFilters(s: AppViewState): void {
    if (s.tab !== 'pending' || s.loading || s.dbMissing) {
      this.filters.innerHTML = '';
      return;
    }
    const live = s.cards.filter((card) => card.phase !== 'gone');
    const count = (filter: Filter): number =>
      live.filter((card) => filter === 'all' || card.data.category === filter).length;
    const options: Array<[Filter, string]> = [
      ['respuesta', 'Responder'],
      ['tarea', 'Tareas'],
      ['esperando', 'Esperando'],
      ['all', 'Todas'],
    ];
    this.filters.innerHTML = options
      .map(
        ([key, label]) =>
          `<button class="chip" aria-pressed="${s.filter === key}" data-filter="${key}">${label} <span class="num">${count(key)}</span></button>`,
      )
      .join('');
  }

  private renderPending(s: AppViewState): void {
    if (this.listTab !== s.tab) {
      this.listTab = s.tab;
      this.listSig = '';
    }

    if (s.dbMissing) {
      this.listSig = '';
      this.colList.innerHTML = `<div class="empty" role="alert">${icon('i-db')}<h2>No encuentro la base de datos</h2>
        <p>whatcrow lee las sugerencias de este archivo y no pudo abrirlo:</p>
        <p class="path">${esc(s.dbPath)}</p>
        <p>Revisa que la ruta sea correcta o elige otro archivo.</p>
        <div class="acts"><button class="btn primary" data-act="open-settings">Elegir archivo…</button><button class="btn" data-act="retry-snapshot">Reintentar</button></div></div>`;
      return;
    }

    if (s.loading) {
      this.listSig = '';
      this.colList.innerHTML = `<div class="list" aria-busy="true" aria-label="Cargando sugerencias"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
        <p class="empty" style="padding:10px 2px">Abriendo la base…</p>`;
      return;
    }

    if (s.tab === 'sched') {
      const sig = this.outboxSignature(s.tab, s);
      if (sig !== this.listSig) {
        this.listSig = sig;
        this.colList.innerHTML = `<div class="list">${this.scheduledList(s)}</div>`;
      }
      return;
    }
    if (s.tab === 'failed') {
      const sig = this.outboxSignature(s.tab, s);
      if (sig !== this.listSig) {
        this.listSig = sig;
        this.colList.innerHTML = `<div class="list">${this.failedList(s)}</div>`;
      }
      return;
    }

    this.listSig = '';

    const visible = s.cards.filter(
      (card) => card.phase !== 'gone' && (s.filter === 'all' || card.data.category === s.filter),
    );

    if (!visible.length) {
      const filtered = s.filter !== 'all';
      const links =
        s.mode.width === 'three-col'
          ? ''
          : `<div class="acts"><button class="linkbtn" data-goto="sched">Programados (${s.scheduled.length})</button><button class="linkbtn" data-goto="failed">Fallidos (${s.failed.length})</button></div>`;
      this.colList.innerHTML = filtered
        ? `<div class="empty"><h2>No hay ${CAT_LABEL[s.filter]?.toLowerCase() ?? 'sugerencias'} pendientes.</h2><button class="linkbtn" data-filter="all">Ver todas</button></div>`
        : `<div class="empty">${icon('crow')}<h2>Nada por aprobar.</h2>
          <p>${this.emptyDetail(s)}</p>
          ${links}</div>`;
      return;
    }

    let list = this.colList.querySelector<HTMLUListElement>('ul.list');
    if (!list) {
      this.colList.innerHTML = '';
      list = this.doc.createElement('ul');
      list.className = 'list';
      list.setAttribute('role', 'list');
      list.setAttribute('aria-label', 'Sugerencias pendientes');
      this.colList.appendChild(list);
    }

    const wanted = new Set(visible.map((card) => card.id));
    for (const li of Array.from(list.children) as HTMLLIElement[]) {
      if (!wanted.has(Number(li.dataset.cardId))) li.remove();
    }

    // Solo se mueven los nodos que quedaron fuera de orden: re-insertar todos en cada render
    // confundía el scroll anchoring de Chromium y el clic en una tarjeta devolvía la lista arriba.
    visible.forEach((card, index) => {
      let li = list.querySelector<HTMLLIElement>(`li[data-card-id="${card.id}"]`);
      if (!li) {
        li = this.doc.createElement('li');
        li.dataset.cardId = String(card.id);
      }
      const expected = list.children[index] ?? null;
      if (li !== expected) list.insertBefore(li, expected);
      this.paintCard(li, card, s, 'l');
    });
  }

  private emptyDetail(s: AppViewState): string {
    const at = s.health?.agentLastAt;
    if (!at) return 'La próxima sugerencia aparece acá en cuanto el agente haga su vuelta.';
    return `El agente revisó a las ${clock(at)}; la próxima vuelta es cerca de las ${clock(at + 600_000)}.`;
  }

  private renderDetail(s: AppViewState): void {
    if (s.dbMissing || s.loading || s.tab !== 'pending') {
      this.colDetail.innerHTML = '';
      return;
    }
    const selected = s.cards.find((card) => card.id === s.selectedId && card.phase !== 'gone');
    if (!selected) {
      this.colDetail.innerHTML = '<div class="empty"><p>Cuando llegue una sugerencia, aparece acá.</p></div>';
      return;
    }
    this.paintCard(this.colDetail, selected, s, 'd');
  }

  private renderSide(s: AppViewState): void {
    const sig = this.outboxSignature('side', s);
    if (sig !== this.sideSig) {
      this.sideSig = sig;
      this.colSide.innerHTML = `<div><div class="sec-h">Programados <span class="num">${s.scheduled.length}</span></div><div class="list">${this.scheduledList(s)}</div></div>
      <div><div class="sec-h">Fallidos <span class="num">${s.failed.length}</span></div><div class="list">${this.failedList(s)}</div></div>`;
    }
    this.updateCountdowns(this.colSide, s);
  }

  /** Cambia solo cuando los datos de las listas cambian; la cuenta regresiva va aparte. */
  private outboxSignature(scope: Tab | 'side', s: AppViewState): string {
    return JSON.stringify([
      scope,
      s.scheduled.map((item) => [item.id, item.chatName, item.text, item.sendAt]),
      s.failed.map((item) => [item.id, item.chatName, item.text, item.error, item.status]),
      [...s.retries.keys()],
      s.paused,
      s.dbMissing,
    ]);
  }

  /** Actualiza los segundos de Reintentar sin reconstruir la fila (la barra anima sola). */
  private updateCountdowns(root: HTMLElement, s: AppViewState): void {
    for (const row of Array.from(root.querySelectorAll<HTMLElement>('[data-outbox-id]'))) {
      const startedAt = s.retries.get(Number(row.dataset.outboxId));
      if (startedAt === undefined) continue;
      const countdown = row.querySelector<HTMLElement>('.cd');
      if (countdown) {
        countdown.textContent = String(Math.max(0, Math.ceil((UNDO_MS - (s.now - startedAt)) / 1000)));
      }
    }
  }

  /** Pulso de la cuenta de Reintentar: no hace falta repintar toda la interfaz. */
  tickRetries(s: AppViewState): void {
    this.updateCountdowns(this.colSide, s);
    this.updateCountdowns(this.colList, s);
  }

  /** Pinta una tarjeta sin tocar el campo que tiene el foco (ui-spec §5.4). */
  private paintCard(host: HTMLElement, card: CardState, s: AppViewState, where: 'l' | 'd'): void {
    const existing = host.querySelector<HTMLElement>('.card');
    // Se parchea en el lugar cuando la estructura no cambió: si hay un campo
    // enfocado (para no perder el cursor) o si la cuenta regresiva / salida está
    // corriendo (reconstruir reiniciaría la animación de la barra).
    const structural = card.phase === 'idle' || card.phase === 'schedule';
    const unchanged = existing?.dataset.sig === this.cardSignature(card);
    if (existing && unchanged && (!structural || this.isFieldFocused(card.id))) {
      existing.className = this.cardClass(card, s);
      this.patchEditing(existing, card, s);
      return;
    }

    const caret = this.captureFocus(host);
    host.innerHTML = this.cardArt(card, s, where);
    this.restoreFocus(host, caret);
  }

  private countdown(card: CardState, now: number): number {
    if (card.startedAt === null) return 5;
    return Math.max(0, Math.ceil((UNDO_MS - (now - card.startedAt)) / 1000));
  }

  private cardSignature(card: CardState): string {
    return [
      card.phase,
      card.data.category,
      String(card.data.updatedAt),
      card.conflict ? 'conflict' : '',
      card.data.newer ? 'stale' : '',
      card.error ? 'error' : '',
      card.replaced ? 'replaced' : '',
    ]
      .filter(Boolean)
      .join('|');
  }

  /**
   * Recuerda el campo enfocado dentro de esta tarjeta antes de reconstruirla.
   * Solo aplica al panel que realmente contiene el foco (lista o detalle).
   */
  private captureFocus(host: HTMLElement): FieldFocus | null {
    const active = this.doc.activeElement;
    if (!active || !host.contains(active)) return null;
    if (active instanceof HTMLTextAreaElement && active.id.startsWith('d-')) {
      return { selector: `#${active.id}`, start: active.selectionStart, end: active.selectionEnd };
    }
    if (active.matches('input[data-sched-date]')) {
      return { selector: 'input[data-sched-date]', start: null, end: null };
    }
    if (active.matches('input[data-sched-time]')) {
      return { selector: 'input[data-sched-time]', start: null, end: null };
    }
    if (active.matches('.card')) {
      return { selector: '.card', start: null, end: null };
    }
    if (active.matches('[data-act]')) {
      return { selector: `[data-act="${active.getAttribute('data-act')}"]`, start: null, end: null };
    }
    return null;
  }

  private restoreFocus(host: HTMLElement, caret: FieldFocus | null): void {
    if (!caret) return;
    const field = host.querySelector<HTMLElement>(caret.selector);
    if (!field) return;
    field.focus({ preventScroll: true });
    if (caret.start !== null && field instanceof HTMLTextAreaElement) {
      field.setSelectionRange(caret.start, caret.end ?? caret.start);
    }
  }

  /**
   * Con el foco dentro del editor no se reconstruye la tarjeta: se actualizan
   * solo los indicadores y los estados de los botones para no perder el cursor.
   */
  private patchEditing(host: HTMLElement, card: CardState, s: AppViewState): void {
    if (card.phase === 'sending') {
      const countdown = host.querySelector<HTMLElement>('.c-sending .cd');
      if (countdown) countdown.textContent = String(this.countdown(card, s.now));
      return;
    }
    if (card.phase === 'leaving' || card.phase === 'gone') return;

    const edited = host.querySelector<HTMLElement>('.c-edited');
    if (edited) edited.hidden = card.text === card.baseDraft;

    const preview = host.querySelector<HTMLElement>('.c-preview');
    if (preview) preview.innerHTML = `<span class="lbl">Borrador:</span> ${esc(card.text || '—')}`;

    // El estado es la fuente de verdad: si el agente actualizó el borrador, el campo lo refleja.
    const draft = host.querySelector<HTMLTextAreaElement>('textarea.c-draft');
    if (draft && draft.value !== card.text) draft.value = card.text;

    const response = card.data.category === 'respuesta';
    const blocked = s.paused || s.dbMissing;
    const empty = response && !card.text.trim();
    const reason = blocked
      ? 'Sin lectura de la base: no se puede comprobar si sigue vigente'
      : empty
        ? 'Escribe un mensaje para enviar'
        : '';

    const sync = (selector: string, disabled: boolean, enabledTitle: string): void => {
      const button = host.querySelector<HTMLElement>(selector);
      if (!button) return;
      if (disabled) {
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('title', reason);
      } else {
        button.removeAttribute('aria-disabled');
        button.setAttribute('title', enabledTitle);
      }
    };

    sync('[data-act="send"]', blocked || empty, card.data.newer ? 'Enviar igual (Ctrl+Shift+Enter)' : 'Enviar (Ctrl+Enter)');
    sync('[data-act="schedule"]', blocked || empty, 'Programar (P)');
    sync('[data-act="discard"]', blocked, 'Descartar (D)');

    if (card.phase === 'schedule' && card.sched) {
      const at = fromInputs(card.sched.date, card.sched.time);
      const valid = at !== null && at > s.now;
      const when = host.querySelector<HTMLElement>('.c-sched .when');
      if (when) when.textContent = at ? `Sale ${saleLabel(at)}` : 'Elige una hora futura';

      const ok = host.querySelector<HTMLElement>('[data-act="sched-ok"]');
      if (ok) {
        const disabled = !valid || blocked || !card.text.trim();
        if (disabled) {
          ok.setAttribute('aria-disabled', 'true');
          ok.setAttribute('title', blocked ? reason : 'Elige una hora futura');
        } else {
          ok.removeAttribute('aria-disabled');
          ok.removeAttribute('title');
        }
      }

      for (const chip of Array.from(host.querySelectorAll<HTMLElement>('[data-act="sched-chip"]'))) {
        chip.setAttribute('aria-pressed', String(Number(chip.dataset.at) === card.sched.presetAt));
      }
    }
  }

  private isFieldFocused(id: number): boolean {
    const active = this.doc.activeElement;
    if (!isField(active)) return false;
    const host = active?.closest<HTMLElement>('[data-card-id]');
    return host ? Number(host.dataset.cardId) === id : false;
  }

  private cardClass(card: CardState, s: AppViewState): string {
    const cat = CAT_LABEL[card.data.category] ? card.data.category : 'respuesta';
    return [
      'card',
      `cat-${cat}`,
      card.data.newer ? 'is-stale' : '',
      card.id === s.selectedId ? 'is-sel open' : '',
      card.phase === 'leaving' ? 'leaving' : '',
    ].filter(Boolean).join(' ');
  }

  private cardArt(card: CardState, s: AppViewState, where: 'l' | 'd'): string {
    const view = card.data;
    const did = `${where}-${card.id}`;
    const label = CAT_LABEL[view.category] ?? view.category;
    const stale = !!view.newer;
    const response = view.category === 'respuesta';
    const time = clock(view.lastMsgAt ?? timeOf(view));
    const description = `${label}${stale ? ', desactualizada' : ''}, id ${view.id}, ${time}`;
    const fresh = card.replaced && s.now - card.replaced.at < 10_000;
    const replaced = fresh
      ? `<p class="c-replaced">Actualizada ${clock(timeOf(view))} · reemplaza a #${card.replaced?.oldId}</p>`
      : '';
    const group = view.isGroup ? icon('i-group') : '';
    const last = view.lastMsgText ? esc(view.lastMsgText) : '<span class="c-muted">Sin mensaje.</span>';
    const preview = response
      ? `<p class="c-preview"><span class="lbl">Borrador:</span> ${esc(card.text || '—')}</p>`
      : '';
    const body = this.cardBody(card, s, did);

    return `<article class="${this.cardClass(card, s)}" data-card-id="${card.id}" data-sig="${esc(this.cardSignature(card))}" tabindex="0" aria-labelledby="n-${did}" aria-describedby="m-${did}">
      <div class="c-head" data-select>
        <span class="c-name" id="n-${did}" title="${esc(view.chatName)}">${group}${esc(view.chatName)}</span>
        <span class="c-cat">${label}</span>
        <button class="c-id ${fresh ? 'fresh' : ''}" data-copy="${view.id}" aria-label="Copiar id ${view.id}" title="Copiar ${formatId(view.id)} (C)">${formatId(view.id)}</button>
        <time class="c-time">${time}</time>
      </div>
      <span class="sr-only" id="m-${did}">${description}</span>
      ${replaced}
      <p class="c-last">${last}</p>
      ${preview}
      <div class="c-body">${body}</div>
    </article>`;
  }

  private cardBody(card: CardState, s: AppViewState, did: string): string {
    const view = card.data;
    const response = view.category === 'respuesta';
    const stale = !!view.newer;
    let body = '';

    if (stale && view.newer) {
      body += `<div class="c-stale" role="note"><strong>Mensaje nuevo · ${clock(view.newer.ts)}</strong>
        <p>${esc(view.newer.text ?? 'Mensaje sin texto.')}</p><span>El borrador no lo contempla.</span></div>`;
    }
    if (view.note) {
      body += `<p class="c-note">${icon('i-info')}<span>${esc(view.note)}</span></p>`;
    }
    if (card.conflict && card.phase === 'idle') {
      const conflict = card.conflict;
      body += `<div class="c-conflict" role="status"><b>Hay una sugerencia nueva (${clock(timeOf(conflict.data))}).</b> Tu texto no se tocó.
        <div class="acts"><button class="btn sm" data-act="cf-view">${conflict.view ? 'Ocultar' : 'Ver'}</button><button class="btn sm" data-act="cf-use">Usar la nueva</button><button class="btn sm ghost" data-act="cf-keep">Seguir con la mía</button></div>
        ${conflict.view ? `<blockquote>${esc(conflict.data.draft ?? '(La sugerencia nueva no trae borrador.)')}</blockquote>` : ''}</div>`;
    }
    if (response) {
      const dirty = card.text !== card.baseDraft;
      body += `<div class="c-draftwrap">
        <label class="sr-only" for="d-${did}">Borrador para ${esc(view.chatName)}</label>
        <textarea class="c-draft" id="d-${did}" data-draft rows="2" ${card.phase === 'sending' ? 'readonly' : ''} placeholder="Escribe un mensaje para enviar">${esc(card.text)}</textarea>
        <span class="c-edited" ${dirty ? '' : 'hidden'}>Editado <button class="linkbtn" data-act="restore">Restaurar</button></span>
      </div>`;
    }
    if (card.error) {
      body += `<div class="c-err" role="alert"><span><strong>No se pudo completar.</strong> ${esc(card.error)}</span><button class="btn sm" data-act="err-close">Cerrar</button></div>`;
      return body;
    }
    if (card.phase === 'schedule') {
      body += this.scheduleForm(card, s);
    } else if (card.phase === 'sending') {
      const left = this.countdown(card, s.now);
      body += `<div class="c-sending"><span>Enviando a ${esc(view.chatName)} en <b class="cd">${left}</b> s</span>
        <button class="btn slot" data-act="undo-send" title="Deshacer (Esc)">Deshacer</button><div class="bar"></div></div>`;
    } else {
      body += this.actions(card, s, response, stale);
    }
    return body;
  }

  private actions(card: CardState, s: AppViewState, response: boolean, stale: boolean): string {
    const blocked = s.paused || s.dbMissing;
    const reason = blocked
      ? 'Sin lectura de la base: no se puede comprobar si sigue vigente'
      : !card.text.trim()
        ? 'Escribe un mensaje para enviar'
        : '';
    const disabled = blocked || (response && !card.text.trim());
    const ad = disabled ? `aria-disabled="true" title="${esc(reason)}"` : '';
    const discardTitle = blocked ? `title="${esc(reason)}"` : 'title="Descartar (D)"';
    if (!response) {
      return `<div class="c-actions"><button class="btn ghost" data-act="discard" ${blocked ? 'aria-disabled="true"' : ''} ${discardTitle}>Descartar</button><span class="spacer"></span></div>`;
    }
    return `<div class="c-actions">
      <button class="btn ghost" data-act="discard" ${blocked ? 'aria-disabled="true"' : ''} ${discardTitle}>Descartar</button><span class="spacer"></span>
      <button class="btn sched" data-act="schedule" aria-label="Programar" ${ad || 'title="Programar (P)"'}><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg><span class="lbl">Programar</span></button>
      <button class="btn slot ${stale ? 'warn' : 'primary'}" data-act="send" ${ad || `title="${stale ? 'Enviar igual (Ctrl+Shift+Enter)' : 'Enviar (Ctrl+Enter)'}"`}>${stale ? 'Enviar igual' : 'Enviar'}</button>
    </div>`;
  }

  private scheduleForm(card: CardState, s: AppViewState): string {
    const defaults = schedulePresets(s.now)[0];
    const date = card.sched?.date ?? isoDate(defaults.at);
    const time = card.sched?.time ?? isoTime(defaults.at);
    const at = fromInputs(date, time);
    const valid = at !== null && at > s.now;
    const blocked = s.paused || s.dbMissing || !card.text.trim();
    const disabled = !valid || blocked;
    const reason = blocked
      ? 'Sin lectura de la base o sin borrador'
      : !valid
        ? 'Elige una hora futura'
        : '';
    const chips = schedulePresets(s.now)
      .map(
        (preset) =>
          `<button class="chip" aria-pressed="${card.sched?.presetAt === preset.at}" data-act="sched-chip" data-at="${preset.at}">${preset.label}</button>`,
      )
      .join('');

    return `<div class="c-sched"><div class="chips" role="group" aria-label="Atajos de hora">${chips}</div>
      <div class="row">
        <label>Fecha<input type="date" data-sched-date value="${date}" /></label>
        <label>Hora<input type="time" data-sched-time value="${time}" /></label>
      </div>
      <p class="when">${at ? `Sale ${saleLabel(at)}` : 'Elige una hora futura'}</p>
      <p class="hint">Si la PC está apagada a esa hora, el envío vence a los 30 min y pasa a Fallidos.</p>
      <div class="c-actions">
        <button class="btn ghost" data-act="sched-back">Volver</button><span class="spacer"></span>
        <button class="btn slot primary" data-act="sched-ok" ${disabled ? `aria-disabled="true" title="${esc(reason)}"` : ''} ${card.schedBusy ? 'aria-disabled="true"' : ''}>Programar</button>
      </div></div>`;
  }

  private scheduledList(s: AppViewState): string {
    if (!s.scheduled.length) return '<p class="empty">No hay envíos programados.</p>';
    return s.scheduled
      .map(
        (item) => `<div class="row-item" data-outbox-id="${item.id}">
          <div class="t"><b>${esc(item.chatName)}</b><span>${item.sendAt ? `Sale ${saleLabel(item.sendAt)}` : 'Sin hora'}</span></div>
          <p>${esc(item.text)}</p>
          <div class="acts"><button class="btn sm" data-act="cancel-scheduled" ${s.paused || s.dbMissing ? 'aria-disabled="true"' : ''}>Cancelar</button></div>
        </div>`,
      )
      .join('');
  }

  private failedList(s: AppViewState): string {
    if (!s.failed.length) return '<p class="empty">Ningún envío falló.</p>';
    return s.failed
      .map((item) => {
        const startedAt = s.retries.get(item.id);
        if (startedAt !== undefined) {
          const left = Math.max(0, Math.ceil((UNDO_MS - (s.now - startedAt)) / 1000));
          return `<div class="row-item failed" data-outbox-id="${item.id}"><div class="t"><b>${esc(item.chatName)}</b></div>
            <div class="c-sending"><span>Reintentando en <b class="cd">${left}</b> s</span><button class="btn slot" data-act="undo-retry">Deshacer</button><div class="bar"></div></div></div>`;
        }
        const why = item.error ?? (item.status === 'expired' ? 'Vencido: pasaron más de 30 min sin conexión.' : 'No se pudo enviar.');
        return `<div class="row-item failed" data-outbox-id="${item.id}">
          <div class="t"><b>${esc(item.chatName)}</b></div>
          <p>${esc(item.text)}</p>
          <span class="why">${esc(why)}</span>
          <div class="acts"><button class="btn slot" data-act="retry" ${s.paused || s.dbMissing ? 'aria-disabled="true" title="Sin lectura de la base"' : ''}>Reintentar</button></div>
        </div>`;
      })
      .join('');
  }

  private renderStatus(s: AppViewState): void {
    let agentDot = '';
    let agentText = 'Agente sin datos';
    if (s.health?.agentLastAt) {
      agentDot = s.health.agentHealthy ? '' : ' class="warn"';
      agentText = `Agente ${relativeAgo(s.health.agentLastAt, s.now)}`;
    }
    const waHealthy = !!s.health?.daemonHealthy;
    const read = s.dbMissing
      ? '<i class="bad"></i>Sin base'
      : s.paused
        ? `<i class="warn"></i>Leído ${s.lastOkAt ? clockSeconds(s.lastOkAt) : '—'}`
        : `<span class="s">Leído <span class="num">${s.readAt ? clockSeconds(s.readAt) : '—'}</span></span>`;

    this.status.innerHTML = `<span class="s"><i${agentDot}></i>${agentText}</span>
      <span class="s"><i${waHealthy ? '' : ' class="bad"'}></i>WhatsApp ${waHealthy ? 'conectado' : 'desconectado'}</span>
      <span class="grow"></span>${read}`;
  }

  private renderToast(s: AppViewState): void {
    this.toast.hidden = !s.toast;
    if (!s.toast) return;
    this.toastMsg.textContent = s.toast.message;
    this.toastUndo.hidden = !s.toast.hasUndo;
  }

  private renderSheet(s: AppViewState): void {
    this.sheet.hidden = !s.settings.open;
    if (this.doc.activeElement !== this.dbPath) this.dbPath.value = s.settings.dbPath;
    this.dbMsg.textContent = s.settings.dbMessage?.text ?? '';
    this.dbMsg.className = s.settings.dbMessage ? (s.settings.dbMessage.ok ? 'msg-ok' : 'msg-err') : '';

    this.swStart.setAttribute('aria-checked', String(s.settings.autostart === true));
    this.swStart.setAttribute('title', s.settings.autostart === null ? 'No se pudo comprobar' : '');
    for (const button of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-th]'))) {
      button.setAttribute('aria-pressed', String(button.dataset.th === s.settings.theme));
    }

    this.versionLabel.textContent = s.settings.version || '—';
    this.upd.innerHTML = this.updateBlock(s);
    this.updDot.hidden = !(s.settings.update.state === 'available' || s.settings.update.state === 'ready');
  }

  private updateBlock(s: AppViewState): string {
    const update = s.settings.update;
    const last = s.settings.lastSearch
      ? `<p class="meta">Última búsqueda: hoy ${clock(s.settings.lastSearch)}.</p>`
      : '<p class="meta">Todavía no buscaste actualizaciones.</p>';

    switch (update.state) {
      case 'idle':
        return `<button class="btn" data-act="update-check">Buscar actualizaciones</button>${last}`;
      case 'checking':
        return '<button class="btn" aria-disabled="true"><span class="spin" aria-hidden="true"></span>Buscando…</button>';
      case 'ok':
        return `<p>Tienes la última versión (${esc(update.version)}).</p><button class="btn" data-act="update-check">Buscar otra vez</button>`;
      case 'available':
        return `<p><b>Hay una versión nueva: ${esc(update.version)}</b></p>${update.body ? `<p class="meta">${esc(update.body)}</p>` : ''}<button class="btn primary" data-act="update-download">Descargar e instalar</button>`;
      case 'downloading': {
        const pct = Math.max(0, Math.min(100, update.pct));
        const size = update.total
          ? `${formatMb(update.downloaded)} de ${formatMb(update.total)}`
          : formatMb(update.downloaded);
        return `<p>Descargando ${esc(update.version)}… <span class="num">${pct} %</span></p>
          <div class="prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Descarga"><div style="width:${pct}%"></div></div>
          <p class="meta num">${size}</p><button class="btn" data-act="update-cancel">Cancelar</button>`;
      }
      case 'ready':
        return `<p><b>${esc(update.version)} lista.</b> Se instala al reiniciar.</p>
          <div style="display:flex;gap:6px"><button class="btn primary" data-act="update-relaunch" ${s.busy ? 'aria-disabled="true" title="Espera a que termine el envío"' : ''}>Reiniciar ahora</button><button class="btn ghost" data-act="update-later">Más tarde</button></div>
          ${s.busy ? '<p class="meta">Espera a que termine el envío.</p>' : ''}`;
      case 'error':
        return `<p class="msg-err">No se pudo comprobar: ${esc(update.message)}</p><button class="btn" data-act="update-check">Reintentar</button>`;
    }
  }

  private fitDrafts(): void {
    for (const draft of Array.from(this.doc.querySelectorAll<HTMLTextAreaElement>('.c-draft'))) {
      draft.style.height = 'auto';
      draft.style.height = `${draft.scrollHeight + 2}px`;
    }
  }
}
