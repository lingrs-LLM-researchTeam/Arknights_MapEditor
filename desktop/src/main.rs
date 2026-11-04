#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    ffi::{c_void, OsStr, OsString},
    fs,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    ptr,
};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    window::{Window, WindowId},
};
use wry::{WebView, WebViewBuilder, WebViewBuilderExtWindows};
const OFN_OVERWRITEPROMPT: u32 = 0x0000_0002;
const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
const OFN_FILEMUSTEXIST: u32 = 0x0000_1000;
const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
const OFN_EXPLORER: u32 = 0x0008_0000;
const MB_ICONWARNING: u32 = 0x0000_0030;
#[repr(C)]
struct OpenFileNameW {
    l_struct_size: u32,
    hwnd_owner: *mut c_void,
    h_instance: *mut c_void,
    lpstr_filter: *const u16,
    lpstr_custom_filter: *mut u16,
    n_max_cust_filter: u32,
    n_filter_index: u32,
    lpstr_file: *mut u16,
    n_max_file: u32,
    lpstr_file_title: *mut u16,
    n_max_file_title: u32,
    lpstr_initial_dir: *const u16,
    lpstr_title: *const u16,
    flags: u32,
    n_file_offset: u16,
    n_file_extension: u16,
    lpstr_def_ext: *const u16,
    l_cust_data: isize,
    lpfn_hook: *mut c_void,
    lp_template_name: *const u16,
    pv_reserved: *mut c_void,
    dw_reserved: u32,
    flags_ex: u32,
}

