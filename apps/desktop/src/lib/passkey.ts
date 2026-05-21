interface CredentialDescriptorJSON {
    id: string;
    transports?: string[];
    type?: "public-key";
}

interface PublicKeyCredentialCreationOptionsJSON {
    attestation?: string;
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    challenge: string;
    excludeCredentials?: CredentialDescriptorJSON[];
    pubKeyCredParams: PublicKeyCredentialParameters[];
    rp: { id?: string; name: string };
    timeout?: number;
    user: { displayName: string; id: string; name: string };
}

interface PublicKeyCredentialRequestOptionsJSON {
    allowCredentials?: CredentialDescriptorJSON[];
    challenge: string;
    rpId?: string;
    timeout?: number;
    userVerification?: UserVerificationRequirement;
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
        message = "Passkeys are not available in this desktop runtime.",
    ) {
        super(message);
        this.name = "PasskeyUnsupportedError";
    }
}

export async function authenticatePasskey(
    options: PublicKeyCredentialRequestOptionsJSON,
): Promise<Record<string, unknown>> {
    if (!isPasskeySupported()) {
        throw new PasskeyUnsupportedError();
    }
    const credential = (await navigator.credentials.get({
        publicKey: toRequestOptions(options),
    })) as null | PublicKeyCredential;
    if (!credential) {
        throw new PasskeyCancelledError();
    }
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        response: {
            authenticatorData: arrayBufferToBase64url(
                response.authenticatorData,
            ),
            clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
            signature: arrayBufferToBase64url(response.signature),
            userHandle: response.userHandle
                ? arrayBufferToBase64url(response.userHandle)
                : null,
        },
        type: credential.type,
    };
}

export function isPasskeySupported(): boolean {
    return (
        typeof window !== "undefined" &&
        window.isSecureContext &&
        typeof window.PublicKeyCredential === "function" &&
        typeof navigator.credentials?.create === "function" &&
        typeof navigator.credentials?.get === "function"
    );
}

export async function registerPasskey(
    options: PublicKeyCredentialCreationOptionsJSON,
): Promise<Record<string, unknown>> {
    if (!isPasskeySupported()) {
        throw new PasskeyUnsupportedError();
    }
    const credential = (await navigator.credentials.create({
        publicKey: toCreationOptions(options),
    })) as null | PublicKeyCredential;
    if (!credential) {
        throw new PasskeyCancelledError();
    }
    const response = credential.response as AuthenticatorAttestationResponse;
    return {
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        response: {
            attestationObject: arrayBufferToBase64url(
                response.attestationObject,
            ),
            clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
            transports: response.getTransports?.() ?? [],
        },
        type: credential.type,
    };
}

function arrayBufferToBase64url(value: ArrayBuffer): string {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64urlToArrayBuffer(value: string): ArrayBuffer {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    );
}

function toCreationOptions(
    options: PublicKeyCredentialCreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
    return {
        attestation: options.attestation as
            | AttestationConveyancePreference
            | undefined,
        authenticatorSelection: options.authenticatorSelection,
        challenge: base64urlToArrayBuffer(options.challenge),
        excludeCredentials: options.excludeCredentials?.map(
            toCredentialDescriptor,
        ),
        pubKeyCredParams: options.pubKeyCredParams,
        rp: options.rp,
        timeout: options.timeout,
        user: {
            displayName: options.user.displayName,
            id: base64urlToArrayBuffer(options.user.id),
            name: options.user.name,
        },
    };
}

function toCredentialDescriptor(
    descriptor: CredentialDescriptorJSON,
): PublicKeyCredentialDescriptor {
    return {
        id: base64urlToArrayBuffer(descriptor.id),
        transports: descriptor.transports as
            | AuthenticatorTransport[]
            | undefined,
        type: descriptor.type ?? "public-key",
    };
}

function toRequestOptions(
    options: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
    return {
        allowCredentials: options.allowCredentials?.map(toCredentialDescriptor),
        challenge: base64urlToArrayBuffer(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
    };
}
