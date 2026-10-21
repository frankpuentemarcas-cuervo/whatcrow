import { invoke } from '@tauri-apps/api/core';

// Espejo en camelCase de las structs de Rust (src-tauri/src/model.rs).
export interface NewerMessage {
  id: string;
  text: string | null;
  ts: number;
}

export interface SuggestionView {
  id: number;
  chatJid: string;
  chatName: string;
  isGroup: boolean;
  lastMsgText: string | null;
  draft: string | null;
  category: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  // Hora del mensaje que contesta la sugerencia (ancla); la tarjeta muestra esta, no la de la sugerencia.
  lastMsgAt: number | null;
  newer: NewerMessage | null;
}

export interface OutboxView {
  id: number;
  chatJid: string;
  chatName: string;
  text: string;
  status: string;
  error: string | null;
  sendAt: number | null;
  createdAt: number;
  failedAt: number | null;
  suggestionId: number | null;
}

export interface Health {
  daemonStatus: string;
  daemonHealthy: boolean;
  agentLastAt: number | null;
  agentHealthy: boolean;
}

export interface LearningRuleView { id: number; sourceSuggestionId: number; chatJid: string | null; scope: string; ruleText: string; rationale: string; createdAt: number; updatedAt: number; }

export interface Snapshot {
  learningRules: LearningRuleView[];
  pending: SuggestionView[];
  scheduled: OutboxView[];
  failed: OutboxView[];
  health: Health;
  readAt: number;
}

// Espejo de Config (src-tauri/src/config.rs).
export interface Config {
  dbPath: string;
  window: [number, number] | null;
}

export const snapshot = (): Promise<Snapshot> => invoke('snapshot');
export const approveLearningRule = (id: number): Promise<void> => invoke('approve_learning_rule', { id });
export const rejectLearningRule = (id: number): Promise<void> => invoke('reject_learning_rule', { id });

// `seen`: id del mensaje entrante más nuevo que el usuario tenía a la vista ("Enviar igual").
// null = el ancla de la sugerencia. Rust rechaza si entró otro después (error "llegó un mensaje nuevo").
export const send = (id: number, text: string, seen: string | null = null): Promise<number> =>
  invoke('send', { id, text, seen });

export const schedule = (id: number, text: string, sendAt: number, seen: string | null = null): Promise<number> =>
  invoke('schedule', { id, text, sendAt, seen });

export const dismiss = (id: number): Promise<void> => invoke('dismiss', { id });

export const cancelScheduled = (id: number): Promise<void> => invoke('cancel_scheduled', { id });

export const retry = (id: number): Promise<number> => invoke('retry', { id });

export const getConfig = (): Promise<Config> => invoke('get_config');

export const setDbPath = (path: string): Promise<Config> => invoke('set_db_path', { path });

export const saveWindowSize = (width: number, height: number): Promise<void> =>
  invoke('save_window_size', { width, height });
