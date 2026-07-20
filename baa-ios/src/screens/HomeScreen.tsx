import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { DynamicIsland } from "../components/DynamicIsland";
import { CalendarSheet } from "../components/CalendarSheet";
import { PixelStick } from "../components/PixelStick";
import type { Pairing, ScheduleEvent } from "../types";
import { countNext7Days, loadLocalSchedule } from "../lib/calendarStore";
import { clearPairing } from "../lib/linkStore";
import { useMacLiveSync } from "../hooks/useMacLiveSync";

interface HomeScreenProps {
  pairing: Pairing | null;
  onNeedPair: () => void;
  onUnpair: () => void;
}

/**
 * Main BAA phone experience:
 * - Dynamic Island → 7-day Mac-style calendar
 * - Live WebSocket + HTTP sync from Mac (same Wi‑Fi)
 * - No chat
 */
export function HomeScreen({ pairing, onNeedPair, onUnpair }: HomeScreenProps) {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [islandExpanded, setIslandExpanded] = useState(false);
  const [islandSub, setIslandSub] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void loadLocalSchedule().then(setEvents);
  }, []);

  const onEvents = useCallback((e: ScheduleEvent[]) => {
    setEvents(e);
  }, []);

  const { status, message, eventCount, httpSync } = useMacLiveSync(
    pairing,
    onEvents
  );

  const doSync = useCallback(async () => {
    setSyncing(true);
    await httpSync();
    setSyncing(false);
    void Haptics.selectionAsync();
  }, [httpSync]);

  useEffect(() => {
    const Notifications = require("expo-notifications");
    const sub = Notifications.addNotificationReceivedListener(
      (n: { request: { content: { title?: string; body?: string } } }) => {
        setIslandExpanded(true);
        setIslandSub(
          n.request.content.body || n.request.content.title || "Reminder"
        );
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning
        );
        setTimeout(() => {
          setIslandExpanded(false);
          setIslandSub(undefined);
        }, 8000);
      }
    );
    return () => sub.remove();
  }, []);

  const weekCount = countNext7Days(events);
  const linked = status === "linked";

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.islandWrap}>
        <DynamicIsland
          expanded={islandExpanded}
          subtitle={islandSub}
          badge={weekCount}
          onPress={() => {
            void Haptics.selectionAsync();
            setCalendarOpen(true);
          }}
        />
      </View>

      <View style={styles.body}>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            setCalendarOpen(true);
          }}
        >
          <PixelStick variant="lg" size={160} />
        </Pressable>
        <Text style={styles.headline}>BAA</Text>
        <Text style={styles.blurb}>
          Tap the island lightstick for the{"\n"}
          7-day calendar (same style as Mac).
        </Text>

        <View style={styles.statusCard}>
          <View style={styles.row}>
            <View
              style={[styles.dot, linked ? styles.dotOn : styles.dotOff]}
            />
            <Text style={styles.statusText}>
              {linked
                ? `Linked · ${eventCount || events.length} event${
                    (eventCount || events.length) === 1 ? "" : "s"
                  }`
                : pairing
                  ? status === "connecting"
                    ? "Connecting to Mac…"
                    : "Not reaching Mac"
                  : "Not paired"}
            </Text>
          </View>
          <Text style={styles.syncDetail}>{message}</Text>
          {pairing ? (
            <Text style={styles.hostLine}>
              {pairing.host}:{pairing.port}
            </Text>
          ) : null}
          {linked && events.length === 0 ? (
            <Text style={styles.emptyHint}>
              Mac sent an empty calendar. On Mac BAA: open Link iPhone → tap
              “Push sample week”, or chat a plan like “meeting tomorrow 3pm”,
              then wait a second — it should appear live.
            </Text>
          ) : null}
          {!linked && pairing ? (
            <Text style={styles.emptyHint}>
              Tips: same Wi‑Fi · Mac BAA open · iOS Settings → allow Local
              Network for Expo Go · re-scan QR if Mac was restarted before this
              update.
            </Text>
          ) : null}
        </View>

        <Pressable style={styles.primary} onPress={() => setCalendarOpen(true)}>
          <Text style={styles.primaryText}>Open 7-day calendar</Text>
        </Pressable>

        <Pressable
          style={styles.secondary}
          onPress={() => void doSync()}
          disabled={syncing || !pairing}
        >
          <Text style={styles.secondaryText}>
            {syncing ? "Updating…" : "連接並更新 Mac（pull now）"}
          </Text>
        </Pressable>

        {pairing ? (
          <Pressable
            style={styles.linkish}
            onPress={async () => {
              await clearPairing();
              onUnpair();
            }}
          >
            <Text style={styles.linkishText}>Unpair Mac</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.linkish} onPress={onNeedPair}>
            <Text style={styles.linkishText}>Pair Mac BAA</Text>
          </Pressable>
        )}
      </View>

      <CalendarSheet
        open={calendarOpen}
        events={events}
        onClose={() => setCalendarOpen(false)}
        lastSyncLabel={message}
        onSync={pairing ? () => void doSync() : undefined}
        syncing={syncing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#05070f" },
  islandWrap: { paddingTop: 54, alignItems: "center", zIndex: 10 },
  body: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 36,
  },
  headline: {
    marginTop: 12,
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 4,
  },
  blurb: {
    marginTop: 10,
    textAlign: "center",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 19,
  },
  statusCard: {
    marginTop: 28,
    width: "100%",
    backgroundColor: "#0f172a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ffffff12",
    padding: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: "#4ade80" },
  dotOff: { backgroundColor: "#64748b" },
  statusText: { color: "#e2e8f0", fontSize: 13, fontWeight: "600" },
  syncDetail: {
    marginTop: 6,
    color: "#64748b",
    fontSize: 11,
    lineHeight: 15,
  },
  hostLine: { marginTop: 4, color: "#475569", fontSize: 10 },
  emptyHint: {
    marginTop: 10,
    color: "#94a3b8",
    fontSize: 11,
    lineHeight: 16,
  },
  primary: {
    marginTop: 22,
    width: "100%",
    backgroundColor: "#a78bfa",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#0f172a", fontWeight: "800", fontSize: 15 },
  secondary: {
    marginTop: 10,
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#ffffff22",
    paddingVertical: 13,
    alignItems: "center",
  },
  secondaryText: { color: "#e2e8f0", fontWeight: "600", fontSize: 13 },
  linkish: { marginTop: 20 },
  linkishText: { color: "#64748b", fontSize: 12 },
});
