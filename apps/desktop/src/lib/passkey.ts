interface PublicKeyCredentialCreationOptionsJSON {
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

interface PublicKeyCredentialDescriptorJSON {
    id: string;
    transports?: string[] | undefined;
    type?: "public-key" | undefined;
}

interface PublicKeyCredentialRequestOptionsJSON {
    allowCredentials?: PublicKeyCredentialDescriptorJSON[] | undefined;
    challenge: string;
    rpId?: string | undefined;
    timeout?: number | undefined;
    userVerification?: "discouraged" | "preferred" | "required" | undefined;
}

export class PasskeyUnsupportedError extends Error {
    constructor(
        message = "Passkeys are not available in this browser or WebView.",
    ) {
        super(message);
        this.name = "PasskeyUnsupportedError";
    }
}

export async function authenticatePasskey(
    options: PublicKeyCredentialRequestOptionsJSON,
): Promise<Record<string, unknown>> {
    ensureWebAuthnSupport();
    const credential = await navigator.credentials.get({
        publicKey: toRequestOptions(options),
    });
    if (!isPublicKeyCredential(credential)) {
        throw new Error("Passkey authentication did not return a credential.");
    }
    const response = credential.response;
    if (!isAuthenticatorAssertionResponse(response)) {
        throw new Error("Passkey authentication returned an invalid response.");
    }
    return {
        authenticatorAttachment: credential.authenticatorAttachment ?? null,
        clientExtensionResults: credential.getClientExtensionResults(),
        id: credential.id,
        rawId: bufferToBase64URL(credential.rawId),
        response: {
            authenticatorData: bufferToBase64URL(response.authenticatorData),
            clientDataJSON: bufferToBase64URL(response.clientDataJSON),
            signature: bufferToBase64URL(response.signature),
            userHandle: response.userHandle
                ? bufferToBase64URL(response.userHandle)
                : null,
        },
        type: credential.type,
    };
}

export async function registerPasskey(
    options: PublicKeyCredentialCreationOptionsJSON,
): Promise<Record<string, unknown>> {
    ensureWebAuthnSupport();
    const credential = await navigator.credentials.create({
        publicKey: toCreationOptions(options),
    });
    if (!isPublicKeyCredential(credential)) {
        throw new Error("Passkey registration did not return a credential.");
    }
    const response = credential.response;
    if (!isAuthenticatorAttestationResponse(response)) {
        throw new Error("Passkey registration returned an invalid response.");
    }
    return {
        authenticatorAttachment: credential.authenticatorAttachment ?? null,
        clientExtensionResults: credential.getClientExtensionResults(),
        id: credential.id,
        rawId: bufferToBase64URL(credential.rawId),
        response: {
            attestationObject: bufferToBase64URL(response.attestationObject),
            clientDataJSON: bufferToBase64URL(response.clientDataJSON),
            transports: response.getTransports?.() ?? [],
        },
        type: credential.type,
    };
}

function base64URLToArrayBuffer(value: string): ArrayBuffer {
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

function bufferToBase64URL(value: ArrayBuffer): string {
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

function ensureWebAuthnSupport(): void {
    if (
        typeof window === "undefined" ||
        !("PublicKeyCredential" in window) ||
        !navigator.credentials
    ) {
        throw new PasskeyUnsupportedError();
    }
}

function isAuthenticatorAssertionResponse(
    response: AuthenticatorResponse,
): response is AuthenticatorAssertionResponse {
    return (
        "authenticatorData" in response &&
        "signature" in response &&
        "userHandle" in response
    );
}

function isAuthenticatorAttestationResponse(
    response: AuthenticatorResponse,
): response is AuthenticatorAttestationResponse {
    return "attestationObject" in response;
}

function isPublicKeyCredential(
    credential: Credential | null,
): credential is PublicKeyCredential {
    return (
        credential !== null &&
        typeof PublicKeyCredential !== "undefined" &&
        credential instanceof PublicKeyCredential
    );
}

function toCreationOptions(
    options: PublicKeyCredentialCreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
    return {
        attestation: options.attestation as AttestationConveyancePreference,
        authenticatorSelection:
            options.authenticatorSelection as AuthenticatorSelectionCriteria,
        challenge: base64URLToArrayBuffer(options.challenge),
        excludeCredentials: options.excludeCredentials?.map(toDescriptor),
        pubKeyCredParams: options.pubKeyCredParams,
        rp: options.rp,
        timeout: options.timeout,
        user: {
            displayName: options.user.displayName,
            id: base64URLToArrayBuffer(options.user.id),
            name: options.user.name,
        },
    };
}

function toDescriptor(
    descriptor: NonNullable<
        PublicKeyCredentialRequestOptionsJSON["allowCredentials"]
    >[number],
): PublicKeyCredentialDescriptor {
    return {
        id: base64URLToArrayBuffer(descriptor.id),
        transports: descriptor.transports as AuthenticatorTransport[],
        type: descriptor.type ?? "public-key",
    };
}

function toRequestOptions(
    options: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
    return {
        allowCredentials: options.allowCredentials?.map(toDescriptor),
        challenge: base64URLToArrayBuffer(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
    };
}
