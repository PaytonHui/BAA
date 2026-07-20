import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { Pairing } from "../types";
import { parsePairingUrl } from "../lib/linkStore";
import { PixelStick } from "./PixelStick";

interface LinkScreenProps {
  onPaired: (p: Pairing) => void;
  onSkip?: () => void;
}

/**
 * One-time pair with Mac (QR). After that, phone works offline and only
 * 連接並更新 when both are on the same Wi‑Fi.
 */
export function LinkScreen({ onPaired, onSkip }: LinkScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (raw: string) => {
    const p = parsePairingUrl(raw);
    if (!p) {
      setErr("Couldn’t read QR. On Mac BAA: right-click → Link iPhone.");
      return;
    }
    setErr(null);
    setBusy(true);
    onPaired(p);
  };

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <View style={styles.fakeIsland}>
          <PixelStick variant="island" size={30} />
          <Text style={styles.fakeIslandText}>BAA</Text>
        </View>
        <Text style={styles.logo}>Dynamic Island pet</Text>
        <Text style={styles.sub}>
          Pixel lightstick on the island · tap for calendar{"\n"}
          Important reminders as notifications{"\n"}
          Sync Mac only when same Wi‑Fi — not always linked
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pair MacBook BAA (once)</Text>
        <Text style={styles.cardHint}>
          Mac: right‑click stick → <Text style={styles.em}>Link iPhone</Text>
          {"\n"}
          After pairing, the phone keeps its own calendar and only updates when
          it can see the Mac on Wi‑Fi.
        </Text>

        {!scanning ? (
          <Pressable
            style={styles.primary}
            onPress={async () => {
              if (!permission?.granted) {
                const r = await requestPermission();
                if (!r.granted) {
                  setErr("Camera needed to scan QR.");
                  return;
                }
              }
              setScanning(true);
            }}
          >
            <Text style={styles.primaryText}>Scan QR</Text>
          </Pressable>
        ) : (
          <View style={styles.camWrap}>
            <CameraView
              style={styles.cam}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (busy) return;
                setScanning(false);
                apply(data);
              }}
            />
            <Pressable style={styles.secondary} onPress={() => setScanning(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.or}>or paste link</Text>
        <TextInput
          style={styles.input}
          placeholder="http://192.168.…:17832/?token=…"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          value={paste}
          onChangeText={setPaste}
          onSubmitEditing={() => apply(paste)}
        />
        <Pressable style={styles.secondary} onPress={() => apply(paste)}>
          <Text style={styles.secondaryText}>Save pairing</Text>
        </Pressable>
        {onSkip && (
          <Pressable style={styles.skip} onPress={onSkip}>
            <Text style={styles.skipText}>Continue without Mac</Text>
          </Pressable>
        )}
        {err ? <Text style={styles.err}>{err}</Text> : null}
        {busy ? <ActivityIndicator color="#c9a8ff" style={{ marginTop: 10 }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#05070f",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 28,
  },
  hero: { alignItems: "center", marginBottom: 20 },
  fakeIsland: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#000",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#ffffff18",
    marginBottom: 16,
  },
  fakeIslandText: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 1.5,
    fontSize: 13,
  },
  logo: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  sub: {
    marginTop: 8,
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#0f172aee",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ffffff14",
    padding: 16,
  },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 6 },
  cardHint: { color: "#94a3b8", fontSize: 12, lineHeight: 17, marginBottom: 14 },
  em: { color: "#e9d5ff", fontWeight: "600" },
  primary: {
    backgroundColor: "#a78bfa",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#0f172a", fontWeight: "800", fontSize: 15 },
  secondary: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffffff22",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#e2e8f0", fontWeight: "600" },
  or: { marginTop: 14, marginBottom: 8, textAlign: "center", color: "#64748b", fontSize: 11 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffffff18",
    backgroundColor: "#020617",
    color: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 12,
  },
  camWrap: { height: 240, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
  cam: { flex: 1 },
  skip: { marginTop: 14, alignItems: "center" },
  skipText: { color: "#64748b", fontSize: 12 },
  err: { marginTop: 10, color: "#fca5a5", fontSize: 12 },
});
