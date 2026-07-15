import type { AppScreenProps } from "../navigation/types";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    Animated,
    Dimensions,
    PanResponder,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import * as ImageManipulator from "expo-image-manipulator";

import { ChatHeader } from "../components/ChatHeader";
import { $avatarCropResult } from "../lib/avatarCropResult";
import { colors } from "../theme";

/**
 * Lets the user pan a non-square image around so they can choose a
 * square crop region. Used by the avatar upload flow when the OS
 * picker returned a non-1:1 image (or to let the user re-frame after
 * the OS-level crop).
 *
 * Implementation notes:
 *
 * - We render the source image scaled so its *short* edge maps to the
 *   on-screen crop frame. That means panning is only meaningful along
 *   the long edge, which keeps the gesture intuitive ("slide to the
 *   part you want to keep").
 * - Pan delta is tracked in raw display dp; the committed offset is
 *   clamped against the overhang on each axis so the user can't pan
 *   the image off the frame.
 * - On confirm we convert pan offsets to source-pixel coordinates and
 *   call `expo-image-manipulator` to materialize the cropped JPEG.
 */
export function AvatarCropScreen({
    navigation,
    route,
}: AppScreenProps<"AvatarCrop">) {
    const { requestId, sourceHeight, sourceUri, sourceWidth, title } =
        route.params;
    const screen = Dimensions.get("window");

    // Square frame size: leave gutter on the sides, never taller than
    // ~52% of the viewport so action buttons remain comfortably tappable
    // on small phones.
    const frameSize = Math.min(
        screen.width - 48,
        Math.max(220, Math.round(screen.height * 0.52)),
    );

    // Scale the image so the short edge fills the crop frame exactly.
    const shortDim = Math.min(sourceWidth, sourceHeight);
    const displayScale = frameSize / shortDim;
    const displayWidth = sourceWidth * displayScale;
    const displayHeight = sourceHeight * displayScale;

    // Total overhang on each axis (positive when image is larger than
    // the frame on that axis; ~0 for the short edge, > 0 for the long
    // edge).
    const maxOffsetX = Math.max(0, (displayWidth - frameSize) / 2);
    const maxOffsetY = Math.max(0, (displayHeight - frameSize) / 2);

    // `pan.x/y` is the absolute offset *from center* of the image inside
    // the crop frame, in display dp. Positive X = image dragged right.
    // We snapshot it at the start of each gesture, then update it
    // continuously via setValue (clamped) during the gesture.
    const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
    const gestureStartRef = useRef({ x: 0, y: 0 });
    const committedRef = useRef({ x: 0, y: 0 });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<null | string>(null);

    const panResponder = useMemo(() => {
        return PanResponder.create({
            onMoveShouldSetPanResponder: (_evt, gesture) => {
                return Math.abs(gesture.dx) > 1 || Math.abs(gesture.dy) > 1;
            },
            onPanResponderGrant: () => {
                gestureStartRef.current = { ...committedRef.current };
            },
            onPanResponderMove: (_evt, gesture) => {
                const nextX = clamp(
                    gestureStartRef.current.x + gesture.dx,
                    -maxOffsetX,
                    maxOffsetX,
                );
                const nextY = clamp(
                    gestureStartRef.current.y + gesture.dy,
                    -maxOffsetY,
                    maxOffsetY,
                );
                pan.setValue({ x: nextX, y: nextY });
                committedRef.current = { x: nextX, y: nextY };
            },
            onPanResponderRelease: () => {
                gestureStartRef.current = { ...committedRef.current };
            },
            onPanResponderTerminate: () => {
                gestureStartRef.current = { ...committedRef.current };
            },
            onPanResponderTerminationRequest: () => false,
            onStartShouldSetPanResponder: () => true,
        });
    }, [maxOffsetX, maxOffsetY, pan]);

    const handleReset = useCallback(() => {
        committedRef.current = { x: 0, y: 0 };
        gestureStartRef.current = { x: 0, y: 0 };
        Animated.spring(pan, {
            damping: 22,
            mass: 0.8,
            stiffness: 220,
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
        }).start();
    }, [pan]);

    const handleConfirm = useCallback(async () => {
        if (busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            // The image is centered when committed offsets are zero. A
            // positive committed.x means the user dragged the image to
            // the right, so the *crop* moves to the LEFT. Convert to
            // image-display coordinates of the frame's top-left, then
            // divide by display scale to get source pixels.
            const cropOriginXDisplay = maxOffsetX - committedRef.current.x;
            const cropOriginYDisplay = maxOffsetY - committedRef.current.y;
            const originX = clamp(
                Math.round(cropOriginXDisplay / displayScale),
                0,
                Math.max(0, sourceWidth - shortDim),
            );
            const originY = clamp(
                Math.round(cropOriginYDisplay / displayScale),
                0,
                Math.max(0, sourceHeight - shortDim),
            );

            // eslint-disable-next-line @typescript-eslint/no-deprecated -- pinned runtime, contextual API not available
            const cropped = await ImageManipulator.manipulateAsync(
                sourceUri,
                [
                    {
                        crop: {
                            height: shortDim,
                            originX,
                            originY,
                            width: shortDim,
                        },
                    },
                ],
                {
                    compress: 1,
                    format: ImageManipulator.SaveFormat.JPEG,
                },
            );
            $avatarCropResult.set({
                height: cropped.height,
                requestId,
                uri: cropped.uri,
                width: cropped.width,
            });
            navigation.goBack();
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not crop this image.",
            );
        } finally {
            setBusy(false);
        }
    }, [
        busy,
        displayScale,
        maxOffsetX,
        maxOffsetY,
        navigation,
        requestId,
        shortDim,
        sourceHeight,
        sourceUri,
        sourceWidth,
    ]);

    const handleCancel = useCallback(() => {
        navigation.goBack();
    }, [navigation]);

    return (
        <View style={styles.container}>
            <ChatHeader onBack={handleCancel} title={title ?? "Crop image"} />
            <View style={styles.body}>
                <Text style={styles.helper}>
                    Drag to choose what stays inside the square frame.
                </Text>

                <View
                    {...panResponder.panHandlers}
                    style={[
                        styles.frame,
                        { height: frameSize, width: frameSize },
                    ]}
                >
                    <Animated.Image
                        source={{ uri: sourceUri }}
                        style={[
                            styles.image,
                            {
                                height: displayHeight,
                                left: -maxOffsetX,
                                top: -maxOffsetY,
                                transform: [
                                    { translateX: pan.x },
                                    { translateY: pan.y },
                                ],
                                width: displayWidth,
                            },
                        ]}
                    />

                    {/* Frame border drawn on top of the image. */}
                    <View pointerEvents="none" style={styles.frameOverlay}>
                        <View style={styles.frameRing} />
                        <View style={styles.gridV} />
                        <View style={styles.gridH} />
                        {/* corner brackets */}
                        <View style={[styles.corner, styles.cornerTL]} />
                        <View style={[styles.corner, styles.cornerTR]} />
                        <View style={[styles.corner, styles.cornerBL]} />
                        <View style={[styles.corner, styles.cornerBR]} />
                    </View>
                </View>

                {error !== null ? (
                    <Text style={styles.errorText}>{error}</Text>
                ) : null}

                <View style={styles.row}>
                    <Pressable
                        disabled={busy}
                        onPress={handleReset}
                        style={({ pressed }) => [
                            styles.secondaryBtn,
                            pressed && styles.btnPressed,
                            busy && styles.btnDisabled,
                        ]}
                    >
                        <Text style={styles.secondaryBtnText}>Reset</Text>
                    </Pressable>
                    <Pressable
                        disabled={busy}
                        onPress={() => {
                            void handleConfirm();
                        }}
                        style={({ pressed }) => [
                            styles.primaryBtn,
                            pressed && styles.btnPressed,
                            busy && styles.btnDisabled,
                        ]}
                    >
                        <Text style={styles.primaryBtnText}>
                            {busy ? "Cropping..." : "Use this crop"}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

const CORNER_LEN = 22;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
    body: {
        alignItems: "center",
        flex: 1,
        gap: 18,
        paddingHorizontal: 20,
        paddingVertical: 24,
    },
    btnDisabled: {
        opacity: 0.55,
    },
    btnPressed: {
        opacity: 0.8,
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    corner: {
        borderColor: colors.error,
        position: "absolute",
    },
    cornerBL: {
        borderBottomWidth: CORNER_WIDTH,
        borderLeftWidth: CORNER_WIDTH,
        bottom: -CORNER_WIDTH,
        height: CORNER_LEN,
        left: -CORNER_WIDTH,
        width: CORNER_LEN,
    },
    cornerBR: {
        borderBottomWidth: CORNER_WIDTH,
        borderRightWidth: CORNER_WIDTH,
        bottom: -CORNER_WIDTH,
        height: CORNER_LEN,
        right: -CORNER_WIDTH,
        width: CORNER_LEN,
    },
    cornerTL: {
        borderLeftWidth: CORNER_WIDTH,
        borderTopWidth: CORNER_WIDTH,
        height: CORNER_LEN,
        left: -CORNER_WIDTH,
        top: -CORNER_WIDTH,
        width: CORNER_LEN,
    },
    cornerTR: {
        borderRightWidth: CORNER_WIDTH,
        borderTopWidth: CORNER_WIDTH,
        height: CORNER_LEN,
        right: -CORNER_WIDTH,
        top: -CORNER_WIDTH,
        width: CORNER_LEN,
    },
    errorText: {
        color: colors.error,
        fontSize: 13,
        textAlign: "center",
    },
    frame: {
        backgroundColor: "#0b0d12",
        overflow: "hidden",
        position: "relative",
    },
    frameOverlay: {
        bottom: 0,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
    },
    frameRing: {
        borderColor: "rgba(255,255,255,0.18)",
        borderWidth: 1,
        bottom: 0,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
    },
    gridH: {
        backgroundColor: "rgba(255,255,255,0.07)",
        height: 1,
        left: 0,
        position: "absolute",
        right: 0,
        top: "50%",
    },
    gridV: {
        backgroundColor: "rgba(255,255,255,0.07)",
        bottom: 0,
        left: "50%",
        position: "absolute",
        top: 0,
        width: 1,
    },
    helper: {
        color: colors.textSecondary,
        fontSize: 13,
        textAlign: "center",
    },
    image: {
        position: "absolute",
        resizeMode: "cover",
    },
    primaryBtn: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderRadius: 12,
        flex: 1.4,
        paddingVertical: 14,
    },
    primaryBtnText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0.4,
    },
    row: {
        alignSelf: "stretch",
        flexDirection: "row",
        gap: 12,
        marginTop: "auto",
    },
    secondaryBtn: {
        alignItems: "center",
        backgroundColor: "#171a22",
        borderColor: "rgba(255,255,255,0.12)",
        borderRadius: 12,
        borderWidth: 1,
        flex: 1,
        paddingVertical: 14,
    },
    secondaryBtnText: {
        color: colors.text,
        fontSize: 14,
        fontWeight: "600",
    },
});
