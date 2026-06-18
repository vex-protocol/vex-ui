import type { AppScreenProps } from "../navigation/types";
import type { CameraCapturedPicture, CameraType, FlashMode } from "expo-camera";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Linking,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";

import {
    $cameraCaptureResult,
    nextCameraCaptureRequestId,
} from "../lib/cameraCaptureResult";
import { haptic } from "../lib/haptics";
import { colors } from "../theme";

interface IconButtonProps {
    accessibilityLabel: string;
    disabled?: boolean | undefined;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    label?: string | undefined;
    onPress: () => void;
}

export function CameraCaptureScreen({
    navigation,
    route,
}: AppScreenProps<"CameraCapture">) {
    const { source } = route.params;
    const cameraRef = useRef<CameraView | null>(null);
    const isFocused = useIsFocused();
    const [permission, requestPermission] = useCameraPermissions();
    const [facing, setFacing] = useState<CameraType>("back");
    const [flash, setFlash] = useState<FlashMode>("off");
    const [cameraReady, setCameraReady] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [usingPhoto, setUsingPhoto] = useState(false);
    const [capturedPhoto, setCapturedPhoto] =
        useState<CameraCapturedPicture | null>(null);
    const [error, setError] = useState<null | string>(null);
    const usePhotoInFlightRef = useRef(false);
    const previewActive = isFocused && capturedPhoto === null;
    const canCapture = cameraReady && !capturing && previewActive;

    useEffect(() => {
        setCameraReady(false);
        setError(null);
    }, [facing]);

    const handleClose = useCallback(() => {
        if (usePhotoInFlightRef.current) {
            return;
        }
        haptic("tap");
        navigation.goBack();
    }, [navigation]);

    const handleFlip = useCallback(() => {
        if (capturedPhoto !== null || capturing) {
            return;
        }
        haptic("selection");
        setFacing((current) => (current === "back" ? "front" : "back"));
    }, [capturedPhoto, capturing]);

    const handleFlash = useCallback(() => {
        if (capturedPhoto !== null || capturing) {
            return;
        }
        haptic("selection");
        setFlash((current) => {
            switch (current) {
                case "auto":
                    return "off";
                case "off":
                    return "on";
                default:
                    return "auto";
            }
        });
    }, [capturedPhoto, capturing]);

    const handleCapture = useCallback(() => {
        void (async () => {
            if (!canCapture || !cameraRef.current) {
                return;
            }
            setCapturing(true);
            setError(null);
            try {
                const photo = await cameraRef.current.takePictureAsync({
                    base64: false,
                    exif: false,
                    quality: 0.92,
                });
                if (!photo?.uri) {
                    throw new Error("Camera did not return a photo.");
                }
                haptic("confirm");
                setCapturedPhoto(photo);
            } catch (err: unknown) {
                haptic("error");
                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not take a photo.",
                );
            } finally {
                setCapturing(false);
            }
        })();
    }, [canCapture]);

    const handleRetake = useCallback(() => {
        if (usePhotoInFlightRef.current) {
            return;
        }
        haptic("selection");
        setCapturedPhoto(null);
        setCameraReady(false);
        setError(null);
    }, []);

    const handleUsePhoto = useCallback(() => {
        if (!capturedPhoto?.uri || usePhotoInFlightRef.current) {
            return;
        }
        usePhotoInFlightRef.current = true;
        setUsingPhoto(true);
        haptic("success");
        $cameraCaptureResult.set({
            height: capturedPhoto.height,
            requestId: nextCameraCaptureRequestId(),
            source,
            uri: capturedPhoto.uri,
            width: capturedPhoto.width,
        });
        navigation.goBack();
    }, [capturedPhoto, navigation, source]);

    if (!permission) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator color={colors.text} />
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={styles.permissionScreen}>
                <View style={styles.permissionIcon}>
                    <Ionicons
                        color={colors.textSecondary}
                        name="camera-outline"
                        size={26}
                    />
                </View>
                <Text style={styles.permissionTitle}>Camera access needed</Text>
                <Text style={styles.permissionBody}>
                    Allow camera access to take a photo inside Vex.
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                        haptic("tap");
                        if (permission.canAskAgain) {
                            void requestPermission();
                            return;
                        }
                        void Linking.openSettings();
                    }}
                    style={({ pressed }) => [
                        styles.permissionButton,
                        pressed && styles.buttonPressed,
                    ]}
                >
                    <Text style={styles.permissionButtonText}>
                        {permission.canAskAgain
                            ? "Allow Camera"
                            : "Open Settings"}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={handleClose}
                    style={({ pressed }) => [
                        styles.secondaryTextButton,
                        pressed && styles.buttonPressed,
                    ]}
                >
                    <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.stage}>
                {capturedPhoto ? (
                    <Image
                        resizeMode="contain"
                        source={{ uri: capturedPhoto.uri }}
                        style={styles.previewImage}
                    />
                ) : previewActive ? (
                    <CameraView
                        active={previewActive}
                        facing={facing}
                        flash={flash}
                        onCameraReady={() => {
                            setCameraReady(true);
                        }}
                        onMountError={(event) => {
                            setError(event.message);
                        }}
                        ref={cameraRef}
                        style={styles.camera}
                    />
                ) : null}

                {!cameraReady && previewActive ? (
                    <View pointerEvents="none" style={styles.loadingOverlay}>
                        <ActivityIndicator color={colors.text} />
                    </View>
                ) : null}
            </View>

            <View style={styles.topBar}>
                <IconButton
                    accessibilityLabel="Close camera"
                    disabled={capturing || usingPhoto}
                    icon="close"
                    onPress={handleClose}
                />
                {capturedPhoto ? null : (
                    <View style={styles.topActions}>
                        <IconButton
                            accessibilityLabel="Toggle flash"
                            disabled={capturing}
                            icon={
                                flash === "off"
                                    ? "flash-off-outline"
                                    : flash === "auto"
                                      ? "flash-outline"
                                      : "flash"
                            }
                            label={flash === "auto" ? "A" : undefined}
                            onPress={handleFlash}
                        />
                        <IconButton
                            accessibilityLabel="Flip camera"
                            disabled={capturing}
                            icon="camera-reverse-outline"
                            onPress={handleFlip}
                        />
                    </View>
                )}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {capturedPhoto ? (
                <View style={styles.confirmBar}>
                    <Pressable
                        accessibilityRole="button"
                        disabled={usingPhoto}
                        onPress={handleRetake}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            pressed && !usingPhoto && styles.buttonPressed,
                            usingPhoto && styles.buttonDisabled,
                        ]}
                    >
                        <Ionicons
                            color={colors.textSecondary}
                            name="refresh-outline"
                            size={18}
                        />
                        <Text style={styles.secondaryButtonText}>Retake</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        disabled={usingPhoto}
                        onPress={handleUsePhoto}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            pressed && !usingPhoto && styles.buttonPressed,
                            usingPhoto && styles.buttonDisabled,
                        ]}
                    >
                        <Ionicons
                            color={colors.text}
                            name="checkmark"
                            size={18}
                        />
                        <Text style={styles.primaryButtonText}>Use Photo</Text>
                    </Pressable>
                </View>
            ) : (
                <View style={styles.captureBar}>
                    <Pressable
                        accessibilityLabel="Take photo"
                        accessibilityRole="button"
                        disabled={!canCapture}
                        onPress={handleCapture}
                        style={({ pressed }) => [
                            styles.shutterOuter,
                            pressed && canCapture && styles.shutterPressed,
                            !canCapture && styles.buttonDisabled,
                        ]}
                    >
                        <View style={styles.shutterInner} />
                    </Pressable>
                </View>
            )}
        </View>
    );
}

