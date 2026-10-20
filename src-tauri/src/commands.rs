use crate::actions::ActionError;
use crate::config::Config;
use crate::db::Db;
use crate::model::Snapshot;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Estado compartido por los comandos: la base se abre perezosamente y se reabre
/// si una operación falla a nivel de SQLite.
pub struct AppState {
    pub db: Mutex<Option<Db>>,
    pub config: Mutex<Config>,
    pub config_dir: PathBuf,
}

impl AppState {
    pub fn new(config: Config, config_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(None),
            config: Mutex::new(config),
            config_dir,
        }
    }

    /// Ejecuta una acción abriendo la base si hace falta. Ante un error de base,
    /// suelta la conexión para que el próximo comando la reabra.
    fn with_db<T>(
        &self,
        action: impl FnOnce(&mut Db) -> Result<T, ActionError>,
    ) -> Result<T, ActionError> {
        let mut guard = bloquear(&self.db);
        if guard.is_none() {
            let path = bloquear(&self.config).db_path.clone();
            *guard = Some(Db::open(&path)?);
        }
        let db = guard.as_mut().expect("la base se abrió arriba");
        let result = action(db);
        if matches!(
            &result,
            Err(ActionError::Db(_)) | Err(ActionError::Sqlite(_))
        ) {
            *guard = None;
        }
        result
    }
}

/// Un pánico mientras se tiene el lock no debe dejar la app sin comandos.
fn bloquear<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Milisegundos desde la época, que es lo que guarda la base.
fn ahora_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    state
        .with_db(|db| db.snapshot(ahora_ms()).map_err(ActionError::from))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn send(state: State<'_, AppState>, id: i64, text: String) -> Result<i64, ActionError> {
    state.with_db(|db| db.send(id, &text, ahora_ms()))
}

#[tauri::command]
pub fn schedule(
    state: State<'_, AppState>,
    id: i64,
    text: String,
    send_at: i64,
) -> Result<i64, ActionError> {
    state.with_db(|db| db.schedule(id, &text, send_at, ahora_ms()))
}

#[tauri::command]
pub fn dismiss(state: State<'_, AppState>, id: i64) -> Result<(), ActionError> {
    state.with_db(|db| db.dismiss(id, ahora_ms()))
}

#[tauri::command]
pub fn cancel_scheduled(state: State<'_, AppState>, id: i64) -> Result<(), ActionError> {
    state.with_db(|db| db.cancel_scheduled(id, ahora_ms()))
}

#[tauri::command]
pub fn retry(state: State<'_, AppState>, id: i64) -> Result<i64, ActionError> {
    state.with_db(|db| db.retry(id, ahora_ms()))
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Config {
    bloquear(&state.config).clone()
}

/// Verifica que la base exista antes de guardar: si no se puede abrir, la
/// configuración anterior queda intacta.
#[tauri::command]
pub fn set_db_path(state: State<'_, AppState>, path: String) -> Result<Config, String> {
    let nuevo_path = PathBuf::from(&path);
    let db = Db::open(&nuevo_path).map_err(|e| e.to_string())?;

    let updated = {
        let mut current = bloquear(&state.config);
        let mut updated = current.clone();
        updated.db_path = nuevo_path;
        updated
            .save(&state.config_dir)
            .map_err(|e| format!("no se pudo guardar la configuración: {e}"))?;
        *current = updated.clone();
        updated
    };

    *bloquear(&state.db) = Some(db);
    Ok(updated)
}

#[tauri::command]
pub fn save_window_size(state: State<'_, AppState>, width: f64, height: f64) -> Result<(), String> {
    let mut current = bloquear(&state.config);
    let mut updated = current.clone();
    updated.window = Some((width, height));
    updated
        .save(&state.config_dir)
        .map_err(|e| format!("no se pudo guardar la configuración: {e}"))?;
    *current = updated;
    Ok(())
}
