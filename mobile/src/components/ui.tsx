import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useTheme } from "@/theme";

/** GET with loading / error state that refetches whenever the screen comes into focus. Pass null to skip. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (path === null) return;
    const id = ++seq.current;
    setError("");
    try {
      const d = await api.get<T>(path);
      if (id === seq.current) setData(d);
    } catch (e: any) {
      if (id === seq.current) setError(e.message || "Something went wrong");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { data, error, loading, reload: load, setData };
}

export function Screen({ children, onRefresh, scroll = true, padded = true }: { children: React.ReactNode; onRefresh?: () => Promise<unknown> | void; scroll?: boolean; padded?: boolean }) {
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const body = scroll ? (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: padded ? 16 : 0, paddingBottom: 40, gap: 12 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} tintColor={t.primary} onRefresh={async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }} /> : undefined}>
      {children}
    </ScrollView>
  ) : <View style={{ flex: 1, padding: padded ? 16 : 0, gap: 12 }}>{children}</View>;
  return (
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>{body}</KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14 }, style]}>{children}</View>;
}

export function Txt({ children, size = 15, weight = "400", muted, color, style, numberOfLines }: { children: React.ReactNode; size?: number; weight?: "400" | "500" | "600" | "700"; muted?: boolean; color?: string; style?: any; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: size, fontWeight: weight, color: color ?? (muted ? t.muted : t.text) }, style]}>{children}</Text>;
}

export function Heading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return <View style={{ marginBottom: 2 }}><Txt size={22} weight="700">{children}</Txt>{sub ? <Txt size={13} muted>{sub}</Txt> : null}</View>;
}

export function Button({ title, onPress, variant = "primary", disabled, busy, style }: { title: string; onPress: () => void; variant?: "primary" | "outline" | "danger" | "success"; disabled?: boolean; busy?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const bg = variant === "primary" ? t.primary : variant === "danger" ? t.danger : variant === "success" ? t.success : "transparent";
  const fg = variant === "outline" ? t.text : "#fff";
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
      style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1, borderWidth: variant === "outline" ? 1 : 0, borderColor: t.border }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: "600", fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
      <TextInput placeholderTextColor={t.muted} {...p} style={[{ borderWidth: 1, borderColor: t.border, backgroundColor: t.field, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 9, fontSize: 16 }, p.style]} />
      {hint ? <Text style={{ color: t.muted, fontSize: 11 }}>{hint}</Text> : null}
    </View>
  );
}

export function Chips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : t.card }}>
            <Text style={{ color: on ? "#fff" : t.text, fontWeight: "500" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "danger" }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <Txt size={12} muted weight="500">{label}</Txt>
      <Txt size={22} weight="700" color={tone === "success" ? t.success : tone === "danger" ? t.danger : undefined}>{value}</Txt>
      {sub ? <Txt size={11} muted>{sub}</Txt> : null}
    </Card>
  );
}

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[{ flexDirection: "row", gap: 12, flexWrap: "wrap" }, style]}>{children}</View>;

export function Loading({ label = "Loading…" }: { label?: string }) {
  const t = useTheme();
  return <View style={{ padding: 24, alignItems: "center", gap: 8 }}><ActivityIndicator color={t.primary} /><Txt size={13} muted>{label}</Txt></View>;
}

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return <Card><Txt color="#c0392b" size={14}>{message}</Txt>{retry ? <View style={{ marginTop: 10 }}><Button title="Try again" variant="outline" onPress={retry} /></View> : null}</Card>;
}

export const Empty = ({ text }: { text: string }) => <View style={{ padding: 24, alignItems: "center" }}><Txt muted size={14} style={{ textAlign: "center" }}>{text}</Txt></View>;

/** Loading / error / data switch for a useLoad result. */
export function Async<T>({ state, children }: { state: { data: T | null; error: string; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorBox message={state.error} retry={state.reload} />;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}

export const styles = StyleSheet.create({ flex1: { flex: 1 } });
