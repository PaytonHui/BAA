import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * 2D pixel version of the Mac BAA lightstick
 * (nearest-neighbor art from the official stick graphic).
 */
const stickFull = require("../../assets/pixel-stick.png");
const stickLg = require("../../assets/pixel-stick-lg.png");
const stickIsland = require("../../assets/pixel-stick-island.png");

type StickSize = "island" | "md" | "lg";

interface PixelStickProps {
  /** Display box height (width follows portrait stick ratio) */
  size?: number;
  variant?: StickSize;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}

export function PixelStick({
  size = 96,
  variant = "md",
  style,
  imageStyle,
}: PixelStickProps) {
  const source =
    variant === "island"
      ? stickIsland
      : variant === "lg"
        ? stickLg
        : stickFull;

  // Portrait stick ~ 3:4
  const w = size * 0.75;
  const h = size;

  return (
    <View style={[styles.wrap, { width: w, height: h }, style]}>
      <Image
        source={source}
        style={[
          {
            width: w,
            height: h,
            // Keep chunky pixels — no blur when scaling
            // @ts-expect-error RN web; native ignores unknown
            imageRendering: "pixelated",
          },
          imageStyle,
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
