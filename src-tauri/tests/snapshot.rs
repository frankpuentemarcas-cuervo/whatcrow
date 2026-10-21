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
    f.conn()
        .execute(
            "UPDATE suggestions SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![NOW, viejo],
        )
        .unwrap();
    f.conn()
        .execute(
            "UPDATE suggestions SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![NOW - 3_600_000, reciente],
        )
        .unwrap();
    let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
    assert_eq!(
        s.pending.iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![reciente, viejo]
    );
    assert_eq!(s.pending[0].last_msg_at, Some(NOW - 60_000));
    // Un mensaje nuevo en el chat viejo lo sube arriba.
    f.message(JUAN, "J2", false, "¿hola?", NOW - 1_000);
    let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
    assert_eq!(s.pending[0].id, viejo);
}

#[test]
fn snapshot_expone_solo_reglas_pendientes_con_procedencia_y_scope() {
    let f = Fixture::new();
    let c = f.conn();
    c.execute("INSERT INTO learning_rules(source_suggestion_id,chat_jid,scope,rule_text,rationale,status,created_at,updated_at) VALUES(10,?1,'global','Respuestas breves','Preferencia explícita','pending',1,2)",[JUAN]).unwrap();
    c.execute("INSERT INTO learning_rules(source_suggestion_id,chat_jid,scope,rule_text,rationale,status,created_at,updated_at) VALUES(11,?1,'contact','Tono cordial','Contexto conversacional','approved',1,2)",[JUAN]).unwrap();
    let rules = Db::open(&f.path)
        .unwrap()
        .snapshot(NOW)
        .unwrap()
        .learning_rules;
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].source_suggestion_id, 10);
    assert_eq!(rules[0].scope, "global");
    assert_eq!(rules[0].rationale, "Preferencia explícita");
}

#[test]
fn abrir_recrea_learning_rules_con_esquema_canonico_si_falta() {
    let f = Fixture::new();
    f.conn().execute_batch("DROP TABLE learning_rules;").unwrap();
    let _db = Db::open(&f.path).unwrap();
    let c = f.conn();
    let not_null: i64 = c.query_row("SELECT \"notnull\" FROM pragma_table_info('learning_rules') WHERE name='chat_jid'", [], |r| r.get(0)).unwrap();
    assert_eq!(not_null, 1);
    let base = "INSERT INTO learning_rules(source_suggestion_id,chat_jid,scope,rule_text,rationale,created_at,updated_at) VALUES(?1,?2,'global',?3,?4,1,1)";
    assert!(c.execute(base, rusqlite::params![1, JUAN, "ok", "ok"]).is_ok());
    assert!(c.execute(base, rusqlite::params![2, JUAN, "   ", "ok"]).is_err());
    assert!(c.execute(base, rusqlite::params![3, JUAN, "ok", "   "]).is_err());
    for name in ["idx_learning_rules_pending", "idx_learning_rules_scope"] {
        let found: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1", [name], |r| r.get(0)).unwrap();
        assert_eq!(found, 1, "missing index {name}");
    }
}

#[test]
fn abrir_crea_tabla_learning_rules_si_falta_sin_modificar_tablas_existentes() {
    let f = Fixture::new();
    f.conn().execute_batch("DROP TABLE learning_rules; CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('ok');").unwrap();
    let _db = Db::open(&f.path).unwrap();
    let c = f.conn();
    assert_eq!(
        c.query_row("SELECT value FROM preserved", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='learning_rules'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}
