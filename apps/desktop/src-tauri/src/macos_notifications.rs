use std::{
    ptr::NonNull,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use block2::{DynBlock, RcBlock};
use objc2::{define_class, msg_send, rc::Retained, runtime::ProtocolObject, MainThreadOnly};
use objc2_foundation::{MainThreadMarker, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationSettings,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_NOTIFICATION_ID: AtomicU64 = AtomicU64::new(1);

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = ()]
    struct VexNotificationCenterDelegate;

    unsafe impl NSObjectProtocol for VexNotificationCenterDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for VexNotificationCenterDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present_notification(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let options =
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List;
            (*completion_handler).call((options,));
        }
    }
);

impl VexNotificationCenterDelegate {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

pub fn initialize() -> Result<(), String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "Notification center must initialize on the main thread".to_string())?;
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let delegate = VexNotificationCenterDelegate::new(mtm);
    let delegate_ref: &ProtocolObject<dyn UNUserNotificationCenterDelegate> =
        ProtocolObject::from_ref(&*delegate);
    center.setDelegate(Some(delegate_ref));

    // UNUserNotificationCenter holds a weak delegate. Keep this process-wide
    // singleton alive for the lifetime of the app.
    std::mem::forget(delegate);
    Ok(())
}

pub fn permission_state() -> Result<String, String> {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref() }.authorizationStatus().0;
        let _ = sender.send(status);
    });
    let completion: &DynBlock<dyn Fn(NonNull<UNNotificationSettings>)> = &completion;
    center.getNotificationSettingsWithCompletionHandler(completion);

    let status = receiver
        .recv_timeout(CALLBACK_TIMEOUT)
        .map_err(|_| "Timed out checking macOS notification permission".to_string())?;
    Ok(permission_label(UNAuthorizationStatus(status)).to_string())
}

pub fn request_permission() -> Result<String, String> {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
        let result = match unsafe { error.as_ref() } {
            Some(error) => Err(error.localizedDescription().to_string()),
            None => Ok(granted.as_bool()),
        };
        let _ = sender.send(result);
    });
    let completion: &DynBlock<dyn Fn(objc2::runtime::Bool, *mut NSError)> = &completion;
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert,
        completion,
    );

    let granted = receiver
        .recv()
        .map_err(|_| "macOS closed the notification permission request".to_string())??;
    if granted {
        permission_state()
    } else {
        Ok("denied".to_string())
    }
}

pub fn send(title: String, body: String) -> Result<(), String> {
    if permission_state()? != "granted" {
        return Err("Notifications are disabled in macOS System Settings".to_string());
    }

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&title));
    content.setBody(&NSString::from_str(&body));

    let sequence = NEXT_NOTIFICATION_ID.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let identifier = NSString::from_str(&format!("vex-{timestamp}-{sequence}"));
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(move |error: *mut NSError| {
        let result = match unsafe { error.as_ref() } {
            Some(error) => Err(error.localizedDescription().to_string()),
            None => Ok(()),
        };
        let _ = sender.send(result);
    });
    let completion: &DynBlock<dyn Fn(*mut NSError)> = &completion;
    center.addNotificationRequest_withCompletionHandler(&request, Some(completion));

    receiver
        .recv_timeout(CALLBACK_TIMEOUT)
        .map_err(|_| "Timed out delivering the macOS notification".to_string())?
}

fn permission_label(status: UNAuthorizationStatus) -> &'static str {
    match status {
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => "granted",
        UNAuthorizationStatus::NotDetermined => "prompt",
        _ => "denied",
    }
}
