use whatcrow_lib::config::Config;

#[test]
fn load_sin_archivo_o_invalido_devuelve_default_y_save_persiste() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(Config::load(dir.path()), Config::default());
    std::fs::write(dir.path().join("config.json"), "{no es json").unwrap();
    assert_eq!(Config::load(dir.path()), Config::default());
    let c = Config {
        db_path: "D:/otra/wa.sqlite".into(),
        window: Some((380.0, 660.0)),
    };
    c.save(dir.path()).unwrap();
    assert_eq!(Config::load(dir.path()), c);
    assert_eq!(
        Config::default().db_path,
        std::path::PathBuf::from(r"C:\dev\whatsapp\data\wa.sqlite")
    );
}
