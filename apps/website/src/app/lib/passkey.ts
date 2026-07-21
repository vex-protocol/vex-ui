interface CredentialDescriptorJSON {
    id: string;
    transports?: string[];
    type?: "public-key";
}

interface CreationOptionsJSON {
    attestation?: string;
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    challenge: string;
    excludeCredentials?: CredentialDescriptorJSON[];
    pubKeyCredParams: PublicKeyCredentialParameters[];
    rp: PublicKeyCredentialRpEntity;
    timeout?: number;
    user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
}

interface RequestOptionsJSON {
    allowCredentials?: CredentialDescriptorJSON[];
    challenge: string;
    rpId?: string;
    timeout?: number;
    userVerification?: UserVerificationRequirement;
}

export function passkeysAvailable(): boolean {
    return (
        typeof window.PublicKeyCredential !== "undefined" &&
        Boolean(navigator.credentials)
    );
}

export async function authenticatePasskey(
    options: RequestOptionsJSON,
): Promise<Record<string, unknown>> {
    ensurePasskeys();
    const credential = await navigator.credentials.get({
        publicKey: {
            allowCredentials: options.allowCredentials?.map(toDescriptor),
            challenge: base64URLToBuffer(options.challenge),
            rpId: options.rpId,
            timeout: options.timeout,
            userVerification: options.userVerification,
        },
    });
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error("Passkey authentication did not return a credential.");
    }
    const response = credential.response;
    if (!(response instanceof AuthenticatorAssertionResponse)) {
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
    options: CreationOptionsJSON,
): Promise<Record<string, unknown>> {
    ensurePasskeys();
    const credential = await navigator.credentials.create({
        publicKey: {
            attestation: options.attestation as AttestationConveyancePreference,
            authenticatorSelection: options.authenticatorSelection,
            challenge: base64URLToBuffer(options.challenge),
            excludeCredentials: options.excludeCredentials?.map(toDescriptor),
            pubKeyCredParams: options.pubKeyCredParams,
            rp: options.rp,
            timeout: options.timeout,
            user: {
                ...options.user,
                id: base64URLToBuffer(options.user.id),
            },
        },
    });
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error("Passkey registration did not return a credential.");
    }
    const response = credential.response;
    if (!(response instanceof AuthenticatorAttestationResponse)) {
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

function base64URLToBuffer(value: string): ArrayBuffer {
    const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
    );
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
        .buffer;
}

function bufferToBase64URL(value: ArrayBuffer): string {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/gu, "");
}

function ensurePasskeys(): void {
    if (!passkeysAvailable()) {
        throw new Error("Passkeys are not available in this browser.");
    }
}

function toDescriptor(
    descriptor: CredentialDescriptorJSON,
): PublicKeyCredentialDescriptor {
    return {
        id: base64URLToBuffer(descriptor.id),
        transports: descriptor.transports as AuthenticatorTransport[],
        type: descriptor.type ?? "public-key",
    };
}
