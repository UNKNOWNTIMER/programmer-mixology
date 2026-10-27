//! Owned, local-only recipe window with escaped React rendering and bounded payloads.
use serde_json::Value;
use std::sync::Mutex;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[derive(Default)]
pub struct RecipeWindowState(pub Mutex<Option<Value>>);
fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("仅主窗口可修改配料窗口".into())
    }
}

#[tauri::command]
pub fn recipe_window_position(app: tauri::AppHandle) -> Result<(), String> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    let Some(popup) = app.get_webview_window("recipe-details") else {
        return Ok(());
    };
    let p = main.outer_position().map_err(|e| e.to_string())?;
    let mut size = popup.outer_size().map_err(|e| e.to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let gap = (8.0 * scale) as i32;
    // Keep the whole independent menu to the left. Move the workbench inside the monitor
    // when it is too close to the edge, rather than clipping or overlaying the menu.
    let mut x = p.x - size.width as i32 - gap;
    let mut y = p.y + (170.0 * scale) as i32;
    if let Some(monitor) = main.current_monitor().map_err(|e| e.to_string())? {
        let work = monitor.work_area();
        let inner = popup.inner_size().map_err(|e| e.to_string())?;
        let main_size = main.outer_size().map_err(|e| e.to_string())?;
        let border_w = size.width.saturating_sub(inner.width);
        let border_h = size.height.saturating_sub(inner.height);
        let available_w = work
            .size
            .width
            .saturating_sub(main_size.width + gap as u32 + border_w);
        let desired_w = if available_w >= (240.0 * scale) as u32 {
            ((370.0 * scale) as u32).min(available_w)
        } else {
            inner.width
        };
        let desired_h = ((700.0 * scale) as u32).min(work.size.height.saturating_sub(border_h + 8));
        if inner.width != desired_w || inner.height != desired_h {
            popup
                .set_size(PhysicalSize::new(desired_w, desired_h))
                .map_err(|e| e.to_string())?;
            size = popup.outer_size().map_err(|e| e.to_string())?;
            x = p.x - size.width as i32 - gap;
        }
        y = y
            .max(work.position.y)
            .min(work.position.y + (work.size.height.saturating_sub(size.height)) as i32);
        if x < work.position.x {
            x = work.position.x;
            let new_x = x + size.width as i32 + gap;
            let main_size = main.outer_size().map_err(|e| e.to_string())?;
            if new_x + main_size.width as i32 <= work.position.x + work.size.width as i32 {
                main.set_position(PhysicalPosition::new(new_x, p.y))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    popup
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn recipe_window_update(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, RecipeWindowState>,
    payload: Option<Value>,
) -> Result<(), String> {
    main_only(&window)?;
    if payload
        .as_ref()
        .is_some_and(|v| v.to_string().len() > 262_144)
    {
        return Err("配料窗口资料过大".into());
    }
    *state.0.lock().map_err(|e| e.to_string())? = payload.clone();
    if payload.is_none() {
        if let Some(popup) = app.get_webview_window("recipe-details") {
            popup.hide().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    if let Some(popup) = app.get_webview_window("recipe-details") {
        popup
            .emit("recipe-window-data", &payload)
            .map_err(|e| e.to_string())?;
        recipe_window_position(app.clone())?;
        popup.show().map_err(|e| e.to_string())?;
    } else {
        let popup = WebviewWindowBuilder::new(
            &app,
            "recipe-details",
            WebviewUrl::App("index.html?view=recipe".into()),
        )
        .title("Programmer Mixology · Ingredients")
        .inner_size(370.0, 700.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .background_color(tauri::window::Color(3, 9, 13, 255))
        .parent(&window)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
        let _ = popup;
        recipe_window_position(app.clone())?;
    }
    Ok(())
}
#[tauri::command]
pub fn recipe_window_payload(
    window: WebviewWindow,
    state: tauri::State<'_, RecipeWindowState>,
) -> Result<Option<Value>, String> {
    if window.label() != "recipe-details" {
        return Err("仅配料窗口可读取".into());
    }
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}
#[tauri::command]
pub fn recipe_window_ready(
    window: WebviewWindow,
    state: tauri::State<'_, RecipeWindowState>,
) -> Result<(), String> {
    if window.label() != "recipe-details" {
        return Err("窗口无效".into());
    }
    if state.0.lock().map_err(|e| e.to_string())?.is_some() {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
