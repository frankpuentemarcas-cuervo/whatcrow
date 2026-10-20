use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Configuración persistida en `config.json` dentro del directorio de configuración de la app.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub db_path: PathBuf,
    /// Último tamaño de ventana elegido por el usuario (ancho, alto) en píxeles lógicos.
    pub window: Option<(f64, f64)>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            db_path: PathBuf::from(r"C:\dev\whatsapp\data\wa.sqlite"),
            window: None,
        }
    }
}

impl Config {
    /// Lee `config.json`. Si no existe o está corrupto, devuelve la configuración por defecto.
    pub fn load(dir: &Path) -> Config {
        fs::read_to_string(dir.join("config.json"))
            .ok()
            .and_then(|texto| serde_json::from_str(&texto).ok())
            .unwrap_or_default()
    }

    /// Escribe `config.json` creando el directorio si hace falta.
    pub fn save(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir_all(dir)?;
        let json = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        fs::write(dir.join("config.json"), json)
    }
}
