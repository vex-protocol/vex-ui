/**
 * Wrapper around `react-native-passkey` that hides the platform
 * specifics from the rest of the app and surfaces a tiny, typed
 * surface — `register()` and `authenticate()` — that mirrors the
 * `simplewebauthn`-style JSON shapes spire issues.
 *
 * All errors are normalized into one of three buckets:
 *
 *   - `PasskeyUnsupportedError` — the OS can't run a WebAuthn
 *     ceremony at all (e.g. iOS 14, very old Android, Expo Go without
 *     a prebuild).
 *   - `PasskeyCancelledError` — the user dismissed the system
 *     prompt. The caller should treat this as "noop, try again
 *     later" rather than a hard failure.
 *   - `PasskeyError` — anything else (bad RP config, unsupported
 *     credential, network failure inside the credential manager,
 *     etc.). The message is safe to surface to the user.
 *
 * The native side requires associated-domains / asset-links to be
 * configured for the spire host — without that the ceremony will
 * fail with a "Domain mismatch" error well before any of our code
 * runs. See `apps/mobile/PASSKEYS.md` for the operator runbook.
 */
import type {
    PasskeyCreateRequest,
    PasskeyGetRequest,
} from "react-native-passkey";

import { Passkey } from "react-native-passkey";

/**
 * Subset of `@simplewebauthn`'s `PublicKeyCredentialCreationOptionsJSON`
 * spire actually issues. Defined loosely — the wrapper only reads
 * the fields it forwards to the native ceremony, and any unknown
 * properties are tolerated. Defined this way so we can accept
 * compatible shapes coming from `@vex-chat/store` without forcing
 * structural-equality on every nested optional.
 */
export interface PublicKeyCredentialCreationOptionsJSON {
    attestation?: string | undefined;
    authenticatorSelection?:
        | undefined
        | {
              authenticatorAttachment?: "cross-platform" | "platform";
              requireResidentKey?: boolean;
              residentKey?: "discouraged" | "preferred" | "required";
              userVerification?: "discouraged" | "preferred" | "required";
          };
    challenge: string;
    excludeCredentials?: PublicKeyCredentialDescriptorJSON[] | undefined;
    pubKeyCredParams: { alg: number; type: "public-key" }[];
    rp: { id?: string | undefined; name: string };
    timeout?: number | undefined;
    user: { displayName: string; id: string; name: string };
}

export interface PublicKeyCredentialDescriptorJSON {
    id: string;
    transports?: string[] | undefined;
    type?: "public-key" | undefined;
}

/** Subset of `@simplewebauthn`'s `PublicKeyCredentialRequestOptionsJSON`. */
export interface PublicKeyCredentialRequestOptionsJSON {
    allowCredentials?: PublicKeyCredentialDescriptorJSON[] | undefined;
    challenge: string;
    rpId?: string | undefined;
    timeout?: number | undefined;
    userVerification?: "discouraged" | "preferred" | "required" | undefined;
}

interface PasskeyNativeError {
    code?: string;
    error?: string;
    message?: string;
    name?: string;
}

export class PasskeyCancelledError extends Error {
    constructor(message = "Passkey ceremony was cancelled.") {
        super(message);
        this.name = "PasskeyCancelledError";
    }
}

export class PasskeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PasskeyError";
    }
}

export class PasskeyUnsupportedError extends Error {
    constructor(
        message = "Passkeys aren't available on this device. iOS 16+ or Android 9+ with a screen lock is required.",
    ) {
        super(message);
        this.name = "PasskeyUnsupportedError";
    }
}

/**
 * Run the WebAuthn assertion ceremony with options issued by spire's
 * `/auth/passkey/begin` route. Returns the raw response in the JSON
 * form spire's `/auth/passkey/finish` accepts.
 *
 * @throws {PasskeyCancelledError} The user dismissed the prompt.
 * @throws {PasskeyUnsupportedError} The device cannot run the ceremony.
 * @throws {PasskeyError} For any other failure.
 */
export async function authenticatePasskey(
    options: PublicKeyCredentialRequestOptionsJSON,
): Promise<Record<string, unknown>> {
    if (!isPasskeySupported()) {
        throw new PasskeyUnsupportedError();
    }
    if (!options.rpId) {
        throw new PasskeyError(
            "Server did not include an rpId in the passkey challenge.",
        );
    }
    const request: PasskeyGetRequest = {
        challenge: options.challenge,
        rpId: options.rpId,
        ...(options.timeout != null ? { timeout: options.timeout } : {}),
        ...(options.userVerification
            ? { userVerification: options.userVerification }
            : {}),
        ...(options.allowCredentials
            ? {
                  allowCredentials:
                      options.allowCredentials.map(toPasskeyDescriptor),
              }
            : {}),
    };
    try {
        const result = await Passkey.get(request);
        // react-native-passkey returns AuthenticationResponseJSON; the
        // spire endpoint accepts it as `Record<string, unknown>` and
        // `@simplewebauthn/server` does the structural validation.
        return result as unknown as Record<string, unknown>;
    } catch (err: unknown) {
        throw normalizePasskeyError(err);
    }
}

