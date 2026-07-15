use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindowBuilder,
};

const TRAY_ID: &str = "main";
const LINK_PREVIEW_HTML_LIMIT: usize = 512 * 1024;
const LINK_PREVIEW_REDIRECT_LIMIT: usize = 4;
#[cfg(target_os = "macos")]
const DEVELOPMENT_BUNDLE_IDENTIFIER: &str = "com.vex-chat.app.dev";
#[cfg(target_os = "macos")]
const DEVELOPMENT_WEBVIEW_DATA_STORE_IDENTIFIER: [u8; 16] = [
    180, 224, 203, 29, 107, 71, 72, 93, 157, 151, 114, 109, 205, 216, 119, 115,
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkPreviewHtml {
    final_url: String,
    html: String,
}

#[tauri::command]
async fn keyring_get_password(service: String, user: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring::Entry::new(&service, &user).map_err(|err| err.to_string())?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn keyring_set_password(
    service: String,
    user: String,
    password: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        keyring::Entry::new(&service, &user)
            .map_err(|err| err.to_string())?
            .set_password(&password)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn keyring_delete_password(service: String, user: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring::Entry::new(&service, &user).map_err(|err| err.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    })
    .await
    .map_err(|err| err.to_string())?
}

fn ipv4_mapped_address(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = ip.segments();
    if segments[..5].iter().any(|segment| *segment != 0) || segments[5] != 0xffff {
        return None;
    }
    Some(Ipv4Addr::new(
        (segments[6] >> 8) as u8,
        segments[6] as u8,
        (segments[7] >> 8) as u8,
        segments[7] as u8,
    ))
}

fn is_blocked_preview_hostname(host: &str) -> bool {
    let normalized = host
        .trim_matches(|char| char == '[' || char == ']')
        .trim_end_matches('.')
        .to_ascii_lowercase();

    normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
}

fn is_safe_preview_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_safe_preview_ipv4(ip),
        IpAddr::V6(ip) => is_safe_preview_ipv6(ip),
    }
}

fn is_safe_preview_ipv4(ip: Ipv4Addr) -> bool {
    !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified())
}

fn is_safe_preview_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ipv4_mapped_address(ip) {
        return is_safe_preview_ipv4(mapped);
    }
    let first_segment = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || (first_segment & 0xfe00) == 0xfc00
        || (first_segment & 0xffc0) == 0xfe80)
}

fn is_safe_preview_url_syntax(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "http" | "https" => {}
        _ => return false,
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if is_blocked_preview_hostname(host) {
        return false;
    }
    match host.parse::<IpAddr>() {
        Ok(ip) => is_safe_preview_ip(ip),
        Err(_) => true,
    }
}

async fn resolve_safe_preview_addrs(url: &reqwest::Url) -> Result<Vec<SocketAddr>, String> {
    if !is_safe_preview_url_syntax(url) {
        return Err("Preview target is not allowed".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "Preview target is not allowed".to_string())?
        .trim_matches(|char| char == '[' || char == ']')
        .trim_end_matches('.')
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Preview target is not allowed".to_string())?;
    let addrs = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    if addrs.is_empty() || addrs.iter().any(|addr| !is_safe_preview_ip(addr.ip())) {
        return Err("Preview target is not allowed".to_string());
    }
    Ok(addrs)
}

async fn build_link_preview_client(url: &reqwest::Url) -> Result<reqwest::Client, String> {
    let addrs = resolve_safe_preview_addrs(url).await?;
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Vex/0.1 link-preview");

    if url
        .host_str()
        .and_then(|host| host.parse::<IpAddr>().ok())
        .is_none()
    {
        let host = url
            .host_str()
            .ok_or_else(|| "Preview target is not allowed".to_string())?;
        builder = builder.resolve_to_addrs(host, &addrs);
    }

    builder.build().map_err(|err| err.to_string())
}

fn resolve_redirect_url(
    location: &reqwest::header::HeaderValue,
    base_url: &reqwest::Url,
) -> Result<reqwest::Url, String> {
    let location = location
        .to_str()
        .map_err(|_| "Invalid preview redirect".to_string())?;
    base_url
        .join(location)
        .map_err(|_| "Invalid preview redirect".to_string())
}

async fn send_link_preview_request(url: &reqwest::Url) -> Result<reqwest::Response, String> {
    let client = build_link_preview_client(url).await?;
    client
        .get(url.clone())
        .send()
        .await
        .map_err(|err| err.to_string())
}

fn show_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            // Unminimize plays the macOS Dock animation; calling show() on top
            // of it causes a flicker, so we take separate paths.
            let _ = w.unminimize();
        } else {
            let _ = w.show();
        }
        let _ = w.set_focus();
    }
}

fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .or_else(|| app.config().app.windows.first())
        .ok_or(tauri::Error::WindowNotFound)?;

    let builder = WebviewWindowBuilder::from_config(app.handle(), window_config)?;
    #[cfg(target_os = "macos")]
    let builder = {
        let mut builder = builder;
        if app.config().identifier == DEVELOPMENT_BUNDLE_IDENTIFIER {
            builder = builder.data_store_identifier(DEVELOPMENT_WEBVIEW_DATA_STORE_IDENTIFIER);
        }
        builder = builder.with_webview_configuration(macos_voice_call_webview_configuration());
        builder
    };
    builder.build()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_voice_call_webview_configuration(
) -> objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration> {
    use objc2::MainThreadMarker;
    use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding};
    use objc2_web_kit::{WKAudiovisualMediaTypes, WKWebViewConfiguration};

    let mtm = MainThreadMarker::new().expect("WKWebView configuration must run on the main thread");
    unsafe {
        let configuration = WKWebViewConfiguration::new(mtm);
        let preferences = configuration.preferences();
        let enabled = NSNumber::numberWithBool(true);
        preferences.setValue_forKey(Some(&enabled), ns_string!("mediaDevicesEnabled"));
        configuration.setMediaTypesRequiringUserActionForPlayback(WKAudiovisualMediaTypes::None);
        configuration
    }
}

#[tauri::command]
fn set_tray_unread(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if count > 0 {
            format!("Vex Chat ({count} unread)")
        } else {
            "Vex Chat".to_string()
        };
        tray.set_tooltip(Some(&tooltip))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn fetch_link_preview_html(url: String) -> Result<LinkPreviewHtml, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only HTTP links can be previewed".to_string()),
    }
    // Match the updater's lean reqwest/rustls configuration without pulling in AWS-LC.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut current_url = parsed;
    let mut response;
    let mut redirects = 0usize;
    loop {
        response = send_link_preview_request(&current_url).await?;
        if !is_safe_preview_url_syntax(response.url()) {
            return Err("Preview target is not allowed".to_string());
        }
        if !response.status().is_redirection() {
            break;
        }
        if redirects >= LINK_PREVIEW_REDIRECT_LIMIT {
            return Err("too many redirects".to_string());
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .ok_or_else(|| "Invalid preview redirect".to_string())?;
        current_url = resolve_redirect_url(location, response.url())?;
        redirects += 1;
    }

    if !response.status().is_success() {
        return Err(format!("Preview request failed: {}", response.status()));
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.is_empty()
        && !content_type.contains("text/html")
        && !content_type.contains("application/xhtml+xml")
    {
        return Err("Preview target is not HTML".to_string());
    }

    let mut html_bytes = Vec::new();
    while html_bytes.len() < LINK_PREVIEW_HTML_LIMIT {
        let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? else {
            break;
        };
        let remaining = LINK_PREVIEW_HTML_LIMIT - html_bytes.len();
        html_bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }

    let html = String::from_utf8_lossy(&html_bytes).into_owned();
    Ok(LinkPreviewHtml { final_url, html })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            fetch_link_preview_html,
            keyring_delete_password,
            keyring_get_password,
            keyring_set_password,
            set_tray_unread
        ])
        .setup(|app| {
            build_main_window(app)?;

            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Vex Chat")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
