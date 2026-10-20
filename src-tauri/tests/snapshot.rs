mod common;

use common::*;
use whatcrow_lib::db::{Db, DbError};

#[test]
fn open_falla_si_la_base_no_existe_y_no_la_crea() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("no-existe.sqlite");
    assert!(matches!(Db::open(&path), Err(DbError::Missing(_))));
    assert!(!path.exists());
}

#[test]
fn snapshot_lista_pendientes_con_nombre_y_sin_newer() {
    let f = Fixture::new();
    f.chat(JUAN, "Juan");
    f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    f.suggestion(ANA, "A1", "respuesta", Some("x"), "sent");
    let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
    assert_eq!(s.pending.len(), 1);
    let p = &s.pending[0];
    assert_eq!(
        (p.id, p.chat_name.as_str(), p.is_group, p.draft.as_deref()),
        (id, "Juan", false, Some("Sí"))
    );
    assert!(p.newer.is_none());
    assert_eq!(s.read_at, NOW);
}

#[test]
fn snapshot_marca_newer_solo_con_un_mensaje_entrante_posterior() {
    let f = Fixture::new();
    f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
    f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    f.message(JUAN, "J2", true, "yo respondí algo", NOW - 60_000);
    assert!(
        Db::open(&f.path).unwrap().snapshot(NOW).unwrap().pending[0]
            .newer
            .is_none()
    );
    f.message(JUAN, "J3", false, "¿y entonces?", NOW - 30_000);
    let newer = Db::open(&f.path).unwrap().snapshot(NOW).unwrap().pending[0]
        .newer
        .clone()
        .unwrap();
    assert_eq!(
        (newer.id.as_str(), newer.text.as_deref()),
        ("J3", Some("¿y entonces?"))
    );
}

#[test]
fn snapshot_separa_programados_y_fallidos_recientes() {
    let f = Fixture::new();
    let c = f.conn();
    let ins = "INSERT INTO outbox (chat_jid, text, status, created_at, send_at, failed_at, approved_via) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'whatcrow')";
    c.execute(
        ins,
        rusqlite::params![JUAN, "luego", "pending", NOW, NOW + 3_600_000, None::<i64>],
    )
    .unwrap();
    c.execute(
        ins,
        rusqlite::params![JUAN, "ya", "pending", NOW, None::<i64>, None::<i64>],
    )
    .unwrap();
    c.execute(
        ins,
        rusqlite::params![
            JUAN,
            "falló",
            "failed",
            NOW - 1_000,
            None::<i64>,
            None::<i64>
        ],
    )
    .unwrap();
    c.execute(
        ins,
        rusqlite::params![
            JUAN,
            "venció",
            "expired",
            NOW - 9 * 86_400_000,
            NOW - 9 * 86_400_000,
            NOW - 60_000
        ],
    )
    .unwrap();
    c.execute(
        ins,
        rusqlite::params![
            JUAN,
            "viejo",
            "failed",
            NOW - 8 * 86_400_000,
            None::<i64>,
            None::<i64>
        ],
    )
    .unwrap();
    let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
    assert_eq!(
        s.scheduled
            .iter()
            .map(|o| o.text.as_str())
            .collect::<Vec<_>>(),
        vec!["luego"]
    );
    // Orden por hora de falla: "falló" (NOW - 1 s) antes que "venció" (failed_at NOW - 60 s); "viejo" queda fuera de los 7 días.
    assert_eq!(
        s.failed.iter().map(|o| o.text.as_str()).collect::<Vec<_>>(),
        vec!["falló", "venció"]
    );
}

#[test]
fn snapshot_calcula_salud_del_daemon_y_del_agente() {
    let f = Fixture::new();
    f.daemon("connected", NOW - 30_000);
    f.agent(NOW - 25 * 60_000);
    let h = Db::open(&f.path).unwrap().snapshot(NOW).unwrap().health;
    assert!(h.daemon_healthy);
    assert!(!h.agent_healthy);
    assert_eq!(h.agent_last_at, Some(NOW - 25 * 60_000));
    f.daemon("connected", NOW - 200_000);
    assert!(
        !Db::open(&f.path)
            .unwrap()
            .snapshot(NOW)
            .unwrap()
            .health
            .daemon_healthy
    );
}

#[test]
fn snapshot_ordena_por_el_ultimo_mensaje_entrante_no_por_la_sugerencia() {
    let f = Fixture::new();
    // Chat viejo con sugerencia recién creada (barrido) y chat reciente con sugerencia vieja.
    f.message(JUAN, "J1", false, "viejo", NOW - 5 * 86_400_000);
    f.message(ANA, "A1", false, "reciente", NOW - 60_000);
    let viejo = f.suggestion(JUAN, "J1", "respuesta", Some("x"), "pending");
    let reciente = f.suggestion(ANA, "A1", "respuesta", Some("y"), "pending");
    f.conn().execute("UPDATE suggestions SET updated_at = ?1 WHERE id = ?2", rusqlite::params![NOW, viejo]).unwrap();
    f.conn().execute("UPDATE suggestions SET updated_at = ?1 WHERE id = ?2", rusqlite::params![NOW - 3_600_000, reciente]).unwrap();
    let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
    assert_eq!(s.pending.iter().map(|p| p.id).collect::<Vec<_>>(), vec![reciente, viejo]);
    assert_eq!(s.pending[0].last_msg_at, Some(NOW - 60_000));
    // Un mensaje nuevo en el chat viejo lo sube arriba.
    f.message(JUAN, "J2", false, "¿hola?", NOW - 1_000);
    let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
    assert_eq!(s.pending[0].id, viejo);
}
