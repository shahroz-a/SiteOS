import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";

/** Human-friendly absolute date + time, e.g. "Jun 19, 2026 at 3:42 PM". */
export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} at ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** Compact date, e.g. "Jun 19, 2026". */
export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type StatusVariant = "published" | "draft" | "archived" | (string & {});

export function StatusBadge({ status }: { status: StatusVariant }) {
  const colors = useColors();
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  const filled = status === "published";
  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: colors.radius,
          backgroundColor: filled ? colors.primary : colors.secondary,
          borderColor: filled ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: filled ? colors.primaryForeground : colors.secondaryForeground },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/** A small neutral pill, used for the "Current" version marker and role tags. */
export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" }) {
  const colors = useColors();
  const accent = tone === "accent";
  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: colors.radius,
          backgroundColor: accent ? colors.primary : colors.muted,
          borderColor: accent ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: accent ? colors.primaryForeground : colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  paddingTop,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  paddingTop: number;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={[styles.header, { paddingTop, borderBottomColor: colors.border }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={styles.backRow}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={18} color={colors.mutedForeground} />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>
            Back
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.titleCol}>
          <Text
            style={[styles.title, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ?? null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  backText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  titleCol: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: fonts.serifExtraBold,
    fontSize: 30,
    lineHeight: 36,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
