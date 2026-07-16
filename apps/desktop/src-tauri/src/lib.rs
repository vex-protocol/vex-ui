use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};

#[cfg(target_os = "macos")]
use std::cell::RefCell;

#[cfg(target_os = "macos")]
use block2::{DynBlock, RcBlock};
#[cfg(target_os = "macos")]
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyClass, ProtocolObject},
    AnyThread, DefinedClass, MainThreadOnly,
};
#[cfg(target_os = "macos")]
use objc2_authentication_services::{
    ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSError, NSObject, NSObjectProtocol, NSString, NSURL};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
mod macos_notifications;

#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

const TRAY_ID: &str = "main";
const LINK_PREVIEW_HTML_LIMIT: usize = 512 * 1024;
const LINK_PREVIEW_REDIRECT_LIMIT: usize = 4;
const PASSKEY_BROWSER_CALLBACK: &str = "vex://passkey/complete";
#[cfg(target_os = "macos")]
const DEVELOPMENT_BUNDLE_IDENTIFIER: &str = "com.vex-chat.app.dev";
#[cfg(target_os = "macos")]
const DEVELOPMENT_WEBVIEW_DATA_STORE_IDENTIFIER: [u8; 16] = [
    180, 224, 203, 29, 107, 71, 72, 93, 157, 151, 114, 109, 205, 216, 119, 115,
];

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct PasskeyPresentationContextIvars {
    anchor: Retained<NSObject>,
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = PasskeyPresentationContextIvars]
    struct PasskeyPresentationContext;

    unsafe impl NSObjectProtocol for PasskeyPresentationContext {}

    unsafe impl ASWebAuthenticationPresentationContextProviding for PasskeyPresentationContext {
        #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
        fn presentation_anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<NSObject> {
            self.ivars().anchor.clone()
        }
    }
);

#[cfg(target_os = "macos")]
impl PasskeyPresentationContext {
    fn new(mtm: MainThreadMarker, anchor: Retained<NSObject>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PasskeyPresentationContextIvars { anchor });
        unsafe { msg_send![super(this), init] }
    }
}

#[cfg(target_os = "macos")]
struct ActivePasskeyBrowserSession {
    _presentation_context: Retained<PasskeyPresentationContext>,
    session: Retained<ASWebAuthenticationSession>,
}

