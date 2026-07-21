import type { Device } from "@vex-chat/libvex";
import type { DeviceApprovalRequest } from "@vex-chat/store";

import {
    Check,
    Clock3,
    Laptop,
    LoaderCircle,
    RefreshCw,
    ShieldCheck,
    Smartphone,
    Trash2,
    X,
} from "lucide-preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { $user, vexService } from "@vex-chat/store";

import { useStoreValue } from "../../lib/useStoreValue";

export function DeviceSettings() {
    const user = useStoreValue($user);
    const [devices, setDevices] = useState<Device[]>([]);
    const [requests, setRequests] = useState<DeviceApprovalRequest[]>([]);
    const [currentDeviceID, setCurrentDeviceID] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const refresh = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        setError("");
        try {
            const [session, deviceList, requestList] = await Promise.all([
                vexService.getSessionInfo(),
                vexService.listMyDevices(),
                vexService.listPendingDeviceRequests(),
            ]);
            setCurrentDeviceID(session?.deviceID ?? "");
            setDevices(deviceList);
            setRequests(
                requestList
                    .filter((request) => request.status === "pending")
                    .sort(
                        (a, b) =>
                            new Date(b.createdAt).getTime() -
                            new Date(a.createdAt).getTime(),
                    ),
            );
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not load your devices."));
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) void refresh();
    }, [refresh, user?.userID]);

    useEffect(
        () =>
            vexService.onDeviceRequestQueueChanged(() => {
                void refresh(true);
            }),
        [refresh, user?.userID],
    );

    async function handleRequest(
        request: DeviceApprovalRequest,
        action: "approve" | "reject",
    ) {
        if (busy[request.requestID]) return;
        setBusy((current) => ({ ...current, [request.requestID]: true }));
        setError("");
        setNotice("");
        try {
            const result =
                action === "approve"
                    ? await vexService.approveDeviceRequest(request.requestID)
                    : await vexService.rejectDeviceRequest(request.requestID);
            if (!result.ok) {
                setError(
                    result.error ?? `Could not ${action} this device request.`,
                );
                return;
            }
            setNotice(
                action === "approve"
                    ? `${request.deviceName || "New device"} approved.`
                    : "Device request rejected.",
            );
            await refresh(true);
        } finally {
            setBusy((current) => ({ ...current, [request.requestID]: false }));
        }
    }

    async function removeDevice(device: Device) {
        if (
            busy[device.deviceID] ||
            device.deviceID === currentDeviceID ||
            devices.length <= 1 ||
            !window.confirm(
                `Remove ${device.name || "this device"}? It will need approval before signing in again.`,
            )
        ) {
            return;
        }
        setBusy((current) => ({ ...current, [device.deviceID]: true }));
        setError("");
        setNotice("");
        try {
            const result = await vexService.removeDevice(device.deviceID);
            if (!result.ok) {
                setError(result.error ?? "Could not remove this device.");
                return;
            }
            setNotice(`${device.name || "Device"} removed.`);
            await refresh(true);
        } finally {
            setBusy((current) => ({ ...current, [device.deviceID]: false }));
        }
    }

    return (
        <div className="account-settings-content">
            <header className="account-settings-intro">
                <span className="account-settings-intro__icon">
                    <ShieldCheck size={20} />
                </span>
                <div>
                    <span>Account security</span>
                    <h1>Devices</h1>
                    <p>
                        Review signed-in devices and approve new ones only when
                        the verification code matches exactly.
                    </p>
                </div>
            </header>

            <Feedback error={error} notice={notice} />

            <section className="preference-section">
                <div className="preference-section__heading">
                    <h2>Device requests</h2>
                    <button
                        aria-label="Refresh devices"
                        className="settings-icon-button"
                        disabled={loading}
                        title="Refresh devices"
                        type="button"
                        onClick={() => void refresh()}
                    >
                        <RefreshCw
                            className={loading ? "spin" : undefined}
                            size={15}
                        />
                    </button>
                </div>
                <div className="preference-rows">
                    {requests.map((request) => {
                        const requestBusy = busy[request.requestID];
                        return (
                            <div
                                className="device-request-row"
                                key={request.requestID}
                            >
                                <span className="preference-row__icon">
                                    <Smartphone size={17} />
                                </span>
                                <span className="preference-row__copy">
                                    <strong>
                                        {request.deviceName || "New device"}
                                    </strong>
                                    <small>
                                        Requested{" "}
                                        {formatDate(request.createdAt)}
                                    </small>
                                    <span className="device-request-row__hint">
                                        Confirm this code on the new device
                                    </span>
                                    <code className="device-verification-code">
                                        {matchingCode(request.signKey)}
                                    </code>
                                </span>
                                <span className="device-request-row__actions">
                                    <button
                                        className="button button--secondary is-danger"
                                        disabled={requestBusy}
                                        type="button"
                                        onClick={() =>
                                            void handleRequest(
                                                request,
                                                "reject",
                                            )
                                        }
                                    >
                                        <X size={15} /> Reject
                                    </button>
                                    <button
                                        className="button button--primary"
                                        disabled={requestBusy}
                                        type="button"
                                        onClick={() =>
                                            void handleRequest(
                                                request,
                                                "approve",
                                            )
                                        }
                                    >
                                        {requestBusy ? (
                                            <LoaderCircle
                                                className="spin"
                                                size={15}
                                            />
                                        ) : (
                                            <Check size={15} />
                                        )}
                                        Approve
                                    </button>
                                </span>
                            </div>
                        );
                    })}
                    {!loading && !requests.length ? (
                        <div className="preference-row preference-row--empty">
                            <span className="preference-row__icon">
                                <Check size={17} />
                            </span>
                            <span className="preference-row__copy">
                                <strong>No pending requests</strong>
                                <small>
                                    New browsers and devices appear here after
                                    verifying your password or passkey.
                                </small>
                            </span>
                        </div>
                    ) : null}
                </div>
            </section>

            <section className="preference-section">
                <h2>Your devices</h2>
                <div className="preference-rows">
                    {devices.map((device) => {
                        const current = device.deviceID === currentDeviceID;
                        const deviceBusy = busy[device.deviceID];
                        return (
                            <div
                                className="preference-row"
                                key={device.deviceID}
                            >
                                <span className="preference-row__icon">
                                    {current ? (
                                        <Laptop size={17} />
                                    ) : (
                                        <Smartphone size={17} />
                                    )}
                                </span>
                                <span className="preference-row__copy">
                                    <strong>
                                        {device.name || "Unnamed device"}
                                        {current ? (
                                            <span className="neutral-badge">
                                                This device
                                            </span>
                                        ) : null}
                                    </strong>
                                    <small>
                                        <Clock3 size={12} /> Last login{" "}
                                        {formatDate(device.lastLogin)}
                                    </small>
                                    <code>{device.deviceID}</code>
                                </span>
                                {!current ? (
                                    <button
                                        aria-label={`Remove ${device.name || "device"}`}
                                        className="settings-icon-button is-danger"
                                        disabled={
                                            deviceBusy || devices.length <= 1
                                        }
                                        title={
                                            devices.length <= 1
                                                ? "Your last device cannot be removed"
                                                : `Remove ${device.name || "device"}`
                                        }
                                        type="button"
                                        onClick={() =>
                                            void removeDevice(device)
                                        }
                                    >
                                        {deviceBusy ? (
                                            <LoaderCircle
                                                className="spin"
                                                size={15}
                                            />
                                        ) : (
                                            <Trash2 size={15} />
                                        )}
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                    {loading && !devices.length ? (
                        <div className="settings-loading">
                            <LoaderCircle className="spin" size={16} /> Loading
                            devices
                        </div>
                    ) : null}
                </div>
            </section>
        </div>
    );
}

function Feedback({ error, notice }: { error: string; notice: string }) {
    if (!error && !notice) return null;
    return (
        <div
            className={error ? "status status--error" : "status status--notice"}
            role={error ? "alert" : "status"}
        >
            {error || notice}
        </div>
    );
}

function matchingCode(signKey: string): string {
    return signKey
        .replace(/[^0-9a-f]/giu, "")
        .slice(0, 4)
        .toUpperCase()
        .padEnd(4, "-");
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}
