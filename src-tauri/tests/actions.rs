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
    db.send(id, "  Sí, voy mañana ", NOW).unwrap();
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
    db.send(id, "Sí", NOW).unwrap();
    assert!(matches!(
        db.send(id, "Sí", NOW),
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
        db.send(r, "   ", NOW),
        Err(ActionError::EmptyText)
    ));
    assert!(matches!(
        db.send(t, "hola", NOW),
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
        db.schedule(id, "Sí", NOW - 1, NOW),
        Err(ActionError::PastSchedule)
    ));
    db.schedule(id, "Sí", NOW + 3_600_000, NOW).unwrap();
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
    let out = db.schedule(id, "Sí", NOW + 60_000, NOW).unwrap();
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
    let out = db.schedule(old, "Sí", NOW + 60_000, NOW).unwrap();
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
