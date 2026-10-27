use pixelmix_catalog::Catalog;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
mod archive;
mod archive_clipboard;
mod dlc;
mod glass_window;
mod host_commands;
mod model_commands;
mod network_commands;
mod personal_ingredients;
mod recipe_library;
mod recipe_window;
mod taste_window;

struct AppState {
    catalog: Mutex<Option<Catalog>>,
    startup_error: Option<String>,
    data_dir: PathBuf,
    model: Arc<model_commands::ModelController>,
    network: Arc<network_commands::NetworkController>,
    archive_access: archive::ArchiveAccess,
}

fn with_catalog<T>(
    state: &AppState,
    f: impl FnOnce(&Catalog) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state
        .catalog
        .lock()
        .map_err(|_| "数据库锁异常，请重启并恢复备份".to_string())?;
    let db = guard.as_ref().ok_or_else(|| {
        state
            .startup_error
            .clone()
            .unwrap_or_else(|| "数据库尚未初始化".into())
    })?;
    f(db)
}

#[tauri::command]
fn catalog(state: tauri::State<AppState>) -> Result<Value, String> {
    with_catalog(&state, |db| {
        dlc::extend_catalog(personal_ingredients::extend_catalog(
            db.catalog_json().map_err(|e| e.to_string())?,
        )?)
    })
}
#[tauri::command]
fn ui_state_get(state: tauri::State<AppState>) -> Result<Option<Value>, String> {
    with_catalog(&state, |db| {
        db.load_setting("ui_state").map_err(|e| e.to_string())
    })
}
#[tauri::command]
fn recipe_library_get(state: tauri::State<AppState>) -> Result<recipe_library::LibraryState, String> {
    with_catalog(&state, recipe_library::get)
}
#[tauri::command]
fn recipe_library_apply(
    request: recipe_library::LibraryRequest,
    state: tauri::State<AppState>,
) -> Result<recipe_library::LibraryState, String> {
    with_catalog(&state, |db| recipe_library::apply(db, request))
}
#[tauri::command]
async fn recipe_library_import(
    request: recipe_library::ImportRequest,
    state: tauri::State<'_, AppState>,
) -> Result<recipe_library::ImportResult, String> {
    with_catalog(&state, |db| {
        recipe_library::check_revision(db, request.expected_revision)
    })?;
    let path = PathBuf::from(request.path);
    state.archive_access.authorize(&path, &state.data_dir)?;
    let decoded = tauri::async_runtime::spawn_blocking(move || archive::read(&path))
        .await
        .map_err(|e| e.to_string())??;
    with_catalog(&state, |db| {
        recipe_library::import_validated_archive(db, request.expected_revision, decoded)
    })
}
#[tauri::command]
fn ui_state_set(value: Value, state: tauri::State<AppState>) -> Result<(), String> {
    if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 1_048_576 {
        return Err("设置超出1 MiB上限".into());
    }
    if let Some(target) = value.get("target") {
        let taste: [u16; 5] = serde_json::from_value(target["taste_bps"].clone())
            .map_err(|_| "五味必须是五个整数基点".to_string())?;
        if taste.iter().map(|&x| x as u32).sum::<u32>() != 10000 {
            return Err("五味必须合计10000基点".into());
        }
        let sensory: [f64; 7] = serde_json::from_value(target["sensory_0_10"].clone())
            .map_err(|_| "七维必须包含7个数值".to_string())?;
        if sensory
            .iter()
            .any(|x| !x.is_finite() || !(0.0..=10.0).contains(x))
        {
            return Err("七维数值须为0至10".into());
        }
    }
    with_catalog(&state, |db| {
        db.save_setting("ui_state", &value)
            .map_err(|e| e.to_string())
    })
}
#[tauri::command]
fn taste_adjust(
    anchor: [u16; 5],
    axis: usize,
    requested: i32,
    locked: Vec<usize>,
) -> Result<[u16; 5], String> {
    pixelmix_domain::redistribute_bps(anchor, axis, requested, &locked).map_err(|e| e.to_string())
}
#[tauri::command]
async fn generate_trial(
    request: Value,
    use_model: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    if request.to_string().len() > 131_072 {
        return Err("生成输入超出128 KiB上限".into());
    }
    let controller = Arc::clone(&state.model);
    tauri::async_runtime::spawn_blocking(move || {
        controller.generate(request, use_model.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn model_start(
    config: pixelmix_inference::LocalModelConfig,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let controller = Arc::clone(&state.model);
    tauri::async_runtime::spawn_blocking(move || controller.start(config))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn model_status(state: tauri::State<AppState>) -> Value {
    state.model.status()
}
#[tauri::command]
fn model_stop(state: tauri::State<AppState>) {
    state.model.stop()
}
#[tauri::command]
async fn network_host_start(
    session: String,
    address: String,
    explicitly_enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let network = Arc::clone(&state.network);
    let path = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        network.start_host(path, session, address, explicitly_enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn network_host_status(state: tauri::State<AppState>) -> Value {
    state.network.host_status()
}
#[tauri::command]
async fn network_host_stop(
    session: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let network = Arc::clone(&state.network);
    let path = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || network.stop_host(path, session))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn guest_call(
    operation: String,
    payload: Option<Value>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let network = Arc::clone(&state.network);
    tauri::async_runtime::spawn_blocking(move || {
        network.guest_call(operation, payload.unwrap_or(json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn host_call(
    operation: String,
    session: Option<String>,
    payload: Option<Value>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let path = state.data_dir.join("host.sqlite");
    tauri::async_runtime::spawn_blocking(move || {
        host_commands::dispatch(
            path,
            operation,
            session,
            payload.unwrap_or_else(|| json!({})),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn diagnostics(state: tauri::State<AppState>) -> Value {
    json!({"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,
       "data_dir":state.data_dir,"startup_error":state.startup_error,"network":state.network.host_status(),
       "model":state.model.status(),"automatic_model_download":false,"guest_ordering_requires_reviewed_menu":true,
       "limitations":["局域网TLS已做本机协议测试；不同设备验收尚未完成","模型真实推理须使用明确授权且校验过的本地文件单独验证","感官先验未经过试饮验证"]})
}
#[tauri::command]
fn backup_create(state: tauri::State<AppState>) -> Result<String, String> {
    let folder = state.data_dir.join("backups");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = folder.join(format!("pixelmix-{now}.sqlite"));
    with_catalog(&state, |db| db.backup_to(&path).map_err(|e| e.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
fn backup_list(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    let folder = state.data_dir.join("backups");
    if !folder.exists() {
        return Ok(vec![]);
    }
    let mut names = vec![];
    for entry in std::fs::read_dir(folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && name.starts_with("pixelmix-")
            && name.ends_with(".sqlite")
        {
            names.push(name);
        }
    }
    names.sort();
    names.reverse();
    Ok(names)
}
#[tauri::command]
fn backup_restore(name: String, state: tauri::State<AppState>) -> Result<(), String> {
    if !name.starts_with("pixelmix-") || !name.ends_with(".sqlite") || name.contains(['/', '\\']) {
        return Err("备份名称无效".into());
    }
    let path = state.data_dir.join("backups").join(name);
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let folder = state
        .data_dir
        .join("backups")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if canonical.parent() != Some(folder.as_path()) {
        return Err("只能恢复应用备份目录中的文件".into());
    }
    let mut guard = state.catalog.lock().map_err(|e| e.to_string())?;
    let db = guard.as_mut().ok_or("数据库尚未初始化")?;
    db.restore_from(&canonical).map_err(|e| e.to_string())
}

#[tauri::command]
async fn archive_save(
    snapshot: archive::Snapshot,
    state: tauri::State<'_, AppState>,
) -> Result<archive::SavedArchive, String> {
    let folder = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut saved = archive::save(&folder, snapshot)?;
        saved.icon_association = archive::register_icon(&folder)
            .unwrap_or_else(|reason| json!({"registered":false,"reason":reason}));
        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn archive_import(path: String, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let path = PathBuf::from(path);
    state.archive_access.authorize(&path, &state.data_dir)?;
    tauri::async_runtime::spawn_blocking(move || archive::read(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn archive_clipboard_copy(archive_id: String, window: tauri::Window, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if window.label() != "main" { return Err("文件剪贴板仅允许主工作台访问".into()); }
    let path = archive::own_archive(&state.data_dir, &archive_id)?;
    #[cfg(windows)]
    let owner=window.hwnd().map_err(|e|e.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let owner=0;
    tauri::async_runtime::spawn_blocking(move || archive_clipboard::copy(owner,&path)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn archive_clipboard_paste(window: tauri::Window) -> Result<Vec<Value>, String> {
    if window.label() != "main" { return Err("文件剪贴板仅允许主工作台访问".into()); }
    #[cfg(windows)]
    let owner=window.hwnd().map_err(|e|e.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let owner=0;
    tauri::async_runtime::spawn_blocking(move || archive_clipboard::paste(owner)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn archive_start_drag(
    archive_id: String,
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let path = archive::own_archive(&state.data_dir, &archive_id)?;
    #[cfg(windows)]
    {
        let drag_image = archive::drag_icon(&path)?;
        let (send, receive) = std::sync::mpsc::channel();
        app.run_on_main_thread(move||{
            // Saving/fsync and first-time Shell registration are asynchronous.
            // A released gesture must never become a new OLE drop on the next click.
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
            if unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } >= 0 {
                let _=send.send(Ok(json!({"status":"cancelled","mode":"copy","reason":"pointer_released"})));
                return;
            }
            let outcome=Arc::new(Mutex::new("cancelled"));let callback=Arc::clone(&outcome);
            let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||drag::start_drag(&window,drag::DragItem::Files(vec![path]),drag::Image::Raw(drag_image),move |result,_|{if let Ok(mut value)=callback.lock(){*value=match result {drag::DragResult::Dropped=>"dropped",drag::DragResult::Cancel=>"cancelled"};}},drag::Options{mode:drag::DragMode::Copy,..Default::default()})))
                .map_err(|_|"原生文件拖放失败".to_string()).and_then(|result|result.map_err(|e|e.to_string())).map(|_|json!({"status":*outcome.lock().unwrap_or_else(|e|e.into_inner()),"mode":"copy"}));
            let _=send.send(result);
        }).map_err(|e|e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| e.to_string())?)
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (path, window, app);
        Err("此平台尚未实现经验证的原生文件拖出".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            glass_window::on_window_event(window, event);
            taste_window::on_window_event(window, event);
            if window.label() == "main" {
                if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                    event
                {
                    if let Some(state) = window.try_state::<AppState>() {
                        state.archive_access.grant_drop(paths);
                    }
                }
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            // Test isolation exists only in a debug build; release never redirects user data by this variable.
            #[cfg(debug_assertions)]
            let data_dir = std::env::var_os("PIXEL_MIX_TEST_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(data_dir);
            std::fs::create_dir_all(&data_dir)?;
            let (catalog, startup_error) = match Catalog::open(data_dir.join("pixelmix.sqlite")) {
                Ok(db) => (Some(db), None),
                Err(e) => (None, Some(e.to_string())),
            };
            app.manage(AppState {
                catalog: Mutex::new(catalog),
                startup_error,
                data_dir,
                model: Arc::new(model_commands::ModelController::default()),
                network: Arc::new(network_commands::NetworkController::default()),
                archive_access: archive::ArchiveAccess::default(),
            });
            app.manage(recipe_window::RecipeWindowState::default());
            app.manage(glass_window::GlassWindowState::default());
            app.manage(taste_window::TasteWindowState::default());
            Ok(())
        })
        .invoke_handler(|invoke| {
            let command = invoke.message.command();
            if !recipe_library::command_allowed(invoke.message.webview_ref().label(), command) {
                invoke.resolver.reject("个人酒谱库仅允许主工作台读取和修改");
                return true;
            }
            if invoke.message.webview_ref().label() == "taste-preview"
                && !taste_window::popup_command_allowed(command)
            {
                invoke.resolver.reject("味觉预览窗口仅可读取展示数据");
                return true;
            }
            if invoke.message.webview_ref().label() == "glass-details"
                && !glass_window::popup_command_allowed(command)
            {
                invoke
                    .resolver
                    .reject("酒杯展示窗口没有主机、模型、存档或其他工作台命令权限");
                return true;
            }
            if invoke.message.webview_ref().label() == "recipe-details"
                && command != "recipe_window_payload"
                && command != "recipe_window_ready"
                && !command.starts_with("plugin:event|")
            {
                invoke
                    .resolver
                    .reject("配方展示窗口没有主机、模型、存档或其他工作台命令权限");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                catalog,
                ui_state_get,
                ui_state_set,
                recipe_library_get,
                recipe_library_apply,
                recipe_library_import,
                taste_adjust,
                generate_trial,
                model_start,
                model_status,
                model_stop,
                network_host_start,
                network_host_status,
                network_host_stop,
                guest_call,
                host_call,
                diagnostics,
                backup_create,
                backup_list,
                backup_restore,
                archive_save,
                archive_import,
                archive_start_drag,
                archive_clipboard_copy,
                archive_clipboard_paste,
                recipe_window::recipe_window_update,
                recipe_window::recipe_window_position,
                recipe_window::recipe_window_payload,
                recipe_window::recipe_window_ready,
                glass_window::glass_window_update,
                glass_window::glass_window_payload,
                glass_window::glass_window_ready,
                glass_window::glass_window_action,
                taste_window::taste_window_update,
                taste_window::taste_window_payload,
                taste_window::taste_window_ready
            ];
            handler(invoke)
        })
        .run(tauri::generate_context!())
        .expect("Programmer Mixology native runtime failed");
}
