pub mod actions;
pub mod commands;
pub mod config;
pub mod db;
pub mod model;

use commands::AppState;
use config::Config;
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Muestra y enfoca la ventana principal (clic en la bandeja o menú "Mostrar").
fn mostrar_ventana<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let config = Config::load(&config_dir);

            // Restaura el último tamaño elegido, si lo hay.
            if let Some((width, height)) = config.window
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.set_size(tauri::LogicalSize::new(width, height));
            }

            app.manage(AppState::new(config, config_dir));

            // Bandeja: "Mostrar" abre la ventana y "Salir" cierra de verdad.
            let mostrar = MenuItem::with_id(app, "mostrar", "Mostrar", true, None::<&str>)?;
            let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&mostrar, &salir])?;

            let mut tray = TrayIconBuilder::with_id("whatcrow")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("whatcrow")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "mostrar" => mostrar_ventana(app),
                    "salir" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        mostrar_ventana(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // La × esconde a la bandeja; el cierre real lo hace "Salir".
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::send,
            commands::schedule,
            commands::dismiss,
            commands::cancel_scheduled,
            commands::retry,
            commands::get_config,
            commands::set_db_path,
            commands::save_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