/**
 * Best-effort "is the platform's credential manager available?"
 * check. The actual platform-version gate happens inside
 * `react-native-passkey` (it throws `NotSupportedError` on older
 * OSes), but exposing this synchronously lets the UI hide the
 * passkey buttons up front rather than waiting for the user to tap
 * one and get an alert.
 */
export function isPasskeySupported(): boolean {
    try {
        return Passkey.isSupported();
    } catch {
        return false;
    }
}

/**
 * Run the WebAuthn registration ceremony with the options issued by
 * spire's `/user/:userID/passkeys/register/begin` route. Returns the
 * raw response in the JSON form spire's `register/finish` accepts.
 *
 * @throws {PasskeyCancelledError} The user dismissed the prompt.
 * @throws {PasskeyUnsupportedError} The device cannot run the ceremony.
 * @throws {PasskeyError} For any other failure.
 */
export async function registerPasskey(
    options: PublicKeyCredentialCreationOptionsJSON,
): Promise<Record<string, unknown>> {
    if (!isPasskeySupported()) {
        throw new PasskeyUnsupportedError();
    }
    if (!options.rp.id) {
        throw new PasskeyError(
            "Server did not include an rp.id in the passkey challenge.",
        );
    }
    const request: PasskeyCreateRequest = {
        challenge: options.challenge,
        pubKeyCredParams: options.pubKeyCredParams,
        rp: { id: options.rp.id, name: options.rp.name },
        user: options.user,
        ...(options.timeout != null ? { timeout: options.timeout } : {}),
        ...(options.attestation
            ? { attestation: toAttestation(options.attestation) }
            : {}),
        ...(options.authenticatorSelection
            ? { authenticatorSelection: options.authenticatorSelection }
            : {}),
        ...(options.excludeCredentials
            ? {
                  excludeCredentials:
                      options.excludeCredentials.map(toPasskeyDescriptor),
              }
            : {}),
    };
    try {
        const result = await Passkey.create(request);
        return result as unknown as Record<string, unknown>;
    } catch (err: unknown) {
        throw normalizePasskeyError(err);
    }
}

const KNOWN_TRANSPORTS: ReadonlySet<string> = new Set([
    "ble",
    "hybrid",
    "internal",
    "nfc",
    "smart-card",
    "usb",
]);

type PasskeyDescriptor = PasskeyCreateRequest["excludeCredentials"] extends
    | (infer D)[]
    | undefined
    ? D
    : never;

function asPasskeyNativeError(err: unknown): null | PasskeyNativeError {
    if (err === null || typeof err !== "object") {
        return null;
    }
    const obj = err as Record<string, unknown>;
    const out: PasskeyNativeError = {};
    if (typeof obj["code"] === "string") out.code = obj["code"];
    if (typeof obj["error"] === "string") out.error = obj["error"];
    if (typeof obj["message"] === "string") out.message = obj["message"];
    if (typeof obj["name"] === "string") out.name = obj["name"];
    return out;
}

function normalizePasskeyError(err: unknown): Error {
    const native = asPasskeyNativeError(err);
    if (!native) {
        return new PasskeyError("Passkey ceremony failed.");
    }
    const code = native.code ?? native.error ?? "";
    const message = native.message ?? "";
    const lowered = (code + " " + message).toLowerCase();
    if (
        lowered.includes("abort") ||
        lowered.includes("cancel") ||
        lowered.includes("usercancel") ||
        lowered.includes("user_cancel") ||
        lowered.includes("dismissed") ||
        lowered.includes("interrupted")
    ) {
        return new PasskeyCancelledError();
    }
    if (
        lowered.includes("notsupported") ||
        lowered.includes("not supported") ||
        lowered.includes("unsupported")
    ) {
        return new PasskeyUnsupportedError();
    }
    return new PasskeyError(message.length > 0 ? message : "Passkey failed.");
}

function toAttestation(
    raw: string,
): "direct" | "enterprise" | "indirect" | "none" {
    if (
        raw === "direct" ||
        raw === "enterprise" ||
        raw === "indirect" ||
        raw === "none"
    ) {
        return raw;
    }
    return "none";
}

function toPasskeyDescriptor(
    descriptor: PublicKeyCredentialDescriptorJSON,
): PasskeyDescriptor {
    const filtered = (descriptor.transports ?? [])
        .filter((t: unknown): t is string => typeof t === "string")
        .filter((t) => KNOWN_TRANSPORTS.has(t));
    // The native enum is `usb | nfc | ble | smart-card | hybrid | internal`;
    // the JSON form spire issues uses the same string values verbatim, so
    // assigning a filtered string[] is wire-equivalent.
    if (filtered.length === 0) {
        return { id: descriptor.id, type: "public-key" };
    }
    return {
        id: descriptor.id,

        transports: filtered as NonNullable<PasskeyDescriptor["transports"]>,
        type: "public-key",
    };
}