function IconButton({
    accessibilityLabel,
    disabled = false,
    icon,
    label,
    onPress,
}: IconButtonProps) {
    return (
        <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.iconButton,
                pressed && !disabled && styles.buttonPressed,
                disabled && styles.buttonDisabled,
            ]}
        >
            <Ionicons color={colors.text} name={icon} size={22} />
            {label ? <Text style={styles.iconButtonLabel}>{label}</Text> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    buttonDisabled: {
        opacity: 0.45,
    },
    buttonPressed: {
        opacity: 0.72,
    },
    camera: {
        flex: 1,
    },
    captureBar: {
        alignItems: "center",
        bottom: 28,
        left: 0,
        position: "absolute",
        right: 0,
    },
    centered: {
        alignItems: "center",
        backgroundColor: colors.bg,
        flex: 1,
        justifyContent: "center",
    },
    confirmBar: {
        alignItems: "center",
        bottom: 24,
        flexDirection: "row",
        gap: 12,
        justifyContent: "center",
        left: 16,
        position: "absolute",
        right: 16,
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    errorText: {
        backgroundColor: "rgba(9,9,11,0.78)",
        borderColor: colors.dangerBorder,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        bottom: 116,
        color: colors.dangerText,
        fontSize: 13,
        left: 16,
        lineHeight: 18,
        paddingHorizontal: 12,
        paddingVertical: 9,
        position: "absolute",
        right: 16,
        textAlign: "center",
    },
    iconButton: {
        alignItems: "center",
        backgroundColor: "rgba(9,9,11,0.62)",
        borderColor: "rgba(245,245,245,0.16)",
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        height: 44,
        justifyContent: "center",
        width: 44,
    },
    iconButtonLabel: {
        color: colors.text,
        fontSize: 10,
        fontWeight: "700",
        position: "absolute",
        right: 8,
        top: 6,
    },
    loadingOverlay: {
        alignItems: "center",
        backgroundColor: "rgba(9,9,11,0.45)",
        bottom: 0,
        justifyContent: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
    },
    permissionBody: {
        color: colors.textSecondary,
        fontSize: 15,
        lineHeight: 21,
        marginBottom: 22,
        maxWidth: 280,
        textAlign: "center",
    },
    permissionButton: {
        alignItems: "center",
        backgroundColor: colors.accent,
        borderRadius: 8,
        justifyContent: "center",
        minHeight: 44,
        minWidth: 168,
        paddingHorizontal: 18,
    },
    permissionButtonText: {
        color: colors.text,
        fontSize: 15,
        fontWeight: "700",
    },
    permissionIcon: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 28,
        borderWidth: StyleSheet.hairlineWidth,
        height: 56,
        justifyContent: "center",
        marginBottom: 16,
        width: 56,
    },
    permissionScreen: {
        alignItems: "center",
        backgroundColor: colors.bg,
        flex: 1,
        justifyContent: "center",
        padding: 24,
    },
    permissionTitle: {
        color: colors.text,
        fontSize: 22,
        fontWeight: "700",
        marginBottom: 8,
        textAlign: "center",
    },
    previewImage: {
        backgroundColor: colors.bg,
        flex: 1,
        width: "100%",
    },
    primaryButton: {
        alignItems: "center",
        backgroundColor: colors.accent,
        borderRadius: 8,
        flex: 1,
        flexDirection: "row",
        gap: 8,
        height: 48,
        justifyContent: "center",
        maxWidth: 180,
    },
    primaryButtonText: {
        color: colors.text,
        fontSize: 15,
        fontWeight: "700",
    },
    secondaryButton: {
        alignItems: "center",
        backgroundColor: "rgba(9,9,11,0.78)",
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        flex: 1,
        flexDirection: "row",
        gap: 8,
        height: 48,
        justifyContent: "center",
        maxWidth: 180,
    },
    secondaryButtonText: {
        color: colors.textSecondary,
        fontSize: 15,
        fontWeight: "700",
    },
    secondaryText: {
        color: colors.textSecondary,
        fontSize: 15,
        fontWeight: "600",
    },
    secondaryTextButton: {
        marginTop: 18,
        paddingHorizontal: 18,
        paddingVertical: 10,
    },
    shutterInner: {
        backgroundColor: colors.text,
        borderRadius: 27,
        height: 54,
        width: 54,
    },
    shutterOuter: {
        alignItems: "center",
        backgroundColor: "rgba(245,245,245,0.22)",
        borderColor: colors.text,
        borderRadius: 40,
        borderWidth: 3,
        height: 80,
        justifyContent: "center",
        width: 80,
    },
    shutterPressed: {
        transform: [{ scale: 0.96 }],
    },
    stage: {
        backgroundColor: colors.bg,
        flex: 1,
        overflow: "hidden",
    },
    topActions: {
        flexDirection: "row",
        gap: 10,
    },
    topBar: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        left: 16,
        position: "absolute",
        right: 16,
        top: 16,
    },
});
