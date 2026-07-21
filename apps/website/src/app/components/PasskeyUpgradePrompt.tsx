import { KeyRound, X } from "lucide-preact";
import { useEffect, useRef } from "preact/hooks";

import { $passkeyUpgradePrompt, vexService } from "@vex-chat/store";

import { rememberPasskeySetupIntent } from "../lib/passkeySetupIntent";
import { navigate, settingsPath } from "../lib/router";
import { useStoreValue } from "../lib/useStoreValue";

export function PasskeyUpgradePrompt() {
    const prompt = useStoreValue($passkeyUpgradePrompt);
    const closeRef = useRef<HTMLButtonElement | null>(null);
    const primaryRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!prompt) return;
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const frame = window.requestAnimationFrame(() => {
            primaryRef.current?.focus();
        });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                dismiss();
                return;
            }
            if (
                event.key !== "Tab" ||
                !closeRef.current ||
                !primaryRef.current
            ) {
                return;
            }
            if (event.shiftKey && document.activeElement === closeRef.current) {
                event.preventDefault();
                primaryRef.current.focus();
            } else if (
                !event.shiftKey &&
                document.activeElement === primaryRef.current
            ) {
                event.preventDefault();
                closeRef.current.focus();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = previousOverflow;
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
        };
    }, [prompt]);

    if (!prompt) return null;
    const remotePasskey = prompt.reason === "cross_platform_passkey";

    function dismiss() {
        vexService.dismissPasskeyUpgradePrompt();
    }

    function startSetup() {
        if (!prompt) return;
        rememberPasskeySetupIntent({
            reason: prompt.reason,
            suggestedName: prompt.deviceName.trim() || "This browser",
        });
        dismiss();
        navigate(settingsPath("passkeys"));
    }

    return (
        <div className="passkey-prompt">
            <button
                aria-label="Dismiss passkey suggestion"
                className="passkey-prompt__backdrop"
                type="button"
                onClick={dismiss}
            />
            <section
                aria-labelledby="passkey-prompt-title"
                aria-modal="true"
                className="passkey-prompt__dialog"
                role="dialog"
            >
                <button
                    aria-label="Not now"
                    className="passkey-prompt__close"
                    ref={closeRef}
                    title="Not now"
                    type="button"
                    onClick={dismiss}
                >
                    <X size={18} />
                </button>
                <span className="passkey-prompt__icon">
                    <KeyRound size={24} />
                </span>
                <div className="passkey-prompt__copy">
                    <span>Faster sign-in</span>
                    <h2 id="passkey-prompt-title">
                        {remotePasskey
                            ? "Add a passkey to this browser"
                            : "Skip your password next time"}
                    </h2>
                    <p>
                        {remotePasskey
                            ? `You signed in with a passkey from another device or security key. Add one to ${prompt.deviceName || "this browser"} for faster access next time.`
                            : `Create a passkey for ${prompt.deviceName || "this browser"}. Sign in with your fingerprint, face, or device PIN while keeping your password as a backup.`}
                    </p>
                </div>
                <div className="passkey-prompt__actions">
                    <button
                        className="button button--secondary"
                        type="button"
                        onClick={dismiss}
                    >
                        Not now
                    </button>
                    <button
                        className="button button--primary"
                        ref={primaryRef}
                        type="button"
                        onClick={startSetup}
                    >
                        <KeyRound size={17} /> Continue
                    </button>
                </div>
            </section>
        </div>
    );
}
