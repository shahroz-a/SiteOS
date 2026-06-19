import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";

type Props = {
  visible: boolean;
  title: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

/**
 * Small centered dialog for creating or renaming a collection. Kept generic so
 * the Saved tab can reuse it for both flows.
 */
export function CollectionFormModal({
  visible,
  title,
  submitLabel,
  initialName = "",
  onSubmit,
  onClose,
}: Props) {
  const colors = useColors();
  const [name, setName] = useState(initialName);

  // Reset the field each time the dialog is (re)opened.
  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: colors.radius * 2,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <TextInput
            testID="collection-form-input"
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder="Collection name"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          <View style={styles.actions}>
            <Pressable
              testID="collection-form-cancel"
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.foreground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              testID="collection-form-submit"
              onPress={handleSubmit}
              disabled={!name.trim()}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: !name.trim() ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={[styles.buttonText, { color: colors.primaryForeground }]}
              >
                {submitLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  card: {
    width: "100%",
    borderWidth: 1,
    padding: 20,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
    marginTop: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  button: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
});
