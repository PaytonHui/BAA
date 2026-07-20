/**
 * Tiny safe-area helpers without requiring react-native-safe-area-context
 * (keeps the app lightweight). Uses Dimensions + typical iPhone insets.
 */
import { Dimensions, Platform, StatusBar } from "react-native";

export function useSafeAreaInsets() {
  const isIPhone = Platform.OS === "ios";
  // Approximate notch / home indicator — good enough for AssistiveTouch layout
  const top = isIPhone ? 54 : StatusBar.currentHeight ?? 24;
  const bottom = isIPhone ? 34 : 16;
  return { top, bottom, left: 0, right: 0 };
}

export function useSafeAreaFrame() {
  const { width, height } = Dimensions.get("window");
  return { x: 0, y: 0, width, height };
}
