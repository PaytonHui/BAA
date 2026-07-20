import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinkScreen } from "./src/components/LinkScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { loadPairing, savePairing } from "./src/lib/linkStore";
import type { Pairing } from "./src/types";
import { ensureNotificationPermission } from "./src/lib/reminders";

/**
 * BAA iPhone
 * - Dynamic Island–style pixel lightstick → calendar
 * - Notifications for important reminders
 * - Pair once; 連接並更新 Mac only on same Wi‑Fi (offline-first)
 * - No chat
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [showPair, setShowPair] = useState(false);

  useEffect(() => {
    void (async () => {
      await ensureNotificationPermission();
      const p = await loadPairing();
      setPairing(p);
      setShowPair(!p);
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <StatusBar style="light" />
        <ActivityIndicator color="#c9a8ff" size="large" />
      </View>
    );
  }

  if (showPair) {
    return (
      <LinkScreen
        onPaired={async (p) => {
          await savePairing(p);
          setPairing(p);
          setShowPair(false);
        }}
        onSkip={() => setShowPair(false)}
      />
    );
  }

  return (
    <HomeScreen
      pairing={pairing}
      onNeedPair={() => setShowPair(true)}
      onUnpair={() => {
        setPairing(null);
        setShowPair(true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: "#05070f",
    alignItems: "center",
    justifyContent: "center",
  },
});
