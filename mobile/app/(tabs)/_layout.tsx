import { Tabs } from "expo-router";
import { ColorValue, Text } from "react-native";
import { useTheme } from "@/theme";

const glyph = (g: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{g}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.muted, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
      headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerTitleStyle: { fontWeight: "600" },
    }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: glyph("⌂") }} />
      <Tabs.Screen name="money" options={{ title: "Money", tabBarIcon: glyph("₹") }} />
      <Tabs.Screen name="ride" options={{ title: "Ride", tabBarIcon: glyph("➤") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: glyph("≡") }} />
    </Tabs>
  );
}
