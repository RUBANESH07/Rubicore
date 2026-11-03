import "@/lib/tracker"; // registers the background location task as soon as the app starts
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { init as initTracker } from "@/lib/tracker";
import { useTheme } from "@/theme";

function Gate() {
  const { ready, user } = useAuth();
  const t = useTheme();
  const dark = useColorScheme() === "dark";

  useEffect(() => { if (user) void initTracker(); }, [user]);

  if (!ready) return <Loading label="Starting RubiCore…" />;
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerTitleStyle: { fontWeight: "600" }, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-transaction" options={{ title: "Add transaction", presentation: "modal" }} />
        <Stack.Screen name="fuel" options={{ title: "Fuel & mileage" }} />
        <Stack.Screen name="parking" options={{ title: "Parking" }} />
        <Stack.Screen name="calculators" options={{ title: "FD & RD calculators" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="ride/[id]" options={{ title: "Ride" }} />
      </Stack>
    </View>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
