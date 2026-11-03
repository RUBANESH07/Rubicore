import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { Card, Screen, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const items: { title: string; sub: string; href: string }[] = [
    { title: "Fuel & mileage", sub: "Add fill-ups, see mileage and fuel cost", href: "/fuel" },
    { title: "Parking", sub: "Save where you parked and navigate back", href: "/parking" },
    { title: "FD & RD calculators", sub: "Maturity, interest, tax and goal planner", href: "/calculators" },
    { title: "Settings", sub: "Server address, background tracking", href: "/settings" },
  ];
  return (
    <Screen>
      <Card style={{ padding: 4 }}>
        {items.map((x, i) => (
          <Pressable key={x.href} onPress={() => router.push(x.href as never)} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderColor: t.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flex: 1 }}><Txt weight="600">{x.title}</Txt><Txt size={12} muted>{x.sub}</Txt></View><Txt muted size={18}>›</Txt>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
