import type { EncryptedFileAttachment } from "@vex-chat/store";

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";

export interface PickedAttachment {
    contentType: string;
    data: Uint8Array;
    fileName: string;
    fileSize: number;
    previewUri?: string | undefined;
}

export function base64ToBytes(base64Data: string): Uint8Array {
    const decode = globalThis.atob;
    if (typeof decode !== "function") {
        throw new Error("Base64 decoder is unavailable on this device.");
    }
    const binary = decode(base64Data.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
    const encode = globalThis.btoa;
    if (typeof encode !== "function") {
        throw new Error("Base64 encoder is unavailable on this device.");
    }

    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return encode(binary);
}

export async function localFileAttachmentFromUri(input: {
    contentType?: string;
    fileName?: string;
    fileSize?: number;
    uri: string;
}): Promise<PickedAttachment> {
    const fileName = input.fileName || fileNameFromUri(input.uri, "attachment");
    const contentType =
        input.contentType ||
        inferContentTypeFromName(fileName, "application/octet-stream");
    const data = await readUriBytes(input.uri);
    const attachment: PickedAttachment = {
        contentType,
        data,
        fileName,
        fileSize:
            typeof input.fileSize === "number" && input.fileSize >= 0
                ? input.fileSize
                : data.byteLength,
    };
    if (contentType.startsWith("image/")) {
        attachment.previewUri = input.uri;
    }
    return attachment;
}

export async function localVoiceMemoAttachmentFromUri(
    uri: string,
): Promise<PickedAttachment> {
    return localFileAttachmentFromUri({
        contentType: "audio/mp4",
        fileName: `voice-memo-${new Date()
            .toISOString()
            .replace(/[:.]/g, "-")}.m4a`,
        uri,
    });
}

export async function pickFileAttachment(): Promise<null | PickedAttachment> {
    const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ["*/*"],
    });
    if (result.canceled) {
        return null;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri) {
        throw new Error("No file was selected.");
    }

    const fileName = asset.name || fileNameFromUri(asset.uri, "attachment");
    const contentType =
        asset.mimeType ||
        inferContentTypeFromName(fileName, "application/octet-stream");
    const data = await readUriBytes(asset.uri);
    return {
        contentType,
        data,
        fileName,
        fileSize: typeof asset.size === "number" ? asset.size : data.byteLength,
    };
}

export async function pickImageAttachment(): Promise<null | PickedAttachment> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
        throw new Error("Photo library permission is required.");
    }

    const result = await ImagePicker.launchImageLibraryAsync({
        base64: true,
        quality: 0.92,
    });
    if (result.canceled) {
        return null;
    }

    const asset = result.assets[0];
    if (!asset?.uri) {
        throw new Error("No image was selected.");
    }
    if (asset.type != null && asset.type !== "image") {
        throw new Error("Please select an image.");
    }

    const fileName =
        asset.fileName || fileNameFromUri(asset.uri, `image-${Date.now()}.jpg`);
    const contentType =
        asset.mimeType || inferContentTypeFromName(fileName, "image/jpeg");
    const data =
        typeof asset.base64 === "string"
            ? base64ToBytes(asset.base64)
            : await readUriBytes(asset.uri);

    return {
        contentType,
        data,
        fileName,
        fileSize:
            typeof asset.fileSize === "number"
                ? asset.fileSize
                : data.byteLength,
        previewUri: asset.uri,
    };
}

export async function writeAttachmentToCache(
    attachment: EncryptedFileAttachment,
    data: Uint8Array,
): Promise<string> {
    const directory = FileSystem.cacheDirectory;
    if (!directory) {
        throw new Error("Cache directory is unavailable on this device.");
    }
    const uri = `${directory}${Date.now()}-${sanitizeFileName(
        attachment.fileName,
    )}`;
    await FileSystem.writeAsStringAsync(uri, bytesToBase64(data), {
        encoding: FileSystem.EncodingType.Base64,
    });
    return uri;
}

function fileNameFromUri(uri: string, fallback: string): string {
    const raw = uri.split("?")[0]?.split("/").pop();
    if (!raw) {
        return fallback;
    }
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

function inferContentTypeFromName(fileName: string, fallback: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
        case "aac":
            return "audio/aac";
        case "aif":
        case "aiff":
            return "audio/aiff";
        case "avi":
            return "video/x-msvideo";
        case "flac":
            return "audio/flac";
        case "gif":
            return "image/gif";
        case "heic":
            return "image/heic";
        case "jpeg":
        case "jpg":
            return "image/jpeg";
        case "json":
            return "application/json";
        case "m4a":
            return "audio/mp4";
        case "m4v":
            return "video/x-m4v";
        case "md":
            return "text/markdown";
        case "mov":
            return "video/quicktime";
        case "mp3":
            return "audio/mpeg";
        case "mp4":
            return "video/mp4";
        case "mpeg":
        case "mpg":
            return "video/mpeg";
        case "oga":
        case "ogg":
            return "audio/ogg";
        case "ogv":
            return "video/ogg";
        case "pdf":
            return "application/pdf";
        case "png":
            return "image/png";
        case "txt":
            return "text/plain";
        case "wav":
            return "audio/wav";
        case "webm":
            return "video/webm";
        case "webp":
            return "image/webp";
        default:
            return fallback;
    }
}

async function readUriBytes(uri: string): Promise<Uint8Array> {
    const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
    });
    return base64ToBytes(base64);
}

function sanitizeFileName(fileName: string): string {
    const sanitized = fileName
        .replace(/[/"%*:<>?\\|]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    return sanitized || "attachment";
}
