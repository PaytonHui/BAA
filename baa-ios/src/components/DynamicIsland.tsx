import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PixelStick } from "./PixelStick";

interface DynamicIslandProps {
  /** Compact island vs expanded (reminder flash) */
  expanded?: boolean;
  subtitle?: string;
  badge?: number;
  onPress: () => void;
}

/**
 * Dynamic Island–style capsule with pixel lightstick.
 * Tap pixel lightstick → 7-day future calendar.
 */
export function DynamicIsland({
  expanded = false,
  subtitle,
  badge = 0,
  onPress,
}: DynamicIslandProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!expanded) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [expanded, pulse]);

  const glow = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  return (
    <Pressable onPress={onPress} style={styles.hit}>
      <Animated.View
        style={[
          styles.island,
          expanded && styles.islandExpanded,
          expanded && { opacity: glow },
        ]}
      >
        <PixelStick
          variant="island"
          size={expanded ? 36 : 28}
        />
        <View style={styles.textCol}>
          <Text style={styles.title}>BAA</Text>
          {expanded && subtitle ? (
            <Text style={styles.sub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : (
            <Text style={styles.sub}>tap · 7-day</Text>
          )}
        </View>
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: "center",
    paddingTop: 8,
  },
  island: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#000",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 126,
    borderWidth: 1,
    borderColor: "#ffffff12",
    shadowColor: "#c9a8ff",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  islandExpanded: {
    minWidth: 220,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderColor: "#a78bfa66",
    shadowOpacity: 0.7,
    shadowRadius: 18,
  },
  textCol: {
    flexShrink: 1,
  },
  title: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  sub: {
    color: "#94a3b8",
    fontSize: 10,
    marginTop: 1,
  },
  badge: {
    marginLeft: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#a78bfa",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#0f172a",
    fontSize: 10,
    fontWeight: "800",
  },
});