#[link(name = "comdlg32")]
extern "system" {
    fn GetOpenFileNameW(dialog: *mut OpenFileNameW) -> i32;
    fn GetSaveFileNameW(dialog: *mut OpenFileNameW) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(
        hwnd: *mut c_void,
        text: *const u16,
        caption: *const u16,
        message_type: u32,
    ) -> i32;
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

fn native_file_dialog(
    save: bool,
    filter_text: &str,
    title_text: &str,
    extension_text: &str,
    initial_path: Option<&Path>,
) -> Option<PathBuf> {
    let filter = wide(filter_text);
    let title = wide(title_text);
    let extension = wide(extension_text);
    let mut file_buffer = vec![0_u16; 32_768];
    if let Some(initial_path) = initial_path {
        let initial = wide(initial_path.to_string_lossy().as_ref());
        let length = initial.len().min(file_buffer.len());
        file_buffer[..length].copy_from_slice(&initial[..length]);
    }
    let mut dialog = OpenFileNameW {
        l_struct_size: std::mem::size_of::<OpenFileNameW>() as u32,
        hwnd_owner: ptr::null_mut(),
        h_instance: ptr::null_mut(),
        lpstr_filter: filter.as_ptr(),
        lpstr_custom_filter: ptr::null_mut(),
        n_max_cust_filter: 0,
        n_filter_index: 1,
        lpstr_file: file_buffer.as_mut_ptr(),
        n_max_file: file_buffer.len() as u32,
        lpstr_file_title: ptr::null_mut(),
        n_max_file_title: 0,
        lpstr_initial_dir: ptr::null(),
        lpstr_title: title.as_ptr(),
        flags: OFN_EXPLORER
            | OFN_NOCHANGEDIR
            | OFN_PATHMUSTEXIST
            | if save {
                OFN_OVERWRITEPROMPT
            } else {
                OFN_FILEMUSTEXIST
            },
        n_file_offset: 0,
        n_file_extension: 0,
        lpstr_def_ext: extension.as_ptr(),
        l_cust_data: 0,
        lpfn_hook: ptr::null_mut(),
        lp_template_name: ptr::null(),
        pv_reserved: ptr::null_mut(),
        dw_reserved: 0,
        flags_ex: 0,
    };
    let accepted = unsafe {
        if save {
            GetSaveFileNameW(&mut dialog)
        } else {
            GetOpenFileNameW(&mut dialog)
        }
    };
    if accepted == 0 {
        return None;
    }
    let length = file_buffer
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(file_buffer.len());
    Some(PathBuf::from(OsString::from_wide(&file_buffer[..length])))
}

fn asset(path: &str) -> Option<(&'static str, &'static [u8])> {
    match path {
        "/" | "/index.html" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../index.html"),
        )),
        "/styles.css" => Some(("text/css", include_bytes!("../../styles.css"))),
        "/schema.js" => Some(("text/javascript", include_bytes!("../../schema.js"))),
        "/map-model.js" => Some(("text/javascript", include_bytes!("../../map-model.js"))),
        "/tile-renderer.js" => Some(("text/javascript", include_bytes!("../../tile-renderer.js"))),
        "/map-editor.js" => Some(("text/javascript", include_bytes!("../../map-editor.js"))),
        "/events.js" => Some(("text/javascript", include_bytes!("../../events.js"))),
        "/inspector.js" => Some(("text/javascript", include_bytes!("../../inspector.js"))),
        "/editor-ui.js" => Some(("text/javascript", include_bytes!("../../editor-ui.js"))),
        _ => None,
    }
}
#[derive(Default)]
struct App {
    window: Option<Window>,
    webview: Option<WebView>,
    proxy: Option<EventLoopProxy<String>>,
    dirty: bool,
}
impl App {
    fn eval(&self, s: &str) {
        if let Some(w) = &self.webview {
            let _ = w.evaluate_script(s);
        }
    }
    fn error(&self, e: impl std::fmt::Display) {
        self.eval(&format!(
            "MapEditorUI.nativeError({});",
            json!(e.to_string())
        ));
    }
}
impl ApplicationHandler<String> for App {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = el
            .create_window(
                Window::default_attributes()
                    .with_title("明日方舟地图编辑器")
                    .with_inner_size(LogicalSize::new(1500., 960.))
                    .with_min_inner_size(LogicalSize::new(960., 640.)),
            )
            .expect("无法创建窗口");
        let proxy = self.proxy.as_ref().unwrap().clone();
        let webview = WebViewBuilder::new()
            .with_custom_protocol("arkmap".into(), |_id, request| {
                let (status, mime, body) = match asset(request.uri().path()) {
                    Some((mime, body)) => (200, mime, body),
                    None => (404, "text/plain", b"Not found".as_slice()),
                };
                wry::http::Response::builder()
                    .status(status)
                    .header("Content-Type", mime)
                    .body(Cow::Borrowed(body))
                    .unwrap()
            })
            .with_url("arkmap://localhost/index.html")
            .with_incognito(true)
            .with_additional_browser_args(
                "--disable-background-networking --disable-component-update --no-first-run",
            )
            .with_navigation_handler(|url| {
                url.starts_with("http://arkmap.localhost/")
                    || url.starts_with("arkmap://localhost/")
            })
            .with_ipc_handler(move |request| {
                let _ = proxy.send_event(request.into_body());
            })
            .build(&window)
            .expect("无法初始化 WebView2，请安装 Microsoft Edge WebView2 Runtime");
        self.webview = Some(webview);
        self.window = Some(window);
    }
    fn user_event(&mut self, _el: &ActiveEventLoop, message: String) {
        match message.as_str() {
            "DIRTY" => {
                self.dirty = true;
                return;
            }
            "CLEAN" => {
                self.dirty = false;
                return;
            }
            "OPEN" => {
                if let Some(path) = native_file_dialog(
                    false,
                    "地图 JSON (*.json)\0*.json\0所有文件\0*.*\0",
                    "打开地图",
                    "json",
                    None,
                ) {
                    match fs::read_to_string(&path){
      Ok(text)=>match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')){
       Ok(raw)=>self.eval(&format!("try{{MapEditorUI.load({},{});}}catch(e){{MapEditorUI.nativeError(e.message);}}",raw,json!(path.file_name().unwrap_or_default().to_string_lossy()))),
       Err(e)=>self.error(e)
      },Err(e)=>self.error(e)
     }
                }
                return;
            }
            _ => {}
        }
        if let Ok(request) = serde_json::from_str::<Value>(&message) {
            if request["type"] == "save" {
                let text = request["text"].as_str().unwrap_or("");
                if serde_json::from_str::<Value>(text).is_err() {
                    self.error("保存内容不是有效 JSON");
                    return;
                }
                let name = request["name"].as_str().unwrap_or("level_custom.json");
                if let Some(path) = native_file_dialog(
                    true,
                    "地图 JSON (*.json)\0*.json\0",
                    "保存地图",
                    "json",
                    Some(Path::new(name)),
                ) {
                    match fs::write(&path, text) {
                        Ok(()) => {
                            self.dirty = false;
                            self.eval(&format!(
                                "MapEditorUI.nativeSaved({});",
                                json!(path.to_string_lossy())
                            ));
                        }
                        Err(e) => self.error(e),
                    }
                }
            }
        }
    }
    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if matches!(event, WindowEvent::CloseRequested) {
            if !self.dirty
                || unsafe {
                    MessageBoxW(
                        ptr::null_mut(),
                        wide("地图尚未保存。确认放弃修改并关闭？").as_ptr(),
                        wide("地图编辑器").as_ptr(),
                        0x4 | MB_ICONWARNING,
                    )
                } == 6
            {
                el.exit();
            }
        }
    }
}
fn main() {
    let el = EventLoop::<String>::with_user_event().build().unwrap();
    el.set_control_flow(ControlFlow::Wait);
    let mut app = App {
        proxy: Some(el.create_proxy()),
        ..App::default()
    };
    el.run_app(&mut app).unwrap();
}
