import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { colors } from "../theme";

import { CornerBracketBox } from "./CornerBracketBox";

interface BackButtonProps {
    onPress?: () => void;
}

export function BackButton({ onPress }: BackButtonProps) {
    const navigation = useNavigation();

    return (
        <CornerBracketBox color={colors.border} size={6}>
            <TouchableOpacity
                accessibilityLabel="Go back"
                accessibilityRole="button"
                activeOpacity={0.7}
                onPress={
                    onPress ??
                    (() => {
                        navigation.goBack();
                    })
                }
                style={styles.button}
            >
                <Ionicons color={colors.text} name="arrow-back" size={21} />
            </TouchableOpacity>
        </CornerBracketBox>
    );
}

const styles = StyleSheet.create({
    button: {
        alignItems: "center",
        borderColor: colors.border,
        borderWidth: 1,
        height: 50,
        justifyContent: "center",
        width: 50,
    },
});
