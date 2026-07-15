import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

import { base64ToBytes } from "./attachments";

export const MAX_SERVER_ICON_BYTES = 5 * 1024 * 1024;

export async function prepareServerIcon(uri: string): Promise<Uint8Array> {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- pinned Expo runtime
    const prepared = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { height: 512, width: 512 } }],
        {
            compress: 0.9,
            format: ImageManipulator.SaveFormat.JPEG,
        },
    );
    const base64 = await FileSystem.readAsStringAsync(prepared.uri, {
        encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToBytes(base64);
    if (bytes.byteLength > MAX_SERVER_ICON_BYTES) {
        throw new Error("Group icons must be 5 MB or smaller.");
    }
    return bytes;
}
