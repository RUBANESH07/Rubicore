import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Button, Card, Field, Screen, Txt } from "@/components/ui";
import { cleanUrl, getBaseUrl, pingServer, setBaseUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isBackgroundCapable } from "@/lib/tracker";
import { useTheme } from "@/theme";

export default function Settings() {
  const t = useTheme();
  const { refresh } = useAuth();
  const [url, setUrl] = useState(getBaseUrl());
  const [msg, setMsg] = useState("");
  async function save() {
    setMsg("Checking…");
    const ok = await pingServer(url);
    if (!ok) return setMsg("No RubiCore server found at that address. Not saved.");
    await setBaseUrl(url);
    setUrl(cleanUrl(url));
    setMsg("Connected and saved.");
    void refresh();
  }

  return (
    <Screen>
      <Card style={{ gap: 10 }}>
        <Txt weight="700">Server</Txt>
        <Field label="Backend address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url"
          hint="The phone and website use the same backend and database. Use your laptop's Wi-Fi address (http://192.168.x.x:8000) or an ngrok https address." />
        <Button title="Test and save" onPress={save} />
        {msg ? <Txt size={13} color={msg.startsWith("Connected") ? t.success : t.danger}>{msg}</Txt> : null}
      </Card>
      <Card style={{ gap: 6 }}>
        <Txt weight="700">Ride tracking on this phone</Txt>
        <Txt size={13} color={isBackgroundCapable() ? t.success : t.warning}>{isBackgroundCapable() ? "Background tracking is available in this build." : "You are running inside Expo Go: tracking works while the app is open and the screen is on."}</Txt>
        <Txt size={12} muted>Reliable background tracking needs a development or store build. Phone settings, battery optimisation and permissions can still pause tracking, and nothing is recorded after you force-quit the app.</Txt>
      </Card>
      <Txt size={11} muted style={{ textAlign: "center" }}>RubiCore mobile {Constants.expoConfig?.version}</Txt>
    </Screen>
  );
}
