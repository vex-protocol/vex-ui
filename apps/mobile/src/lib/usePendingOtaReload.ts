import { useEffect, useRef } from "react";

import * as Updates from "expo-updates";

import {
    restartForOtaUpdate,
    shouldAutoReloadPendingOtaUpdate,
} from "./appUpdates";

interface PendingOtaReloadOptions {
    onError?: ((message: string) => void) | undefined;
    onRestarting?: (() => void) | undefined;
}

export function usePendingOtaReload({
    onError,
    onRestarting,
}: PendingOtaReloadOptions = {}): Updates.UseUpdatesReturnType {
    const updateState = Updates.useUpdates();
    const handledPendingUpdateRef = useRef(false);

    useEffect(() => {
        if (!Updates.isEnabled || __DEV__) {
            return;
        }
        if (!updateState.isUpdatePending) {
            handledPendingUpdateRef.current = false;
            return;
        }
        if (handledPendingUpdateRef.current) {
            return;
        }
        if (!shouldAutoReloadPendingOtaUpdate()) {
            return;
        }

        handledPendingUpdateRef.current = true;
        onRestarting?.();
        void restartForOtaUpdate().catch((err: unknown) => {
            handledPendingUpdateRef.current = false;
            onError?.(errorMessage(err));
        });
    }, [onError, onRestarting, updateState.isUpdatePending]);

    return updateState;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
