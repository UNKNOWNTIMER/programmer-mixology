//! Read-only, owned glass details. Coordinates returned to the workbench are always
//! CSS pixels relative to its client origin; native window positions are physical.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const LABEL: &str = "glass-details";
const WIDTH: f64 = 320.0;
const MAX_HEIGHT: f64 = 600.0;
const HEADER_CONNECTION: f64 = 22.0;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Composition,
    Facts,
    Profile,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Anchor {
    x: f64,
    y: f64,
    left_x: f64,
    right_x: f64,
    end_y: f64,
    preferred_side: Side,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    token: String,
    kind: Kind,
    recipe: Value,
    ingredients: Value,
    profile: Option<Value>,
    target: Option<Value>,
    #[serde(default = "default_language")]
    language: String,
    anchor: Anchor,
}
fn default_language() -> String {
    "en".into()
}
#[derive(Clone, Debug, Serialize)]
pub struct Placement {
    side: Side,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    end_x: f64,
    end_y: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    payload: Payload,
    placement: Placement,
}
#[derive(Default)]
struct Inner {
    snapshot: Option<Snapshot>,
    requested_height: f64,
    ready_token: Option<String>,
}
#[derive(Default)]
pub struct GlassWindowState(Mutex<Inner>);

fn token_valid(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 128
        && token
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
}
fn validate(payload: &Payload) -> Result<(), String> {
    if !token_valid(&payload.token)
        || !matches!(payload.language.as_str(), "zh" | "en")
        || !payload.recipe.is_object()
        || payload.ingredients.as_array().is_none_or(|a| a.len() > 512)
        || payload.profile.as_ref().is_some_and(|v| !v.is_object())
        || payload.target.as_ref().is_some_and(|v| !v.is_object())
        || serde_json::to_vec(payload)
            .map_err(|e| e.to_string())?
            .len()
            > 262_144
    {
        return Err("酒杯资料结构或大小无效".into());
    }
    let a = &payload.anchor;
    if [a.x, a.y, a.left_x, a.right_x, a.end_y]
        .iter()
        .any(|v| !v.is_finite() || v.abs() > 32_768.0)
        || a.left_x > a.x
        || a.right_x < a.x
    {
        return Err("酒杯资料锚点无效".into());
    }
    Ok(())
}
fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("仅主窗口可修改酒杯资料".into())
    }
}
fn popup_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == LABEL {
        Ok(())
    } else {
        Err("仅酒杯资料窗口可调用".into())
    }
}
pub fn popup_command_allowed(command: &str) -> bool {
    matches!(
        command,
        "glass_window_payload"
            | "glass_window_ready"
            | "glass_window_action"
            | "plugin:event|listen"
            | "plugin:event|unlisten"
    )
}

