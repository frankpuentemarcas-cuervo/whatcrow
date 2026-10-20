# whatcrow

Ventana de Windows, siempre encima de las demás, para aprobar las respuestas de WhatsApp que propone un agente. Muestra cada chat con su último mensaje y un borrador editable. Desde ahí se puede **enviar**, **programar**, **descartar** o **reintentar**.

whatcrow nunca envía por sí mismo: escribe la orden en la base `wa.sqlite` y el daemon de WhatsApp la despacha.

## Requisitos
- Windows 10/11 con WebView2 (ya viene en Windows 11).
- El repo `whatsapp` corriendo en la misma PC:
  - tarea `WhatsApp Daemon`: conexión con WhatsApp y envíos;
  - tarea `WhatsApp Agent`: el loop que deja las sugerencias.
- La base en `C:\dev\whatsapp\data\wa.sqlite`. Se cambia en **Ajustes**.

## Instalar y actualizar
1. Bajar el `whatcrow_x.y.z_x64-setup.exe` del último [Release](https://github.com/frankpuentemarcas-cuervo/whatcrow/releases/latest) e instalarlo.
2. Para actualizar: **Ajustes → Buscar actualizaciones**. Se instala la versión nueva sin desinstalar la anterior.

## Uso rápido
| Acción | Cómo |
|---|---|
| Enviar | **Enviar** o `Ctrl+Enter`. Hay 5 s para **Deshacer** (`Esc`). |
| Enviar una sugerencia desactualizada | **Enviar igual** o `Ctrl+Shift+Enter` |
| Programar | **Programar** o `P` |
| Descartar | **Descartar**, `D` o `Supr` (también con 5 s para deshacer) |
| Copiar el id para pedirle un cambio al agente | Clic en `#142` o `C` |
| Tamaño | Contador / Compacto / Normal / Amplio: `Ctrl+0` a `Ctrl+3` |

La × esconde la ventana en la bandeja. Para cerrarla del todo: clic derecho en el ícono → **Salir**.

## Desarrollo
```bash
npm ci
npm test                                        # lógica de UI (vitest)
cargo test --manifest-path src-tauri/Cargo.toml # capa SQLite y acciones
npm run tauri dev                               # app en modo desarrollo
```
Requiere Node 22+, Rust estable (MSVC) y Visual Studio Build Tools con C++.

Documentación:
- `docs/spec.md`: diseño funcional;
- `docs/design/`: UI aprobada y mockup;
- `docs/plans/`: plan de implementación.

## Publicar una versión
1. Subir la versión en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json` (las tres iguales).
2. `git commit -am "chore: release vX.Y.Z"`, después `git tag vX.Y.Z` y `git push && git push --tags`.
3. GitHub Actions (`release.yml`) compila, firma y publica el Release con el instalador, su `.sig` y `latest.json`. Las instalaciones existentes lo encuentran con **Buscar actualizaciones**.

**Clave de firma.** La privada vive en los secrets `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, y su respaldo está en `%USERPROFILE%\.tauri\` en la PC de Erick. **Si se pierde, las instalaciones existentes no pueden actualizarse nunca más**: hay que reinstalar a mano con una clave nueva.

## Licencias
Fuente Atkinson Hyperlegible Next: SIL Open Font License 1.1 (`src/fonts/OFL.txt`).
