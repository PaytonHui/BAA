/**
 * Standalone care bubble window — pet WebGL never resizes,
 * so the lightstick stays put at the screen edge.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CareBubble } from "./components/CareBubble";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import type { CareKind } from "./lib/careMessages";
import type { BubbleSide } from "./lib/windowLayout";
import type { FortuneScores } from "./lib/zodiac";

type CarePayload = {
  text?: string;
  kind?: CareKind;
  emoji?: string;
  title?: string;
  scores?: FortuneScores;
  side?: BubbleSide;
  visible?: boolean;
};

export default function CareWindowApp() {
  const [data, setData] = useState<{
    text: string;
    kind: CareKind;
    emoji: string;
    title?: string;
    scores?: FortuneScores;
    side: BubbleSide;
    visible: boolean;
  } | null>(null);

  useEffect(() => {
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const apply = (p?: CarePayload) => {
      if (!p?.text) return;
      setData({
        text: p.text,
        kind: p.kind ?? "care",
        emoji: p.emoji ?? "✨",
        title: p.title,
        scores: p.scores,
        side: p.side === "left" ? "left" : "right",
        visible: p.visible !== false,
      });
    };
    void listen<CarePayload>("care-window-shown", (ev) => apply(ev.payload)).then(
      (u) => unsubs.push(u)
    );
    void listen<CarePayload>("care-window-data", (ev) => apply(ev.payload)).then(
      (u) => unsubs.push(u)
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const close = useMacWindowClose(async () => {
    await emit("care-dismissed", {}).catch(() => undefined);
  });

  return (
    <MacWindowShell
      shownEvent="care-window-shown"
      className="p-[18px] bg-transparent overflow-hidden"
      forceInteractive
      stealFocus={false}
    >
      {data?.text ? (
        <div className="w-full h-full flex items-center justify-center">
          <CareBubble
            layout="strip"
            side={data.side}
            text={data.text}
            kind={data.kind}
            emoji={data.emoji}
            title={data.title}
            scores={data.scores}
            visible={data.visible}
            onDismiss={() => void close()}
          />
        </div>
      ) : null}
    </MacWindowShell>
  );
}
