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
    UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotification, UNNotificationPresentationOptions, UNNotificationRequest,
    UNNotificationSetting, UNNotificationSettings, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
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
        let settings = unsafe { settings.as_ref() };
        let _ = sender.send((
            settings.authorizationStatus().0,
            settings.alertSetting().0,
            settings.alertStyle().0,
            settings.notificationCenterSetting().0,
        ));
    });
    let completion: &DynBlock<dyn Fn(NonNull<UNNotificationSettings>)> = &completion;
    center.getNotificationSettingsWithCompletionHandler(completion);

    let (authorization, alert, alert_style, notification_center) = receiver
        .recv_timeout(CALLBACK_TIMEOUT)
        .map_err(|_| "Timed out checking macOS notification permission".to_string())?;
    Ok(permission_label(
        UNAuthorizationStatus(authorization),
        UNNotificationSetting(alert),
        UNAlertStyle(alert_style),
        UNNotificationSetting(notification_center),
    )
    .to_string())
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

fn permission_label(
    authorization: UNAuthorizationStatus,
    alert: UNNotificationSetting,
    alert_style: UNAlertStyle,
    notification_center: UNNotificationSetting,
) -> &'static str {
    if authorization == UNAuthorizationStatus::NotDetermined {
        return "prompt";
    }

    let authorized = matches!(
        authorization,
        UNAuthorizationStatus::Authorized
            | UNAuthorizationStatus::Provisional
            | UNAuthorizationStatus::Ephemeral
    );
    let desktop_enabled =
        alert == UNNotificationSetting::Enabled && alert_style != UNAlertStyle::None;
    let notification_center_enabled = notification_center == UNNotificationSetting::Enabled;

    if authorized && (desktop_enabled || notification_center_enabled) {
        "granted"
    } else {
        "denied"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_when_authorization_is_not_determined() {
        assert_eq!(
            permission_label(
                UNAuthorizationStatus::NotDetermined,
                UNNotificationSetting::Disabled,
                UNAlertStyle::None,
                UNNotificationSetting::Disabled,
            ),
            "prompt"
        );
    }

    #[test]
    fn grants_when_desktop_alerts_are_enabled() {
        assert_eq!(
            permission_label(
                UNAuthorizationStatus::Authorized,
                UNNotificationSetting::Enabled,
                UNAlertStyle::Banner,
                UNNotificationSetting::Disabled,
            ),
            "granted"
        );
    }

    #[test]
    fn grants_when_notification_center_is_enabled() {
        assert_eq!(
            permission_label(
                UNAuthorizationStatus::Authorized,
                UNNotificationSetting::Disabled,
                UNAlertStyle::None,
                UNNotificationSetting::Enabled,
            ),
            "granted"
        );
    }

    #[test]
    fn denies_when_authorized_without_a_visual_destination() {
        assert_eq!(
            permission_label(
                UNAuthorizationStatus::Authorized,
                UNNotificationSetting::Enabled,
                UNAlertStyle::None,
                UNNotificationSetting::Disabled,
            ),
            "denied"
        );
    }

    #[test]
    fn denies_when_authorization_is_denied() {
        assert_eq!(
            permission_label(
                UNAuthorizationStatus::Denied,
                UNNotificationSetting::Enabled,
                UNAlertStyle::Banner,
                UNNotificationSetting::Enabled,
            ),
            "denied"
        );
    }
}
