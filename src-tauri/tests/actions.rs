mod common;

use common::*;
use rusqlite::params;
use whatcrow_lib::{actions::ActionError, db::Db};

fn outbox(f: &Fixture) -> Vec<(String, String, String, Option<i64>, Option<i64>)> {
    let c = f.conn();
    let mut s = c
        .prepare("SELECT chat_jid, text, status || '/' || approved_via, send_at, suggestion_id FROM outbox ORDER BY id")
        .unwrap();
    s.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}
fn status(f: &Fixture, id: i64) -> (String, Option<String>) {
    f.conn()
        .query_row(
            "SELECT status, final_text FROM suggestions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
}

#[test]
fn send_encola_el_texto_final_y_marca_sent() {
    let f = Fixture::new();
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    let mut db = Db::open(&f.path).unwrap();
    db.send(id, "  Sí, voy mañana ", None, NOW).unwrap();
    assert_eq!(
        outbox(&f),
        vec![(
            JUAN.into(),
            "Sí, voy mañana".into(),
            "pending/whatcrow".into(),
            None,
            Some(id)
        )]
    );
    assert_eq!(
        status(&f, id),
        ("sent".into(), Some("Sí, voy mañana".into()))
    );
}

#[test]
fn send_dos_veces_no_duplica() {
    let f = Fixture::new();
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    let mut db = Db::open(&f.path).unwrap();
    db.send(id, "Sí", None, NOW).unwrap();
    assert!(matches!(
        db.send(id, "Sí", None, NOW),
        Err(ActionError::NotPending)
    ));
    assert_eq!(outbox(&f).len(), 1);
}

#[test]
fn send_rechaza_texto_vacio_y_categorias_no_enviables() {
    let f = Fixture::new();
    let r = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    let t = f.suggestion(ANA, "A1", "tarea", None, "pending");
    let mut db = Db::open(&f.path).unwrap();
    assert!(matches!(
        db.send(r, "   ", None, NOW),
        Err(ActionError::EmptyText)
    ));
    assert!(matches!(
        db.send(t, "hola", None, NOW),
        Err(ActionError::NotSendable)
    ));
    assert!(outbox(&f).is_empty());
    assert_eq!(status(&f, r).0, "pending");
}

#[test]
fn schedule_guarda_send_at_y_rechaza_el_pasado() {
    let f = Fixture::new();
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    let mut db = Db::open(&f.path).unwrap();
    assert!(matches!(
        db.schedule(id, "Sí", NOW - 1, None, NOW),
        Err(ActionError::PastSchedule)
    ));
    db.schedule(id, "Sí", NOW + 3_600_000, None, NOW).unwrap();
    assert_eq!(outbox(&f)[0].3, Some(NOW + 3_600_000));
    assert_eq!(status(&f, id).0, "scheduled");
}

#[test]
fn dismiss_solo_sobre_pending() {
    let f = Fixture::new();
    let id = f.suggestion(JUAN, "J1", "esperando", None, "pending");
    let mut db = Db::open(&f.path).unwrap();
    db.dismiss(id, NOW).unwrap();
    assert_eq!(status(&f, id).0, "dismissed");
    assert!(matches!(db.dismiss(id, NOW), Err(ActionError::NotPending)));
}

#[test]
fn cancel_devuelve_la_sugerencia_a_pending_si_el_chat_no_tiene_otra() {
    let f = Fixture::new();
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    let mut db = Db::open(&f.path).unwrap();
    let out = db.schedule(id, "Sí", NOW + 60_000, None, NOW).unwrap();
    db.cancel_scheduled(out, NOW).unwrap();
    assert_eq!(outbox(&f)[0].2, "cancelled/whatcrow");
    assert_eq!(status(&f, id).0, "pending");
    assert!(matches!(
        db.cancel_scheduled(out, NOW),
        Err(ActionError::NotPending)
    ));
}

#[test]
fn cancel_deja_superseded_si_el_loop_ya_dejo_otra_pending() {
    let f = Fixture::new();
    let old = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    let mut db = Db::open(&f.path).unwrap();
    let out = db.schedule(old, "Sí", NOW + 60_000, None, NOW).unwrap();
    let newer = f.suggestion(JUAN, "J2", "respuesta", Some("Otra"), "pending");
    db.cancel_scheduled(out, NOW).unwrap();
    assert_eq!(status(&f, old).0, "superseded");
    assert_eq!(status(&f, newer).0, "pending");
}

#[test]
fn retry_reencola_el_mismo_texto_y_saca_la_fila_de_fallidos() {
    let f = Fixture::new();
    f.conn()
        .execute(
            "INSERT INTO outbox (chat_jid, text, status, error, created_at, approved_via, suggestion_id) VALUES (?1, 'hola', 'expired', 'vencido', ?2, 'whatcrow', 7)",
            params![JUAN, NOW - 1000],
        )
        .unwrap();
    let mut db = Db::open(&f.path).unwrap();
    db.retry(1, NOW).unwrap();
    assert_eq!(
        outbox(&f),
        vec![
            (
                JUAN.into(),
                "hola".into(),
                "retried/whatcrow".into(),
                None,
                Some(7)
            ),
            (
                JUAN.into(),
                "hola".into(),
                "pending/whatcrow".into(),
                None,
                Some(7)
            ),
        ]
    );
    assert!(matches!(db.retry(1, NOW), Err(ActionError::NotRetryable)));
}

#[test]
fn send_rechaza_si_llego_un_mensaje_entrante_que_el_usuario_no_vio() {
    let f = Fixture::new();
    f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    f.message(JUAN, "J2", false, "¿y entonces?", NOW - 1_000);
    let mut db = Db::open(&f.path).unwrap();
    assert!(matches!(db.send(id, "Sí", None, NOW), Err(ActionError::Stale)));
    assert!(outbox(&f).is_empty());
    assert_eq!(status(&f, id).0, "pending");
    // "Enviar igual" sobre el mensaje que el usuario sí vio.
    db.send(id, "Sí", Some("J2"), NOW).unwrap();
    assert_eq!(status(&f, id).0, "sent");
}

#[test]
fn send_con_visto_viejo_tambien_se_rechaza_si_llego_otro_mas() {
    let f = Fixture::new();
    f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    f.message(JUAN, "J2", false, "¿y entonces?", NOW - 2_000);
    f.message(JUAN, "J3", false, "???", NOW - 1_000);
    let mut db = Db::open(&f.path).unwrap();
    assert!(matches!(db.schedule(id, "Sí", NOW + 60_000, Some("J2"), NOW), Err(ActionError::Stale)));
    assert!(outbox(&f).is_empty());
}

#[test]
fn un_mensaje_propio_posterior_no_bloquea_el_envio() {
    let f = Fixture::new();
    f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
    let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
    f.message(JUAN, "J2", true, "ya le escribo", NOW - 1_000);
    let mut db = Db::open(&f.path).unwrap();
    db.send(id, "Sí", None, NOW).unwrap();
}
