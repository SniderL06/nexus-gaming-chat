use tauri_plugin_updater::UpdaterExt;
use tauri::Emitter;

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
  app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Verificación automática de actualizaciones en segundo plano (Desktop)
      #[cfg(desktop)]
      {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          // Esperar 4 segundos tras arrancar para que la interfaz web ya esté visible
          tokio::time::sleep(std::time::Duration::from_secs(4)).await;
          check_and_apply_updates(handle).await;
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![restart_app])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[cfg(desktop)]
async fn check_and_apply_updates(app: tauri::AppHandle) {
  if let Ok(updater) = app.updater() {
    match updater.check().await {
      Ok(Some(update)) => {
        log::info!("Nueva actualización encontrada: v{}", update.version);
        let _ = app.emit("nexus:update-available", serde_json::json!({
          "version": update.version,
          "body": update.body.clone().unwrap_or_default()
        }));

        let mut downloaded = 0;
        let app_handle = app.clone();
        let install_result = update.download_and_install(
          move |chunk_length, content_length| {
            downloaded += chunk_length;
            let percent = content_length.map(|total| (downloaded as f64 / total as f64) * 100.0).unwrap_or(0.0);
            let _ = app_handle.emit("nexus:update-progress", serde_json::json!({
              "downloaded": downloaded,
              "total": content_length,
              "percent": percent
            }));
          },
          || {
            log::info!("Descarga completada, aplicando actualización...");
          }
        ).await;

        match install_result {
          Ok(()) => {
            log::info!("Actualización instalada con éxito.");
            let _ = app.emit("nexus:update-ready", serde_json::json!({
              "version": update.version
            }));
          }
          Err(e) => {
            log::error!("Error al descargar o instalar la actualización: {}", e);
          }
        }
      }
      Ok(None) => {
        log::info!("Nexus está en su versión más reciente.");
      }
      Err(e) => {
        log::warn!("No se pudo comprobar actualizaciones: {}", e);
      }
    }
  }
}

