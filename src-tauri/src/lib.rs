mod appinfo;
mod commands;
mod imgcache;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .register_asynchronous_uri_scheme_protocol("veilimg", |_ctx, request, responder| {
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                responder.respond(imgcache::serve(&path).await);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::get_app_config,
            commands::config::save_app_config,
            commands::config::resolve_dump_path,
            commands::steam::get_steam_path,
            commands::steam::check_steam_running,
            commands::steam::start_steam,
            commands::steam::stop_steam,
            commands::steam::kill_steam,
            commands::steam::restart_steam,
            commands::steam::launch_game_steam,
            commands::library::list_installed_games,
            commands::library::launch_game_direct,
            commands::library::get_apps_meta,
            commands::library::remove_manifest,
            commands::library::uninstall_game,
            commands::library::uninstall_dlc,
            commands::library::open_library_folder,
            commands::system::open_folder,
            commands::system::open_url,
            commands::system::mark_main_ready,
            commands::system::is_main_ready,
            commands::catalog::catalog_search,
            commands::catalog::catalog_trending,
            commands::catalog::catalog_details,
            commands::catalog::catalog_install,
            commands::catalog::catalog_install_at,
            commands::catalog::catalog_install_selection,
            commands::catalog::catalog_list_versions,
            commands::install::install_manifest_paths,
            commands::fix::fix_library_manifests,
            commands::patcher::patcher_diagnose,
            commands::patcher::patcher_apply_capcom,
            commands::patcher::patcher_apply_offline,
            commands::patcher::patcher_restore,
            commands::gamingservices::gs_list_tools,
            commands::gamingservices::gs_download_tool,
            commands::gamingservices::gs_run_tool,
            commands::gamingservices::gs_installed_version,
            commands::bypasses::bypass_info,
            commands::bypasses::bypass_check,
            commands::bypasses::bypass_install,
            commands::bypasses::bypass_remove,
            commands::bypasses::bypass_set_launch_options,
            commands::dumper::dumper_login,
            commands::dumper::dumper_submit_guard,
            commands::dumper::dumper_status,
            commands::dumper::dumper_logout,
            commands::dumper::dumper_owned_games,
            commands::dumper::dumper_dump_app,
            commands::dumper::dumper_get_profile,
            commands::dumper::dumper_shutdown,
            commands::veil::ensure_veil_dll,
            commands::veil::remove_veil_dll,
            commands::veil::verify_veil_dll,
            commands::cloudsave::cloud_saves_status,
            commands::cloudsave::cloud_saves_ensure,
            commands::cloudsave::cloud_saves_set_folder,
            commands::cloudsave::cloud_saves_enable,
            commands::cloudsave::cloud_saves_disable,
            commands::cloudsave::cloud_saves_set_logging,
            commands::cloudsave::cloud_saves_backup,
            commands::cloudsave::cloud_saves_import,
            commands::onlinefix::online_fix_cached,
            commands::onlinefix::online_fix_fetch,
            commands::reset::reset_steam_install,
            commands::updater::check_for_update,
            commands::updater::download_and_run_update,
            commands::updater::app_version,
            imgcache::prune_image_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
