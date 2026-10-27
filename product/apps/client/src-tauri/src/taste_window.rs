//! Read-only, cursor-transparent taste composition window. It cannot mutate targets.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
const LABEL: &str = "taste-preview";
const WIDTH: f64 = 400.0;
const HEIGHT: f64 = 330.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    token: String,
    taste: [u16; 5],
    language: String,
    anchor_y: f64,
}
#[derive(Default)]
struct Inner {
    payload: Option<Payload>,
    ready: Option<String>,
}
#[derive(Default)]
pub struct TasteWindowState(Mutex<Inner>);
fn validate(p: &Payload) -> Result<(), String> {
    if p.token.is_empty()
        || p.token.len() > 128
        || !p
            .token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        || p.taste.iter().map(|n| *n as u32).sum::<u32>() != 10000
        || !matches!(p.language.as_str(), "zh" | "en")
        || !p.anchor_y.is_finite()
        || !(0.0..=32768.0).contains(&p.anchor_y)
    {
        return Err("味觉预览参数无效".into());
    }
    Ok(())
}
pub fn popup_command_allowed(command: &str) -> bool {
    matches!(
        command,
        "taste_window_payload"
            | "taste_window_ready"
            | "plugin:event|listen"
            | "plugin:event|unlisten"
    )
}
fn only(window: &WebviewWindow, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err("当前窗口没有味觉预览命令权限".into())
    }
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
fn placement(main: Rect, work: Rect, anchor_y: f64, scale: f64, popup_scale: f64) -> Rect {
    let w = (WIDTH * popup_scale).min(work.w);
    let h = (HEIGHT * popup_scale).min(work.h);
    // Prefer the requested right exterior; at a screen edge clamp inside the visible work area.
    Rect {
        x: (main.x + main.w + 12.0 * scale).clamp(work.x, work.x + work.w - w),
        y: (main.y + anchor_y * scale - h / 2.0).clamp(work.y, work.y + work.h - h),
        w,
        h,
    }
}
fn present(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    let Some(popup) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let (payload, ready) = {
        let state = app.state::<TasteWindowState>();
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        (inner.payload.clone(), inner.ready.clone())
    };
    let Some(payload) = payload else {
        popup.hide().map_err(|e| e.to_string())?;
        return Ok(());
    };
    let position = main.inner_position().map_err(|e| e.to_string())?;
    let size = main.inner_size().map_err(|e| e.to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let monitor = main
        .monitor_from_point(
            position.x as f64 + size.width as f64 + 12.0 * scale,
            position.y as f64 + payload.anchor_y * scale,
        )
        .map_err(|e| e.to_string())?
        .or(main.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("没有可用显示器")?;
    let area = monitor.work_area();
    let r = placement(
        Rect {
            x: position.x as f64,
            y: position.y as f64,
            w: size.width as f64,
            h: size.height as f64,
        },
        Rect {
            x: area.position.x as f64,
            y: area.position.y as f64,
            w: area.size.width as f64,
            h: area.size.height as f64,
        },
        payload.anchor_y,
        scale,
        popup.scale_factor().map_err(|e| e.to_string())?,
    );
    let pos = PhysicalPosition::new(r.x.round() as i32, r.y.round() as i32);
    let sz = PhysicalSize::new(r.w.floor().max(1.0) as u32, r.h.floor().max(1.0) as u32);
    if popup.inner_position().map_err(|e| e.to_string())? != pos {
        popup.set_position(pos).map_err(|e| e.to_string())?;
    }
    if popup.inner_size().map_err(|e| e.to_string())? != sz {
        popup.set_size(sz).map_err(|e| e.to_string())?;
    }
    if ready.as_ref() == Some(&payload.token)
        && main.is_visible().map_err(|e| e.to_string())?
        && !main.is_minimized().map_err(|e| e.to_string())?
        && main.is_focused().map_err(|e| e.to_string())?
    {
        if !popup.is_visible().map_err(|e| e.to_string())? {
            popup.show().map_err(|e| e.to_string())?;
        }
    } else {
        popup.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn taste_window_update(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, TasteWindowState>,
    payload: Option<Payload>,
) -> Result<(), String> {
    only(&window, "main")?;
    if let Some(p) = &payload {
        validate(p)?;
    }
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if inner.payload.as_ref().map(|p| &p.token) != payload.as_ref().map(|p| &p.token) {
            inner.ready = None;
        }
        inner.payload = payload.clone();
    }
    if payload.is_some() && app.get_webview_window(LABEL).is_none() {
        let popup =
            WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?view=taste".into()))
                .title("TIMER · 味觉构成")
                .inner_size(WIDTH, HEIGHT)
                .decorations(false)
                .shadow(false)
                .resizable(false)
                .maximizable(false)
                .skip_taskbar(true)
                .visible(false)
                .focused(false)
                .focusable(false)
                .background_color(tauri::window::Color(5, 13, 17, 255))
                .parent(&window)
                .map_err(|e| e.to_string())?
                .build()
                .map_err(|e| e.to_string())?;
        popup
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }
    if let Some(popup) = app.get_webview_window(LABEL) {
        popup
            .emit("taste-window-data", payload)
            .map_err(|e| e.to_string())?;
    }
    present(&app)
}
#[tauri::command]
pub fn taste_window_payload(
    window: WebviewWindow,
    state: tauri::State<'_, TasteWindowState>,
) -> Result<Option<Payload>, String> {
    only(&window, LABEL)?;
    Ok(state.0.lock().map_err(|e| e.to_string())?.payload.clone())
}
#[tauri::command]
pub fn taste_window_ready(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, TasteWindowState>,
    token: String,
) -> Result<(), String> {
    only(&window, LABEL)?;
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if inner.payload.as_ref().is_none_or(|p| p.token != token) {
            return Ok(());
        }
        inner.ready = Some(token);
    }
    present(&app)
}
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "main" {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            if let Some(popup) = window.app_handle().get_webview_window(LABEL) {
                let _ = popup.hide();
            }
            // Preserve the active token/ready handshake across Alt-Tab. The
            // preview remains hidden while unfocused; a real region leave still
            // clears its payload through taste_window_update(None).
        } else if matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Focused(true)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            let app = window.app_handle().clone();
            let target = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = present(&target);
            });
        }
    }
    if window.label() == LABEL && matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
        let app = window.app_handle().clone();
        let target = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = present(&target);
        });
    }
    if window.label() == LABEL {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
            if let Some(state) = window.try_state::<TasteWindowState>() {
                if let Ok(mut inner) = state.0.lock() {
                    *inner = Inner::default();
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_read_only_payload() {
        let mut p = Payload {
            token: "test-1".into(),
            taste: [2000; 5],
            language: "zh".into(),
            anchor_y: 600.0,
        };
        assert!(validate(&p).is_ok());
        p.taste[0] = 2001;
        assert!(validate(&p).is_err());
        p.taste = [2000; 5];
        p.anchor_y = f64::NAN;
        assert!(validate(&p).is_err());
        p.anchor_y = 500.0;
        p.language = "html".into();
        assert!(validate(&p).is_err());
        for c in [
            "ui_state_set",
            "host_call",
            "archive_import",
            "taste_window_update",
            "plugin:event|emit_to",
        ] {
            assert!(!popup_command_allowed(c));
        }
    }
    #[test]
    fn outside_right_when_space_and_clamped_at_edge() {
        let work = Rect {
            x: 0.0,
            y: 0.0,
            w: 1920.0,
            h: 1040.0,
        };
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let main = Rect {
                x: 100.0,
                y: 30.0,
                w: 675.0,
                h: 900.0,
            };
            let p = placement(main, work, 600.0, scale, scale);
            assert!(p.x >= main.x + main.w);
            assert!(p.x + p.w <= work.w && p.y + p.h <= work.h);
        }
        let p = placement(
            Rect {
                x: 1250.0,
                y: 0.0,
                w: 675.0,
                h: 960.0,
            },
            work,
            900.0,
            1.0,
            1.0,
        );
        assert_eq!(p.x + p.w, 1920.0);
        assert!(p.y + p.h <= 1040.0);
    }
    #[test]
    fn negative_monitor_and_narrow_work_area() {
        let work = Rect {
            x: -1920.0,
            y: -100.0,
            w: 1920.0,
            h: 1080.0,
        };
        let p = placement(
            Rect {
                x: -1700.0,
                y: 0.0,
                w: 675.0,
                h: 960.0,
            },
            work,
            600.0,
            1.25,
            1.5,
        );
        assert!(p.x >= -1025.0 && p.x + p.w <= 0.0);
        let p = placement(
            Rect {
                x: 0.0,
                y: 0.0,
                w: 675.0,
                h: 960.0,
            },
            Rect {
                x: 0.0,
                y: 0.0,
                w: 320.0,
                h: 280.0,
            },
            600.0,
            1.0,
            1.0,
        );
        assert_eq!((p.x, p.y, p.w, p.h), (0.0, 0.0, 320.0, 280.0));
    }
}
