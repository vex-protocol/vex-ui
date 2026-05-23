import type { PickedAttachment } from "../lib/attachments";
import type { MessageReplyReference } from "@vex-chat/store";
import type { RecordingOptions } from "expo-audio";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Image,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { formatFileSize, isImageType } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import {
    RecordingPresets,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioRecorder,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

import { localVoiceMemoAttachmentFromUri } from "../lib/attachments";
import { haptic } from "../lib/haptics";
import { colors } from "../theme";

interface ComposerAttachment {
    contentType: string;
    fileName: string;
    fileSize: number;
    previewUri?: string | undefined;
}

interface MessageInputBarProps {
    attachment?: ComposerAttachment | null | undefined;
    bottomInset?: number;
    editing?: boolean | undefined;
    onAttachPress?: (() => void) | undefined;
    onCancelEdit?: (() => void) | undefined;
    onCancelReply?: (() => void) | undefined;
    onChangeText: (text: string) => void;
    onRemoveAttachment?: (() => void) | undefined;
    onSend: () => void;
    onVoiceMemoError?: ((message: string) => void) | undefined;
    onVoiceMemoRecorded?: ((attachment: PickedAttachment) => void) | undefined;
    placeholder?: string;
    replyingTo?: MessageReplyReference | null | undefined;
    sending?: boolean;
    value: string;
}

type VoiceMemoPhase =
    | "canceling"
    | "idle"
    | "recording"
    | "starting"
    | "stopping";

interface VoiceMemoRecorderProps {
    onCancel: () => void;
    onError?: ((message: string) => void) | undefined;
    onRecorded: (attachment: PickedAttachment) => void;
    sending: boolean;
}

const VOICE_MEMO_RECORDING_OPTIONS: RecordingOptions = {
    ...RecordingPresets.HIGH_QUALITY,
    android: {
        ...RecordingPresets.HIGH_QUALITY.android,
    },
    bitRate: 64000,
    ios: {
        ...RecordingPresets.HIGH_QUALITY.ios,
    },
    numberOfChannels: 1,
    web: {
        ...RecordingPresets.HIGH_QUALITY.web,
        bitsPerSecond: 64000,
    },
};

export function MessageInputBar({
    attachment = null,
    bottomInset = 0,
    editing = false,
    onAttachPress,
    onCancelEdit,
    onCancelReply,
    onChangeText,
    onRemoveAttachment,
    onSend,
    onVoiceMemoError,
    onVoiceMemoRecorded,
    placeholder = "Message...",
    replyingTo = null,
    sending = false,
    value,
}: MessageInputBarProps) {
    const [voiceMemoOpen, setVoiceMemoOpen] = useState(false);
    const recordingInProgress = voiceMemoOpen;
    const canSend =
        (value.trim().length > 0 || attachment != null) &&
        !sending &&
        !recordingInProgress;
    const canRecordVoiceMemo =
        onVoiceMemoRecorded != null &&
        attachment == null &&
        !editing &&
        !sending &&
        !recordingInProgress;
    const voiceMemoButtonDisabled = !canRecordVoiceMemo;
    const inputRef = useRef<TextInput>(null);

    const closeVoiceMemo = useCallback(() => {
        setVoiceMemoOpen(false);
    }, []);

    const handleVoiceMemoRecorded = useCallback(
        (voiceMemo: PickedAttachment) => {
            onVoiceMemoRecorded?.(voiceMemo);
        },
        [onVoiceMemoRecorded],
    );

    return (
        <View
            style={[
                styles.container,
                Platform.OS === "ios"
                    ? { paddingBottom: 8 + Math.max(0, bottomInset - 2) }
                    : null,
            ]}
        >
            {replyingTo && !editing ? (
                <View style={styles.replyPreview}>
                    <View style={styles.replyRail} />
                    <Ionicons
                        color={colors.textSecondary}
                        name="arrow-undo-outline"
                        size={16}
                    />
                    <View style={styles.replyMeta}>
                        <Text numberOfLines={1} style={styles.replyTitle}>
                            {replyingTo.targetAuthorName ??
                                replyingTo.targetAuthorID?.slice(0, 8) ??
                                "Message"}
                        </Text>
                        <Text numberOfLines={1} style={styles.replyText}>
                            {replyingTo.targetPreview ??
                                replyingTo.targetAttachment?.fileName ??
                                "Original message"}
                        </Text>
                    </View>
                    {replyingTo.targetAttachment ? (
                        <View style={styles.replyAttachmentIcon}>
                            <Ionicons
                                color={colors.muted}
                                name={
                                    isImageType(
                                        replyingTo.targetAttachment.contentType,
                                    )
                                        ? "image-outline"
                                        : "document-outline"
                                }
                                size={16}
                            />
                        </View>
                    ) : null}
                    <TouchableOpacity
                        accessibilityLabel="Cancel reply"
                        accessibilityRole="button"
                        disabled={sending}
                        onPress={onCancelReply}
                        style={[
                            styles.removeAttachmentBtn,
                            sending && styles.actionBtnDisabled,
                        ]}
                    >
                        <Ionicons
                            color={colors.textSecondary}
                            name="close"
                            size={18}
                        />
                    </TouchableOpacity>
                </View>
            ) : null}

            {attachment ? (
                <View style={styles.attachmentPreview}>
                    {attachment.previewUri &&
                    isImageType(attachment.contentType) ? (
                        <Image
                            source={{ uri: attachment.previewUri }}
                            style={styles.attachmentImage}
                        />
                    ) : (
                        <View style={styles.attachmentIconBox}>
                            <Ionicons
                                color={colors.muted}
                                name={
                                    attachment.contentType.startsWith("audio/")
                                        ? "mic-outline"
                                        : "document-text-outline"
                                }
                                size={18}
                            />
                        </View>
                    )}
                    <View style={styles.attachmentMeta}>
                        <Text numberOfLines={1} style={styles.attachmentName}>
                            {attachment.fileName}
                        </Text>
                        <Text style={styles.attachmentSize}>
                            {formatFileSize(attachment.fileSize)}
                        </Text>
                    </View>
                    <TouchableOpacity
                        accessibilityRole="button"
                        disabled={sending}
                        onPress={onRemoveAttachment}
                        style={[
                            styles.removeAttachmentBtn,
                            sending && styles.actionBtnDisabled,
                        ]}
                    >
                        <Ionicons
                            color={colors.textSecondary}
                            name="close"
                            size={18}
                        />
                    </TouchableOpacity>
                </View>
            ) : null}

            {editing ? (
                <View style={styles.editingPreview}>
                    <Ionicons
                        color={colors.textSecondary}
                        name="pencil-outline"
                        size={16}
                    />
                    <Text style={styles.editingText}>Editing message</Text>
                    <TouchableOpacity
                        accessibilityLabel="Cancel edit"
                        accessibilityRole="button"
                        disabled={sending}
                        onPress={onCancelEdit}
                        style={[
                            styles.removeAttachmentBtn,
                            sending && styles.actionBtnDisabled,
                        ]}
                    >
                        <Ionicons
                            color={colors.textSecondary}
                            name="close"
                            size={18}
                        />
                    </TouchableOpacity>
                </View>
            ) : null}

            {voiceMemoOpen && onVoiceMemoRecorded ? (
                <VoiceMemoRecorder
                    onCancel={closeVoiceMemo}
                    onError={onVoiceMemoError}
                    onRecorded={handleVoiceMemoRecorded}
                    sending={sending}
                />
            ) : null}

            <View style={styles.inputRow}>
                <TouchableOpacity
                    accessibilityRole="button"
                    disabled={sending || recordingInProgress || editing}
                    onPress={() => {
                        haptic("selection");
                        onAttachPress?.();
                    }}
                    style={[
                        styles.actionBtn,
                        (sending || recordingInProgress || editing) &&
                            styles.actionBtnDisabled,
                    ]}
                >
                    <Ionicons
                        color={colors.muted}
                        name="attach-outline"
                        size={20}
                    />
                </TouchableOpacity>

                <TextInput
                    accessibilityLabel="Message input"
                    multiline
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={colors.mutedDark}
                    ref={inputRef}
                    scrollEnabled
                    style={styles.input}
                    submitBehavior="newline"
                    value={value}
                />

                {onVoiceMemoRecorded ? (
                    <TouchableOpacity
                        accessibilityLabel={
                            recordingInProgress
                                ? "Voice memo recording"
                                : "Record voice memo"
                        }
                        accessibilityRole="button"
                        disabled={voiceMemoButtonDisabled}
                        onPress={() => {
                            setVoiceMemoOpen(true);
                        }}
                        style={[
                            styles.actionBtn,
                            voiceMemoButtonDisabled && styles.actionBtnDisabled,
                        ]}
                    >
                        <Ionicons
                            color={colors.muted}
                            name="mic-outline"
                            size={20}
                        />
                    </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                    accessibilityLabel="Send message"
                    accessibilityRole="button"
                    disabled={!canSend}
                    onPress={() => {
                        haptic("confirm");
                        onSend();
                    }}
                    style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
                >
                    <Ionicons color={colors.text} name="arrow-up" size={18} />
                </TouchableOpacity>
            </View>
        </View>
    );
}

function VoiceMemoRecorder({
    onCancel,
    onError,
    onRecorded,
    sending,
}: VoiceMemoRecorderProps) {
    const recorder = useAudioRecorder(VOICE_MEMO_RECORDING_OPTIONS);
    const [recordingPhase, setRecordingPhaseState] =
        useState<VoiceMemoPhase>("starting");
    const [recordingActive, setRecordingActive] = useState(false);
    const [durationMillis, setDurationMillis] = useState(0);
    const mountedRef = useRef(true);
    const recordingActiveRef = useRef(false);
    const recordingPhaseRef = useRef<VoiceMemoPhase>("starting");
    const recordingStartedAtRef = useRef(0);
    const recordedUriRef = useRef<null | string>(null);
    const startAttemptedRef = useRef(false);
    const startTokenRef = useRef(0);
    const canFinishVoiceMemo =
        recordingActive &&
        recordingPhase !== "canceling" &&
        recordingPhase !== "stopping";

    const setRecordingPhase = useCallback((phase: VoiceMemoPhase) => {
        recordingPhaseRef.current = phase;
        setRecordingPhaseState(phase);
    }, []);

    const setRecordingActiveState = useCallback((active: boolean) => {
        recordingActiveRef.current = active;
        setRecordingActive(active);
    }, []);

    const resetAudioMode = useCallback(async () => {
        if (Platform.OS !== "ios") {
            return;
        }
        await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
        });
    }, []);

    useEffect(() => {
        if (recordingPhase !== "recording") {
            return;
        }
        const interval = setInterval(() => {
            const startedAt = recordingStartedAtRef.current;
            if (startedAt > 0) {
                setDurationMillis(Date.now() - startedAt);
            }
        }, 250);
        return () => {
            clearInterval(interval);
        };
    }, [recordingPhase]);

    const isCurrentStart = useCallback((token: number): boolean => {
        return (
            mountedRef.current &&
            startTokenRef.current === token &&
            recordingPhaseRef.current === "starting"
        );
    }, []);

    const startVoiceMemo = useCallback(async () => {
        if (recordingPhaseRef.current !== "starting") {
            return;
        }
        const startToken = startTokenRef.current + 1;
        startTokenRef.current = startToken;
        onError?.("");
        try {
            const permission = await requestRecordingPermissionsAsync();
            if (!isCurrentStart(startToken)) {
                return;
            }
            if (!permission.granted) {
                onError?.("Microphone permission is required.");
                setRecordingPhase("idle");
                haptic("error");
                onCancel();
                return;
            }

            if (Platform.OS === "ios") {
                await setAudioModeAsync({
                    allowsRecording: true,
                    playsInSilentMode: true,
                });
            }
            if (!isCurrentStart(startToken)) {
                await resetAudioMode().catch(() => {
                    /* ignore */
                });
                return;
            }
            await recorder.prepareToRecordAsync();
            recordedUriRef.current = recorder.uri ?? null;
            if (!isCurrentStart(startToken)) {
                await resetAudioMode().catch(() => {
                    /* ignore */
                });
                return;
            }
            recorder.record();
            if (!isCurrentStart(startToken)) {
                await Promise.resolve(recorder.stop()).catch(() => {
                    /* ignore */
                });
                await resetAudioMode().catch(() => {
                    /* ignore */
                });
                return;
            }
            recordedUriRef.current = recorder.uri ?? recordedUriRef.current;
            recordingStartedAtRef.current = Date.now();
            setDurationMillis(0);
            setRecordingActiveState(true);
            setRecordingPhase("recording");
            haptic("confirm");
        } catch (err: unknown) {
            await resetAudioMode().catch(() => {
                /* ignore */
            });
            if (isCurrentStart(startToken)) {
                onError?.(
                    err instanceof Error
                        ? err.message
                        : "Could not start recording.",
                );
                setRecordingPhase("idle");
                haptic("error");
                onCancel();
            }
        } finally {
            const phase = recordingPhaseRef.current as VoiceMemoPhase;
            if (!mountedRef.current) {
                return;
            }
            if (phase === "canceling") {
                setRecordingPhase("idle");
                onCancel();
                return;
            }
            if (phase === "starting") {
                setRecordingPhase("idle");
            }
        }
    }, [
        isCurrentStart,
        onCancel,
        onError,
        recorder,
        resetAudioMode,
        setRecordingActiveState,
        setRecordingPhase,
    ]);

    const stopVoiceMemo = useCallback(async () => {
        if (
            !recordingActiveRef.current ||
            recordingPhaseRef.current === "canceling" ||
            recordingPhaseRef.current === "starting" ||
            recordingPhaseRef.current === "stopping"
        ) {
            return;
        }
        startTokenRef.current += 1;
        setRecordingPhase("stopping");
        setRecordingActiveState(false);
        onError?.("");
        let completed = false;
        let recordedUri: null | string = null;
        try {
            const stopResult = await Promise.resolve(recorder.stop());
            recordedUri =
                recordingUriFromStopResult(stopResult) ??
                recorder.uri ??
                recordedUriRef.current;
            await resetAudioMode();
            if (!recordedUri) {
                throw new Error("Recording did not produce an audio file.");
            }
            recordedUriRef.current = recordedUri;
            await waitForReadableUri(recordedUri);

            const voiceMemo =
                await localVoiceMemoAttachmentFromUri(recordedUri);
            if (voiceMemo.fileSize <= 0) {
                throw new Error("Recording did not produce any audio.");
            }
            onRecorded(voiceMemo);
            completed = true;
            haptic("success");
        } catch (err: unknown) {
            if (recordedUri) {
                await FileSystem.deleteAsync(recordedUri, {
                    idempotent: true,
                }).catch(() => {
                    /* ignore */
                });
            }
            await resetAudioMode().catch(() => {
                /* ignore */
            });
            onError?.(
                err instanceof Error
                    ? err.message
                    : "Could not finish recording.",
            );
            haptic("error");
        } finally {
            if (mountedRef.current) {
                setRecordingActiveState(false);
                setRecordingPhase("idle");
                if (completed) {
                    onCancel();
                }
            }
        }
    }, [
        onCancel,
        onError,
        onRecorded,
        recorder,
        resetAudioMode,
        setRecordingActiveState,
        setRecordingPhase,
    ]);

    const cancelVoiceMemo = useCallback(async () => {
        if (
            (!recordingActiveRef.current &&
                recordingPhaseRef.current === "idle") ||
            recordingPhaseRef.current === "canceling" ||
            recordingPhaseRef.current === "stopping"
        ) {
            return;
        }
        const phaseAtCancel = recordingPhaseRef.current;
        startTokenRef.current += 1;
        setRecordingPhase("canceling");
        setRecordingActiveState(false);
        onError?.("");
        const previousUri = recorder.uri ?? recordedUriRef.current;
        try {
            if (recordingActiveRef.current || phaseAtCancel === "recording") {
                await Promise.resolve(recorder.stop()).catch(() => {
                    /* ignore */
                });
            }
            const recordedUri = recorder.uri ?? previousUri;
            if (recordedUri) {
                await FileSystem.deleteAsync(recordedUri, {
                    idempotent: true,
                }).catch(() => {
                    /* ignore */
                });
            }
            await resetAudioMode().catch(() => {
                /* ignore */
            });
            haptic("selection");
        } finally {
            setRecordingActiveState(false);
            if (mountedRef.current && phaseAtCancel !== "starting") {
                setRecordingPhase("idle");
                onCancel();
            }
        }
    }, [
        onCancel,
        onError,
        recorder,
        resetAudioMode,
        setRecordingActiveState,
        setRecordingPhase,
    ]);

    useEffect(() => {
        mountedRef.current = true;
        if (!startAttemptedRef.current) {
            startAttemptedRef.current = true;
            void startVoiceMemo();
        }
        return () => {
            mountedRef.current = false;
            startTokenRef.current += 1;
            const shouldStop =
                recordingActiveRef.current ||
                recordingPhaseRef.current === "recording";
            recordingActiveRef.current = false;
            void (async () => {
                if (shouldStop) {
                    await Promise.resolve(recorder.stop()).catch(() => {
                        /* ignore */
                    });
                }
                await resetAudioMode().catch(() => {
                    /* ignore */
                });
            })();
        };
    }, [recorder, resetAudioMode, startVoiceMemo]);

    return (
        <View style={styles.recordingBar}>
            <View style={styles.recordingIndicator} />
            <Text style={styles.recordingDuration}>
                {formatRecordingStatus(recordingPhase, durationMillis)}
            </Text>
            <TouchableOpacity
                accessibilityLabel="Cancel voice memo"
                accessibilityRole="button"
                disabled={
                    sending ||
                    recordingPhase === "canceling" ||
                    recordingPhase === "stopping"
                }
                onPress={() => void cancelVoiceMemo()}
                style={[
                    styles.recordingButton,
                    (sending ||
                        recordingPhase === "canceling" ||
                        recordingPhase === "stopping") &&
                        styles.actionBtnDisabled,
                ]}
            >
                <Ionicons color={colors.textSecondary} name="close" size={18} />
            </TouchableOpacity>
            <TouchableOpacity
                accessibilityLabel="Finish voice memo"
                accessibilityRole="button"
                disabled={sending || !canFinishVoiceMemo}
                onPress={() => void stopVoiceMemo()}
                style={[
                    styles.recordingButton,
                    styles.recordingStopButton,
                    (sending || !canFinishVoiceMemo) &&
                        styles.actionBtnDisabled,
                ]}
            >
                <Ionicons color={colors.text} name="stop" size={16} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    actionBtn: {
        alignItems: "center",
        borderColor: colors.border,
        borderRadius: 18,
        borderWidth: 1,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    actionBtnDisabled: {
        opacity: 0.45,
    },
    attachmentIconBox: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        height: 42,
        justifyContent: "center",
        width: 42,
    },
    attachmentImage: {
        backgroundColor: colors.input,
        height: 42,
        width: 42,
    },
    attachmentMeta: {
        flex: 1,
        minWidth: 0,
    },
    attachmentName: {
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: "600",
    },
    attachmentPreview: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        padding: 8,
    },
    attachmentSize: {
        color: colors.muted,
        fontSize: 11,
    },
    container: {
        backgroundColor: colors.surface,
        borderTopColor: colors.borderSubtle,
        borderTopWidth: 1,
        gap: 8,
        padding: 8,
    },
    editingPreview: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        minHeight: 38,
        paddingLeft: 12,
        paddingRight: 4,
    },
    editingText: {
        color: colors.textSecondary,
        flex: 1,
        fontSize: 12,
        fontWeight: "600",
    },
    input: {
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        color: colors.textSecondary,
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
        maxHeight: 132,
        minHeight: 40,
        paddingHorizontal: 12,
        paddingVertical: 8,
        textAlignVertical: "top",
    },
    inputRow: {
        alignItems: "flex-end",
        flexDirection: "row",
        gap: 8,
    },
    recordingActiveBtn: {
        borderColor: "rgba(229, 57, 53, 0.55)",
    },
    recordingBar: {
        alignItems: "center",
        backgroundColor: "rgba(229, 57, 53, 0.08)",
        borderColor: "rgba(229, 57, 53, 0.22)",
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    recordingButton: {
        alignItems: "center",
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        height: 32,
        justifyContent: "center",
        width: 32,
    },
    recordingDuration: {
        color: colors.textSecondary,
        flex: 1,
        fontSize: 13,
        fontVariant: ["tabular-nums"],
        fontWeight: "600",
    },
    recordingIndicator: {
        backgroundColor: colors.error,
        borderRadius: 4,
        height: 8,
        width: 8,
    },
    recordingStopButton: {
        backgroundColor: colors.error,
        borderColor: "rgba(229, 57, 53, 0.72)",
    },
    removeAttachmentBtn: {
        alignItems: "center",
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        height: 32,
        justifyContent: "center",
        width: 32,
    },
    replyAttachmentIcon: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        height: 32,
        justifyContent: "center",
        width: 32,
    },
    replyMeta: {
        flex: 1,
        minWidth: 0,
    },
    replyPreview: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        minHeight: 42,
        paddingLeft: 10,
        paddingRight: 4,
        paddingVertical: 6,
    },
    replyRail: {
        alignSelf: "stretch",
        backgroundColor: "rgba(138,180,255,0.58)",
        width: 2,
    },
    replyText: {
        color: colors.muted,
        fontSize: 11,
    },
    replyTitle: {
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: "700",
    },
    sendBtn: {
        alignItems: "center",
        backgroundColor: colors.accent,
        borderRadius: 18,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    sendBtnDisabled: {
        opacity: 0.4,
    },
});

function formatRecordingDuration(durationMillis: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRecordingStatus(
    phase: VoiceMemoPhase,
    durationMillis: number,
): string {
    switch (phase) {
        case "canceling":
            return "Canceling...";
        case "idle":
        case "recording":
            return formatRecordingDuration(durationMillis);
        case "starting":
            return "Preparing...";
        case "stopping":
            return "Finishing...";
    }
}

function recordingUriFromStopResult(result: unknown): null | string {
    if (!result || typeof result !== "object" || !("url" in result)) {
        return null;
    }
    const url = result.url;
    return typeof url === "string" && url.length > 0 ? url : null;
}

async function waitForReadableUri(uri: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const info = await FileSystem.getInfoAsync(uri).catch(() => null);
        if (info?.exists && ("size" in info ? info.size > 0 : true)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
