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

export interface Snapshot {
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

export const send = (id: number, text: string): Promise<number> => invoke('send', { id, text });

export const schedule = (id: number, text: string, sendAt: number): Promise<number> =>
  invoke('schedule', { id, text, sendAt });

export const dismiss = (id: number): Promise<void> => invoke('dismiss', { id });

export const cancelScheduled = (id: number): Promise<void> => invoke('cancel_scheduled', { id });

export const retry = (id: number): Promise<number> => invoke('retry', { id });

export const getConfig = (): Promise<Config> => invoke('get_config');

export const setDbPath = (path: string): Promise<Config> => invoke('set_db_path', { path });

export const saveWindowSize = (width: number, height: number): Promise<void> =>
  invoke('save_window_size', { width, height });
