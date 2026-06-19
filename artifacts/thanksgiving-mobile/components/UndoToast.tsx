import { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";

type Props = {
  /** Whether the toast is currently shown. */
  visible: boolean;
  /** The message describing the action that just happened. */
  message: string;
  /** Label for the undo action button. */
  actionLabel?: string;
  /** Called when the reader taps the action button. */
  onAction: () => void;
};

/**
 * A lightweight bottom snackbar with an inline action. Slides up and fades in
 * when `visible` becomes true. The wrapping container uses `pointerEvents:
 * "box-none"` so only the toast bar itself is interactive — taps anywhere else
 * pass straight through to the screen behind it.
 */
export function UndoToast({
  visible,
  message,
  actionLabel = "Undo",
  onAction,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  // The tab bar sits at the bottom; lift the toast above it.
  const bottomOffset = insets.bottom + (isWeb ? 100 : 76);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: bottomOffset }]}
    >
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[
          styles.toast,
          {
            backgroundColor: colors.foreground,
            borderRadius: colors.radius * 1.5,
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text
          style={[styles.message, { color: colors.background }]}
          numberOfLines={1}
        >
          {message}
        </Text>
        <Pressable
          testID="undo-toast-action"
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          onPress={onAction}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.actionLabel, { color: colors.primary }]}>
            {actionLabel}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: 480,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  message: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },
  action: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  actionLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
