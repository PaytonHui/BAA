import { useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ScheduleEvent } from "../types";
import {
  buildMonthGrid,
  datesWithEvents,
  eventCategory,
  eventsOnDate,
  formatSelectedLabel,
  monthLabel,
  next7DateKeys,
  toDateKey,
  todayKey,
} from "../lib/calendarStore";

const avatar = require("../../assets/lightstick-icon.png");

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarSheetProps {
  open: boolean;
  events: ScheduleEvent[];
  onClose: () => void;
  lastSyncLabel?: string;
  onSync?: () => void;
  syncing?: boolean;
}

/**
 * Same Phoning style as Mac BAA CalendarPanel:
 * light panel, month grid, green Binky bubbles, work/other badges.
 * Focus: next 7 days (highlighted on grid; island opens here).
 */
export function CalendarSheet({
  open,
  events,
  onClose,
  lastSyncLabel,
  onSync,
  syncing,
}: CalendarSheetProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayKey());

  const marked = useMemo(() => datesWithEvents(events), [events]);
  const weekKeys = useMemo(() => next7DateKeys(), []);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const dayEvents = useMemo(
    () => eventsOnDate(events, selected),
    [events, selected]
  );

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };

  const goToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
    setSelected(todayKey());
  };

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.root}>
        {/* —— Same top bar as Mac calendar —— */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn} hitSlop={8}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>

          <View style={styles.avatarWrap}>
            <Image source={avatar} style={styles.avatar} />
            <View style={styles.onlineDot} />
          </View>

          <View style={styles.headerText}>
            <Text style={styles.headerName} numberOfLines={1}>
              Binky
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              calendar · next 7 days
            </Text>
          </View>

          <Pressable onPress={goToday} style={styles.chipBtn}>
            <Text style={styles.chipBtnText}>Today</Text>
          </Pressable>

          {onSync && (
            <Pressable
              onPress={onSync}
              style={styles.chipBtn}
              disabled={syncing}
            >
              <Text style={styles.chipBtnText}>
                {syncing ? "…" : "Sync"}
              </Text>
            </Pressable>
          )}
        </View>

        {lastSyncLabel ? (
          <Text style={styles.syncMeta}>{lastSyncLabel}</Text>
        ) : null}

        {/* Month nav — Mac style */}
        <View style={styles.monthNav}>
          <Pressable onPress={prevMonth} style={styles.navArrow}>
            <Text style={styles.navArrowText}>‹</Text>
          </Pressable>
          <View style={styles.monthPill}>
            <Text style={styles.monthPillText}>
              {monthLabel(year, month)}
            </Text>
          </View>
          <Pressable onPress={nextMonth} style={styles.navArrow}>
            <Text style={styles.navArrowText}>›</Text>
          </Pressable>
        </View>

        {/* Grid — same as Mac */}
        <View style={styles.gridPad}>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {grid.map((day, i) => {
              if (day == null) {
                return <View key={`e-${i}`} style={styles.dayCell} />;
              }
              const key = toDateKey(year, month, day);
              const isToday = key === todayKey();
              const isSel = key === selected;
              const has = marked.has(key);
              const inWeek = weekKeys.has(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelected(key)}
                  style={[
                    styles.dayCell,
                    styles.dayBtn,
                    isSel && styles.daySelected,
                    !isSel && isToday && styles.dayToday,
                    !isSel && !isToday && inWeek && styles.dayInWeek,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      isSel && styles.dayNumSelected,
                      !isSel && isToday && styles.dayNumToday,
                    ]}
                  >
                    {day}
                  </Text>
                  {has && (
                    <View
                      style={[
                        styles.eventDot,
                        isSel ? styles.eventDotOnSel : styles.eventDotBlue,
                      ]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.weekHint}>
            Soft ring = next 7 days · green = selected (same as Mac)
          </Text>
        </View>

        {/* Day events — green Binky bubbles like Mac */}
        <ScrollView
          style={styles.eventScroll}
          contentContainerStyle={styles.eventList}
        >
          <Text style={styles.selectedLabel}>
            {formatSelectedLabel(selected)}
          </Text>

          {dayEvents.length === 0 ? (
            <View style={styles.bubbleRow}>
              <Image source={avatar} style={styles.bubbleAvatar} />
              <View style={styles.bubbleCol}>
                <Text style={styles.binkyName}>Binky</Text>
                <View style={styles.bubble}>
                  <Text style={styles.bubbleText}>
                    No plans this day. Sync from Mac or tell me on Mac chat and
                    I’ll mark it here!
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            dayEvents.map((ev, idx) => (
              <View key={ev.id} style={styles.bubbleRow}>
                <View style={styles.bubbleAvatarSlot}>
                  {idx === 0 ? (
                    <Image source={avatar} style={styles.bubbleAvatar} />
                  ) : (
                    <View style={styles.bubbleAvatarSpacer} />
                  )}
                </View>
                <View style={styles.bubbleCol}>
                  {idx === 0 && (
                    <Text style={styles.binkyName}>Binky</Text>
                  )}
                  <View style={styles.bubble}>
                    <View style={styles.bubbleMeta}>
                      {ev.time ? (
                        <Text style={styles.evTime}>{ev.time}</Text>
                      ) : null}
                      <View
                        style={[
                          styles.catPill,
                          eventCategory(ev) === "work"
                            ? styles.catWork
                            : styles.catOther,
                        ]}
                      >
                        <Text
                          style={[
                            styles.catPillText,
                            eventCategory(ev) === "work"
                              ? styles.catWorkText
                              : styles.catOtherText,
                          ]}
                        >
                          {eventCategory(ev) === "work"
                            ? "💼 work · 3h"
                            : "📅 other · 1h"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.bubbleText}>{ev.title}</Text>
                    {ev.note ? (
                      <Text style={styles.evNote}>{ev.note}</Text>
                    ) : null}
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Mac BAA Phoning calendar colors */
const BG = "#F7F7F8";
const GREEN = "#B8EF9A";
const AVATAR_BG = "#B8E6FF";
const DOT_BLUE = "#5B8DEF";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  backBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  backText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#737373",
    marginTop: -2,
  },
  avatarWrap: {
    position: "relative",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AVATAR_BG,
  },
  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#4ade80",
    borderWidth: 2,
    borderColor: "#fff",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#171717",
  },
  headerSub: {
    fontSize: 10,
    color: "#a3a3a3",
    marginTop: 1,
  },
  chipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#fff",
  },
  chipBtnText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#404040",
  },
  syncMeta: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    fontSize: 10,
    color: "#a3a3a3",
    backgroundColor: BG,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.04)",
  },
  navArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  navArrowText: {
    fontSize: 16,
    color: "#525252",
    fontWeight: "600",
  },
  monthPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  monthPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#262626",
  },
  gridPad: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: BG,
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
    fontWeight: "600",
    color: "#a3a3a3",
    paddingVertical: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.28%",
    height: 36,
  },
  dayBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.7)",
    margin: 1,
    height: 34,
  },
  daySelected: {
    backgroundColor: GREEN,
    borderColor: "rgba(23,23,23,0.75)",
  },
  dayToday: {
    backgroundColor: "#fff",
    borderColor: "#d4d4d4",
  },
  dayInWeek: {
    borderColor: "rgba(91,141,239,0.35)",
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  dayNum: {
    fontSize: 12,
    fontWeight: "600",
    color: "#404040",
  },
  dayNumSelected: {
    color: "#171717",
  },
  dayNumToday: {
    color: "#171717",
  },
  eventDot: {
    position: "absolute",
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  eventDotBlue: {
    backgroundColor: DOT_BLUE,
  },
  eventDotOnSel: {
    backgroundColor: "#171717",
  },
  weekHint: {
    fontSize: 9,
    color: "#a3a3a3",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 2,
  },
  eventScroll: {
    flex: 1,
    backgroundColor: BG,
  },
  eventList: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 10,
  },
  selectedLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#737373",
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bubbleAvatarSlot: {
    width: 32,
  },
  bubbleAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: AVATAR_BG,
  },
  bubbleAvatarSpacer: {
    width: 32,
    height: 32,
  },
  bubbleCol: {
    flex: 1,
    minWidth: 0,
  },
  binkyName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#404040",
    marginBottom: 3,
    marginLeft: 2,
  },
  bubble: {
    maxWidth: "95%",
    borderRadius: 18,
    borderTopLeftRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(23,23,23,0.75)",
    backgroundColor: GREEN,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  bubbleMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  evTime: {
    fontWeight: "700",
    fontSize: 12,
    color: "#404040",
  },
  catPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  catWork: {
    backgroundColor: "rgba(2,132,199,0.12)",
  },
  catOther: {
    backgroundColor: "rgba(124,58,237,0.1)",
  },
  catPillText: {
    fontSize: 9,
    fontWeight: "600",
  },
  catWorkText: {
    color: "#075985",
  },
  catOtherText: {
    color: "#5b21b6",
  },
  bubbleText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#171717",
  },
  evNote: {
    fontSize: 11,
    color: "#525252",
    marginTop: 3,
    opacity: 0.9,
  },
});
