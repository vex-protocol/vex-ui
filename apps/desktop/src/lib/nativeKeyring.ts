import { invoke } from "@tauri-apps/api/core";

export function deleteKeyringPassword(
    service: string,
    user: string,
): Promise<void> {
    return invoke("keyring_delete_password", { service, user });
}

export function getKeyringPassword(
    service: string,
    user: string,
): Promise<null | string> {
    return invoke<null | string>("keyring_get_password", { service, user });
}

export function setKeyringPassword(
    service: string,
    user: string,
    password: string,
): Promise<void> {
    return invoke("keyring_set_password", { password, service, user });
}