#[cfg(target_os = "macos")]
thread_local! {
    static ACTIVE_PASSKEY_BROWSER_SESSION: RefCell<Option<ActivePasskeyBrowserSession>> =
        const { RefCell::new(None) };
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkPreviewHtml {
    final_url: String,
    html: String,
}

fn validate_passkey_browser_url(raw_url: &str) -> Result<(), String> {
    let url =
        reqwest::Url::parse(raw_url).map_err(|_| "Passkey browser URL is invalid".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "Passkey browser URL has no host".to_string())?;
    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback) {
        return Err("Passkey browser URL must use HTTPS".to_string());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/cli/passkey"
        || url.query().is_some()
    {
        return Err("Passkey browser URL is not allowed".to_string());
    }

    let fragment = url
        .fragment()
        .ok_or_else(|| "Passkey browser URL has no handoff".to_string())?;
    let fragment_url = reqwest::Url::parse(&format!("https://vex.invalid/?{fragment}"))
        .map_err(|_| "Passkey browser handoff is invalid".to_string())?;
    let mut params = std::collections::HashMap::new();
    for (key, value) in fragment_url.query_pairs() {
        if !matches!(key.as_ref(), "callback" | "mode" | "request" | "token")
            || params
                .insert(key.into_owned(), value.into_owned())
                .is_some()
        {
            return Err("Passkey browser handoff is invalid".to_string());
        }
    }

    let mode = params.get("mode").map(String::as_str);
    let request = params.get("request").map(String::as_str).unwrap_or("");
    let token = params.get("token").map(String::as_str).unwrap_or("");
    let callback = params.get("callback").map(String::as_str);
    if !matches!(mode, Some("authenticate-handoff" | "register-handoff"))
        || request.is_empty()
        || token.len() < 32
        || callback != Some(PASSKEY_BROWSER_CALLBACK)
    {
        return Err("Passkey browser handoff is invalid".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn start_macos_passkey_browser_session(app: &tauri::AppHandle, url: &str) -> Result<bool, String> {
    if AnyClass::get(c"ASWebAuthenticationSession").is_none() {
        return Ok(false);
    }
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "Passkey browser session must start on the main thread".to_string())?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Vex window is not available".to_string())?;
    let ns_window = window.ns_window().map_err(|err| err.to_string())?;
    let anchor = unsafe { Retained::retain(ns_window.cast::<NSObject>()) }
        .ok_or_else(|| "Vex window is not available".to_string())?;
    let presentation_context = PasskeyPresentationContext::new(mtm, anchor);
    let ns_url = NSURL::URLWithString(&NSString::from_str(url))
        .ok_or_else(|| "Passkey browser URL is invalid".to_string())?;
    let callback_scheme = NSString::from_str("vex");
    let completion = RcBlock::new(|_callback_url: *mut NSURL, _error: *mut NSError| {});
    let completion: &DynBlock<dyn Fn(*mut NSURL, *mut NSError)> = &completion;

    ACTIVE_PASSKEY_BROWSER_SESSION.with(|active| {
        if let Some(previous) = active.borrow_mut().take() {
            unsafe { previous.session.cancel() };
        }
    });

    #[allow(deprecated)]
    let session = unsafe {
        ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
            ASWebAuthenticationSession::alloc(),
            &ns_url,
            Some(&callback_scheme),
            completion as *const _ as *mut _,
        )
    };
    let provider: &ProtocolObject<dyn ASWebAuthenticationPresentationContextProviding> =
        ProtocolObject::from_ref(&*presentation_context);
    unsafe {
        session.setPresentationContextProvider(Some(provider));
        session.setPrefersEphemeralWebBrowserSession(false);
    }
    if !unsafe { session.start() } {
        return Err("The system browser could not start a passkey session".to_string());
    }

    ACTIVE_PASSKEY_BROWSER_SESSION.with(|active| {
        active.replace(Some(ActivePasskeyBrowserSession {
            _presentation_context: presentation_context,
            session,
        }));
    });
    Ok(true)
}

#[tauri::command]
async fn open_passkey_browser_session(app: tauri::AppHandle, url: String) -> Result<bool, String> {
    validate_passkey_browser_url(&url)?;

    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let main_thread_app = app.clone();
        app.run_on_main_thread(move || {
            let _ = sender.send(start_macos_passkey_browser_session(&main_thread_app, &url));
        })
        .map_err(|err| err.to_string())?;

        return tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(std::time::Duration::from_secs(3))
        })
        .await
        .map_err(|err| err.to_string())?
        .map_err(|_| "Timed out starting the system browser".to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
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

#[tauri::command]
async fn desktop_notification_permission_state(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(macos_notifications::permission_state)
            .await
            .map_err(|err| err.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok("granted".to_string())
    }
}

#[tauri::command]
async fn request_desktop_notification_permission(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(macos_notifications::request_permission)
            .await
            .map_err(|err| err.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok("granted".to_string())
    }
}

#[tauri::command]
async fn send_desktop_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || macos_notifications::send(title, body))
            .await
            .map_err(|err| err.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn open_desktop_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri_plugin_opener::open_url(
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
            None::<&str>,
        )
        .map_err(|err| err.to_string())
    }

    #[cfg(target_os = "windows")]
    {
        tauri_plugin_opener::open_url("ms-settings:notifications", None::<&str>)
            .map_err(|err| err.to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("Open your system notification settings to allow Vex notifications.".to_string())
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
            desktop_notification_permission_state,
            fetch_link_preview_html,
            keyring_delete_password,
            keyring_get_password,
            keyring_set_password,
            open_desktop_notification_settings,
            open_passkey_browser_session,
            request_desktop_notification_permission,
            send_desktop_notification,
            set_tray_unread
        ])
        .setup(|app| {
            build_main_window(app)?;

            #[cfg(target_os = "macos")]
            if let Err(error) = macos_notifications::initialize() {
                log::error!("Could not initialize macOS notifications: {error}");
            }

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

#[cfg(test)]
mod tests {
    use super::{validate_passkey_browser_url, PASSKEY_BROWSER_CALLBACK};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn passkey_url(origin: &str, mode: &str, callback: &str) -> String {
        let mut url = reqwest::Url::parse(origin).unwrap();
        url.set_path("/cli/passkey");
        url.set_fragment(Some(
            &[
                ("callback", callback),
                ("mode", mode),
                ("request", "request-id"),
                ("token", TOKEN),
            ]
            .into_iter()
            .fold(
                reqwest::Url::parse("https://vex.invalid/").unwrap(),
                |mut params, (key, value)| {
                    params.query_pairs_mut().append_pair(key, value);
                    params
                },
            )
            .query()
            .unwrap()
            .to_string(),
        ));
        url.to_string()
    }

    #[test]
    fn accepts_secure_passkey_handoff_urls() {
        let production = passkey_url(
            "https://api.vex.wtf",
            "register-handoff",
            PASSKEY_BROWSER_CALLBACK,
        );
        let local = passkey_url(
            "http://127.0.0.1:16777",
            "authenticate-handoff",
            PASSKEY_BROWSER_CALLBACK,
        );

        assert_eq!(validate_passkey_browser_url(&production), Ok(()));
        assert_eq!(validate_passkey_browser_url(&local), Ok(()));
    }

    #[test]
    fn rejects_untrusted_passkey_handoff_urls() {
        let insecure = passkey_url(
            "http://api.vex.wtf",
            "register-handoff",
            PASSKEY_BROWSER_CALLBACK,
        );
        let wrong_mode = passkey_url("https://api.vex.wtf", "recover", PASSKEY_BROWSER_CALLBACK);
        let wrong_callback = passkey_url(
            "https://api.vex.wtf",
            "register-handoff",
            "https://example.com/complete",
        );

        assert!(validate_passkey_browser_url(&insecure).is_err());
        assert!(validate_passkey_browser_url(&wrong_mode).is_err());
        assert!(validate_passkey_browser_url(&wrong_callback).is_err());
    }
}
