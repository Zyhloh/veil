mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let main_window = app.get_webview_window("main").unwrap();
            let png_data = include_bytes!("../icons/icon.png");
            let decoder = png::Decoder::new(std::io::Cursor::new(png_data));
            let mut reader = decoder.read_info().unwrap();
            let mut buf = vec![0u8; reader.output_buffer_size()];
            let info = reader.next_frame(&mut buf).unwrap();
            buf.truncate(info.buffer_size());
            let icon = tauri::image::Image::new_owned(buf, info.width, info.height);
            main_window.set_icon(icon).unwrap();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_steam_path,
            commands::check_steam_running,
            commands::start_steam,
            commands::kill_steam,
            commands::restart_steam,
            commands::shutdown_steam_for_patching,
            commands::get_app_config,
            commands::save_app_config,
            commands::ensure_veil_dll,
            commands::verify_veil_dll,
            commands::remove_veil_dll,
            commands::install_manifest_paths,
            commands::list_installed_games,
            commands::uninstall_game,
            commands::fix_manifests_for_app,
            commands::fix_all_manifests,
            commands::check_for_update,
            commands::download_and_run_update,
            commands::dumper_login,
            commands::dumper_submit_guard,
            commands::dumper_status,
            commands::dumper_logout,
            commands::dumper_owned_games,
            commands::dumper_dump_app,
            commands::dumper_get_profile,
            commands::dumper_shutdown,
            commands::catalog_search,
            commands::catalog_install_lua,
            commands::catalog_is_installed,
            commands::patcher_diagnose,
            commands::patcher_apply_capcom,
            commands::patcher_apply_offline,
            commands::patcher_restore,
            commands::patcher_delete_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
