mod dst;

use dst::{parse_dst, Pattern};
use std::fs;

/// Tauri command to parse a DST file and return the pattern data
#[tauri::command]
fn parse_dst_file(path: String) -> Result<Pattern, String> {
    // Read the file
    let data = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse the DST data
    let pattern = parse_dst(&data).map_err(|e| format!("Failed to parse DST: {}", e))?;

    Ok(pattern)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![parse_dst_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
