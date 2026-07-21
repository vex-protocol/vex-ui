const NOTIFICATIONS_ENABLED_KEY = "vex-web-notifications-enabled";
const SOUNDS_ENABLED_KEY = "vex-web-sounds-enabled";

export type BrowserNotificationState =
    | "denied"
    | "granted"
    | "prompt"
    | "unsupported";

export function browserNotificationState(): BrowserNotificationState {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission === "default"
        ? "prompt"
        : Notification.permission;
}

export function getBrowserNotificationsEnabled(): boolean {
    return (
        localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === "1" &&
        browserNotificationState() === "granted"
    );
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? "1" : "0");
}

export async function requestBrowserNotifications(): Promise<boolean> {
    if (!("Notification" in window)) return false;
    const permission =
        Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();
    const granted = permission === "granted";
    setBrowserNotificationsEnabled(granted);
    return granted;
}

export function showBrowserNotification(
    title: string,
    options: NotificationOptions = {},
    onClick?: () => void,
): boolean {
    if (!getBrowserNotificationsEnabled()) return false;
    try {
        const notification = new Notification(title, {
            badge: "/favicon.svg",
            icon: "/favicon.svg",
            ...options,
        });
        notification.onclick = () => {
            window.focus();
            onClick?.();
            notification.close();
        };
        return true;
    } catch {
        return false;
    }
}

export function getSoundsEnabled(): boolean {
    return localStorage.getItem(SOUNDS_ENABLED_KEY) !== "0";
}

export function setSoundsEnabled(enabled: boolean): void {
    localStorage.setItem(SOUNDS_ENABLED_KEY, enabled ? "1" : "0");
}

export function playNotificationSound(): void {
    if (!getSoundsEnabled()) return;
    try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.setValueAtTime(640, context.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(
            480,
            context.currentTime + 0.12,
        );
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(
            0.055,
            context.currentTime + 0.015,
        );
        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            context.currentTime + 0.16,
        );
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.17);
        oscillator.addEventListener("ended", () => void context.close(), {
            once: true,
        });
    } catch {
        // Browsers can block audio until the first user gesture.
    }
}
