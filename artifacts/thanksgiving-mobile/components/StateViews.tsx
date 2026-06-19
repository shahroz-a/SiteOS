import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";

export function LoadingView({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? (
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorView({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <Feather name="alert-triangle" size={32} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>
        Something went wrong
      </Text>
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        {message ?? "Unable to load content. Please try again."}
      </Text>
      {onRetry ? (
        <Pressable
          testID="retry-button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyView({
  icon = "inbox",
  title,
  message,
}: {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  message?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <Feather name={icon} size={32} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {message ? (
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 60,
    gap: 12,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    textAlign: "center",
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
});