#[derive(Clone, Copy, Debug)]
struct WorkArea {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}
#[derive(Clone, Copy)]
struct Candidate {
    side: Side,
    edge: f64,
    available: f64,
    work: WorkArea,
}
fn candidate(a: &Anchor, side: Side, work: WorkArea, compact: bool) -> Candidate {
    // Both sides share the returned edge with the workbench's line. Even compact
    // placement keeps the panel outside the hotspot; no independent CSS flipping.
    let edge = match (side, compact) {
        (Side::Left, false) => a.left_x.min(a.x - 16.0),
        (Side::Right, false) => a.right_x.max(a.x + 16.0),
        (Side::Left, true) => (a.x - 16.0).min(work.right),
        (Side::Right, true) => (a.x + 16.0).max(work.left),
    };
    let available = match side {
        Side::Left if edge <= work.right => edge - work.left,
        Side::Right if edge >= work.left => work.right - edge,
        _ => 0.0,
    }
    .max(0.0);
    Candidate {
        side,
        edge,
        available,
        work,
    }
}
fn calculate(
    a: &Anchor,
    left: WorkArea,
    right: WorkArea,
    height: f64,
    popup_to_main_scale: f64,
) -> Result<Placement, String> {
    if !popup_to_main_scale.is_finite() || popup_to_main_scale <= 0.0 {
        return Err("酒杯资料显示比例无效".into());
    }
    // The header is 44 CSS px in the popup, not in the workbench. Convert its
    // center before placing the panel so a mixed-DPI monitor cannot detach the line.
    let connection = HEADER_CONNECTION * popup_to_main_scale;
    let left_full = candidate(a, Side::Left, left, false);
    let right_full = candidate(a, Side::Right, right, false);
    let (preferred, alternate) = if a.preferred_side == Side::Left {
        (left_full, right_full)
    } else {
        (right_full, left_full)
    };
    let selected = if preferred.available >= WIDTH {
        preferred
    } else if alternate.available >= WIDTH {
        alternate
    } else {
        let l = candidate(a, Side::Left, left, true);
        let r = candidate(a, Side::Right, right, true);
        if l.available > r.available
            || (l.available == r.available && a.preferred_side == Side::Left)
        {
            l
        } else {
            r
        }
    };
    if selected.available < 1.0 || selected.work.bottom <= selected.work.top {
        return Err("当前屏幕工作区没有可展示酒杯资料的空间".into());
    }
    let width = WIDTH.min(selected.available);
    let height = height
        .max(connection * 2.0)
        .min(MAX_HEIGHT)
        .min(selected.work.bottom - selected.work.top);
    let y = (a.end_y - connection).clamp(selected.work.top, selected.work.bottom - height);
    let x = if selected.side == Side::Left {
        selected.edge - width
    } else {
        selected.edge
    };
    Ok(Placement {
        side: selected.side,
        x,
        y,
        width,
        height,
        end_x: selected.edge,
        end_y: y + connection.min(height / 2.0),
    })
}
fn work_area(
    main: &WebviewWindow,
    origin: PhysicalPosition<i32>,
    scale: f64,
    x: f64,
    y: f64,
) -> Result<WorkArea, String> {
    let monitor = main
        .monitor_from_point(origin.x as f64 + x * scale, origin.y as f64 + y * scale)
        .map_err(|e| e.to_string())?
        .or(main.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("无法读取显示器工作区")?;
    let area = monitor.work_area();
    Ok(WorkArea {
        left: (area.position.x as f64 - origin.x as f64) / scale,
        top: (area.position.y as f64 - origin.y as f64) / scale,
        right: (area.position.x as f64 + area.size.width as f64 - origin.x as f64) / scale,
        bottom: (area.position.y as f64 + area.size.height as f64 - origin.y as f64) / scale,
    })
}
fn native_rect(
    p: &Placement,
    origin: PhysicalPosition<i32>,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    (
        PhysicalPosition::new(
            (origin.x as f64 + p.x * scale).round() as i32,
            (origin.y as f64 + p.y * scale).round() as i32,
        ),
        PhysicalSize::new(
            (p.width * scale).floor().max(1.0) as u32,
            (p.height * scale).floor().max(1.0) as u32,
        ),
    )
}
fn round_placement(
    mut p: Placement,
    origin: PhysicalPosition<i32>,
    scale: f64,
    popup_scale: f64,
) -> Placement {
    // Return rounded native geometry rather than a second approximate line anchor.
    let (position, size) = native_rect(&p, origin, scale);
    p.x = (position.x - origin.x) as f64 / scale;
    p.y = (position.y - origin.y) as f64 / scale;
    p.width = size.width as f64 / scale;
    p.height = size.height as f64 / scale;
    p.end_x = if p.side == Side::Left {
        p.x + p.width
    } else {
        p.x
    };
    p.end_y = p.y + (HEADER_CONNECTION * popup_scale / scale).min(p.height / 2.0);
    p
}
fn positioned(app: &tauri::AppHandle, payload: Payload, height: f64) -> Result<Snapshot, String> {
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    let origin = main.inner_position().map_err(|e| e.to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    // Query the actual popup again on every move/DPI/ready pass. Its scale can
    // differ from the main window, and changes after crossing a monitor boundary.
    let popup_scale = match app.get_webview_window(LABEL) {
        Some(popup) => popup.scale_factor().map_err(|e| e.to_string())?,
        None => scale, // Initial positioning is hidden; ready re-queries the created window.
    };
    let a = &payload.anchor;
    let left = work_area(&main, origin, scale, a.left_x, a.end_y)?;
    let right = work_area(&main, origin, scale, a.right_x, a.end_y)?;
    let p = calculate(a, left, right, height, popup_scale / scale)?;
    let p = round_placement(p, origin, scale, popup_scale);
    Ok(Snapshot {
        payload,
        placement: p,
    })
}
fn present(
    app: &tauri::AppHandle,
    snapshot: &Snapshot,
    ready: bool,
    notify_popup: bool,
) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    if let Some(popup) = app.get_webview_window(LABEL) {
        let origin = main.inner_position().map_err(|e| e.to_string())?;
        let scale = main.scale_factor().map_err(|e| e.to_string())?;
        let (position, size) = native_rect(&snapshot.placement, origin, scale);
        if popup.inner_size().map_err(|e| e.to_string())? != size {
            popup.set_size(size).map_err(|e| e.to_string())?;
        }
        if popup.inner_position().map_err(|e| e.to_string())? != position {
            popup.set_position(position).map_err(|e| e.to_string())?;
        }
        if notify_popup {
            popup
                .emit("glass-window-data", snapshot)
                .map_err(|e| e.to_string())?;
        }
        if ready
            && main.is_visible().map_err(|e| e.to_string())?
            && !main.is_minimized().map_err(|e| e.to_string())?
        {
            if !popup.is_visible().map_err(|e| e.to_string())? {
                popup.show().map_err(|e| e.to_string())?;
            }
        } else {
            if popup.is_visible().map_err(|e| e.to_string())? {
                popup.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    app.emit_to("main", "glass-window-position", snapshot)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn glass_window_update(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, GlassWindowState>,
    payload: Option<Payload>,
) -> Result<Option<Snapshot>, String> {
    main_only(&window)?;
    let Some(payload) = payload else {
        *state.0.lock().map_err(|e| e.to_string())? = Inner::default();
        if let Some(popup) = app.get_webview_window(LABEL) {
            popup.hide().map_err(|e| e.to_string())?;
        }
        return Ok(None);
    };
    validate(&payload)?;
    let (height, mut ready) = {
        let state = state.0.lock().map_err(|e| e.to_string())?;
        let same = state
            .snapshot
            .as_ref()
            .is_some_and(|s| s.payload.token == payload.token);
        (
            if same { state.requested_height } else { 300.0 },
            state.ready_token.as_ref() == Some(&payload.token),
        )
    };
    let snapshot = positioned(&app, payload, height)?;
    {
        let mut state = state.0.lock().map_err(|e| e.to_string())?;
        state.snapshot = Some(snapshot.clone());
        state.requested_height = height;
        if !ready {
            state.ready_token = None;
        }
    }
    if app.get_webview_window(LABEL).is_none() {
        ready = false;
        state.0.lock().map_err(|e| e.to_string())?.ready_token = None;
        WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?view=glass".into()))
            .title("Programmer Mixology · Glass details")
            .inner_size(WIDTH, 300.0)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .background_color(tauri::window::Color(3, 9, 13, 255))
            .parent(&window)
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
    }
    present(&app, &snapshot, ready, true)?;
    Ok(Some(snapshot))
}
#[tauri::command]
pub fn glass_window_payload(
    window: WebviewWindow,
    state: tauri::State<'_, GlassWindowState>,
) -> Result<Option<Snapshot>, String> {
    popup_only(&window)?;
    Ok(state.0.lock().map_err(|e| e.to_string())?.snapshot.clone())
}
#[tauri::command]
pub fn glass_window_ready(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, GlassWindowState>,
    token: String,
    height: f64,
) -> Result<Option<Snapshot>, String> {
    popup_only(&window)?;
    if !height.is_finite() || !(1.0..=32_768.0).contains(&height) {
        return Err("酒杯资料内容高度无效".into());
    }
    let payload = {
        let state = state.0.lock().map_err(|e| e.to_string())?;
        state
            .snapshot
            .as_ref()
            .filter(|s| s.payload.token == token)
            .map(|s| s.payload.clone())
    };
    let Some(payload) = payload else {
        return Ok(None);
    }; // A late font/resize result cannot reopen an old card.
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    let height = height * window.scale_factor().map_err(|e| e.to_string())?
        / main.scale_factor().map_err(|e| e.to_string())?;
    let snapshot = positioned(&app, payload, height)?;
    {
        let mut state = state.0.lock().map_err(|e| e.to_string())?;
        if state
            .snapshot
            .as_ref()
            .is_none_or(|s| s.payload.token != token)
        {
            return Ok(None);
        }
        state.snapshot = Some(snapshot.clone());
        state.requested_height = height;
        state.ready_token = Some(token);
    }
    // The popup measures each new payload. Do not echo ready back as another
    // data event, which would start a measure/ready/data feedback loop.
    present(&app, &snapshot, true, false)?;
    Ok(Some(snapshot))
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Enter,
    Leave,
    Close,
}
#[tauri::command]
pub fn glass_window_action(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, GlassWindowState>,
    token: String,
    kind: Action,
) -> Result<(), String> {
    popup_only(&window)?;
    {
        let mut state = state.0.lock().map_err(|e| e.to_string())?;
        if state
            .snapshot
            .as_ref()
            .is_none_or(|s| s.payload.token != token)
        {
            return Err("酒杯资料会话已过期".into());
        }
        if matches!(kind, Action::Close) {
            *state = Inner::default();
        }
    }
    let kind = match kind {
        Action::Enter => "enter",
        Action::Leave => "leave",
        Action::Close => {
            window.hide().map_err(|e| e.to_string())?;
            "close"
        }
    };
    app.emit_to(
        "main",
        "glass-window-action",
        json!({"token":token,"kind":kind}),
    )
    .map_err(|e| e.to_string())
}

fn reposition(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<GlassWindowState>() else {
        return Ok(());
    };
    let Some((old, height, ready)) = ({
        let state = state.0.lock().map_err(|e| e.to_string())?;
        state.snapshot.clone().map(|s| {
            let ready = state.ready_token.as_ref() == Some(&s.payload.token);
            (s, state.requested_height, ready)
        })
    }) else {
        return Ok(());
    };
    let snapshot = positioned(app, old.payload, height)?;
    {
        let mut state = state.0.lock().map_err(|e| e.to_string())?;
        if state
            .snapshot
            .as_ref()
            .is_none_or(|s| s.payload.token != snapshot.payload.token)
        {
            return Ok(());
        }
        state.snapshot = Some(snapshot.clone());
    }
    present(app, &snapshot, ready, true)
}
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == LABEL {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
            if let Some(state) = window.try_state::<GlassWindowState>() {
                if let Ok(mut state) = state.0.lock() {
                    let token = state.snapshot.take().map(|s| s.payload.token);
                    *state = Inner::default();
                    drop(state);
                    if let Some(token) = token {
                        let _ = window.app_handle().emit_to(
                            "main",
                            "glass-window-action",
                            json!({"token":token,"kind":"close"}),
                        );
                    }
                }
            }
            return;
        }
    }
    let main_event = window.label() == "main"
        && matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
                | tauri::WindowEvent::Focused(_)
        );
    let popup_dpi =
        window.label() == LABEL && matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. });
    if main_event || popup_dpi {
        let app = window.app_handle().clone();
        // Re-query after the native event so scale and client-origin belong to the same frame.
        let target = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = reposition(&target);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_payload_without_language_defaults_to_english_and_preserves_explicit_choices() {
        let mut value = json!({
            "token": "TEST-language-1",
            "kind": "facts",
            "recipe": {},
            "ingredients": [],
            "profile": null,
            "target": null,
            "anchor": {
                "x": 550.0, "y": 400.0, "left_x": 450.0,
                "right_x": 650.0, "end_y": 366.0, "preferred_side": "right"
            }
        });
        let legacy: Payload = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(legacy.language, "en");
        assert!(validate(&legacy).is_ok());
        for language in ["zh", "en"] {
            value["language"] = json!(language);
            let explicit: Payload = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(explicit.language, language);
            assert!(validate(&explicit).is_ok());
        }
        value["language"] = json!("unsupported");
        let invalid: Payload = serde_json::from_value(value).unwrap();
        assert!(validate(&invalid).is_err());
    }
    fn anchor(side: Side) -> Anchor {
        Anchor {
            x: 550.0,
            y: 400.0,
            left_x: 450.0,
            right_x: 650.0,
            end_y: 366.0,
            preferred_side: side,
        }
    }
    fn work() -> WorkArea {
        WorkArea {
            left: 0.0,
            top: 0.0,
            right: 1200.0,
            bottom: 900.0,
        }
    }
    fn check(p: &Placement, a: &Anchor, w: WorkArea) {
        assert!(
            p.x >= w.left && p.y >= w.top && p.x + p.width <= w.right && p.y + p.height <= w.bottom
        );
        match p.side {
            Side::Left => {
                assert_eq!(p.end_x, p.x + p.width);
                assert!(p.end_x < a.x);
            }
            Side::Right => {
                assert_eq!(p.end_x, p.x);
                assert!(p.end_x > a.x);
            }
        }
        assert_eq!(p.end_y, p.y + HEADER_CONNECTION.min(p.height / 2.0));
    }
    #[test]
    fn preferred_sides_and_connection_points_are_consistent() {
        for side in [Side::Left, Side::Right] {
            let a = anchor(side);
            let p = calculate(&a, work(), work(), 300.0, 1.0).unwrap();
            assert_eq!(p.side, side);
            assert_eq!(p.width, WIDTH);
            check(&p, &a, work());
        }
    }
    #[test]
    fn screen_edge_flips_panel_and_connector_together() {
        let a = Anchor {
            right_x: 1190.0,
            x: 1100.0,
            left_x: 1020.0,
            ..anchor(Side::Right)
        };
        let p = calculate(&a, work(), work(), 700.0, 1.0).unwrap();
        assert_eq!(p.side, Side::Left);
        assert_eq!(p.height, 600.0);
        check(&p, &a, work());
    }
    #[test]
    fn compact_work_area_shrinks_without_covering_hotspot() {
        let w = WorkArea {
            left: 400.0,
            top: 100.0,
            right: 700.0,
            bottom: 600.0,
        };
        let a = anchor(Side::Right);
        let p = calculate(&a, w, w, 600.0, 1.0).unwrap();
        assert!(p.width < WIDTH);
        check(&p, &a, w);
    }
    #[test]
    fn negative_monitor_coordinates_and_taskbar_are_respected() {
        let w = WorkArea {
            left: -1800.0,
            top: -400.0,
            right: 0.0,
            bottom: 560.0,
        };
        let a = Anchor {
            x: -700.0,
            y: 510.0,
            left_x: -800.0,
            right_x: -600.0,
            end_y: 476.0,
            preferred_side: Side::Right,
        };
        let p = calculate(&a, w, w, 600.0, 1.0).unwrap();
        check(&p, &a, w);
        assert_eq!(p.y + p.height, w.bottom);
    }
    #[test]
    fn physical_positions_follow_main_client_origin_at_fractional_dpi() {
        let p = calculate(&anchor(Side::Left), work(), work(), 300.0, 1.0).unwrap();
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let (position, size) = native_rect(&p, PhysicalPosition::new(-1900, 123), scale);
            assert_eq!(position.x, (-1900.0 + p.x * scale).round() as i32);
            assert_eq!(position.y, (123.0 + p.y * scale).round() as i32);
            assert_eq!(size.width, (WIDTH * scale) as u32);
        }
    }
    #[test]
    fn mixed_dpi_connector_matches_actual_popup_header_after_native_rounding() {
        let origin = PhysicalPosition::new(-1901, 127);
        for (main_scale, popup_scale) in [(1.0, 1.5), (1.5, 1.0), (1.25, 1.5), (2.0, 1.25)] {
            for side in [Side::Left, Side::Right] {
                let a = anchor(side);
                let p = calculate(&a, work(), work(), 300.0, popup_scale / main_scale).unwrap();
                let p = round_placement(p, origin, main_scale, popup_scale);
                let (position, size) = native_rect(&p, origin, main_scale);
                let line_screen_y = origin.y as f64 + p.end_y * main_scale;
                let actual_header_screen_y = position.y as f64 + HEADER_CONNECTION * popup_scale;
                assert!((line_screen_y - actual_header_screen_y).abs() < 0.000_001);
                let line_screen_x = origin.x as f64 + p.end_x * main_scale;
                let panel_edge = position.x as f64
                    + if side == Side::Left {
                        size.width as f64
                    } else {
                        0.0
                    };
                assert!((line_screen_x - panel_edge).abs() < 0.000_001);
            }
        }
    }
    #[test]
    fn popup_dpi_refresh_repositions_header_and_preserves_work_area_clamping() {
        let a = anchor(Side::Right);
        let before = calculate(&a, work(), work(), 300.0, 1.0).unwrap();
        let after = calculate(&a, work(), work(), 300.0, 1.5).unwrap();
        assert_eq!(before.end_y, after.end_y);
        assert_eq!(before.y - after.y, 11.0);
        let near_bottom = Anchor { end_y: 875.0, ..a };
        let constrained = calculate(&near_bottom, work(), work(), 600.0, 1.5).unwrap();
        assert_eq!(constrained.y + constrained.height, work().bottom);
        assert_eq!(constrained.end_y - constrained.y, 33.0);
        for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(calculate(&near_bottom, work(), work(), 300.0, invalid).is_err());
        }
    }
    #[test]
    fn payload_bounds_and_readonly_command_boundary() {
        let mut payload = Payload {
            token: "TEST-detail-1".into(),
            kind: Kind::Facts,
            recipe: json!({}),
            ingredients: json!([]),
            profile: None,
            target: None,
            language: "zh".into(),
            anchor: anchor(Side::Right),
        };
        assert!(validate(&payload).is_ok());
        payload.anchor.x = f64::NAN;
        assert!(validate(&payload).is_err());
        payload.anchor = anchor(Side::Right);
        payload.recipe = json!({"text":"x".repeat(262_144)});
        assert!(validate(&payload).is_err());
        for command in [
            "host_call",
            "model_start",
            "archive_import",
            "glass_window_update",
            "ui_state_get",
            "plugin:event|emit_to",
        ] {
            assert!(!popup_command_allowed(command));
        }
        for command in [
            "glass_window_payload",
            "glass_window_ready",
            "glass_window_action",
            "plugin:event|listen",
            "plugin:event|unlisten",
        ] {
            assert!(popup_command_allowed(command));
        }
    }
}
