/**
 * Simulated iPhone screen — BAA linked to Mac
 * (Dynamic Island pixel stick · calendar · Wi‑Fi sync status · no chat)
 */
export function IPhonePreview({
  linked = false,
  deviceName = "iPhone",
  lastSyncLabel,
  events = [],
}: {
  linked?: boolean;
  deviceName?: string;
  lastSyncLabel?: string;
  events?: { title: string; time?: string; work?: boolean }[];
}) {
  const sample =
    events.length > 0
      ? events.slice(0, 3)
      : [
          { title: "Team standup", time: "10:00", work: true },
          { title: "Dentist", time: "15:30", work: false },
        ];

  return (
    <div className="flex flex-col items-center select-none">
      {/* iPhone 15-style chassis */}
      <div
        className="relative w-[168px] h-[340px] rounded-[2rem] p-[6px] shadow-2xl"
        style={{
          background:
            "linear-gradient(160deg, #3f3f46 0%, #18181b 40%, #09090b 100%)",
          boxShadow:
            "0 20px 40px #00000066, inset 0 0 0 1px #ffffff18, inset 0 1px 0 #ffffff22",
        }}
      >
        {/* Side buttons (visual) */}
        <div className="absolute -left-[2px] top-[72px] w-[2px] h-5 rounded-l bg-zinc-600" />
        <div className="absolute -left-[2px] top-[100px] w-[2px] h-8 rounded-l bg-zinc-600" />
        <div className="absolute -right-[2px] top-[90px] w-[2px] h-10 rounded-r bg-zinc-600" />

        {/* Screen */}
        <div className="relative w-full h-full rounded-[1.65rem] overflow-hidden bg-[#05070f]">
          {/* Status bar */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-2">
            <span className="text-[8px] font-semibold text-white/90">9:41</span>
            <div className="flex items-center gap-0.5">
              <span className="text-[7px] text-white/80">▮▮▮</span>
              <span className="text-[7px] text-white/80">Wi‑Fi</span>
              <span className="ml-0.5 inline-block w-4 h-2 rounded-[2px] border border-white/70 relative">
                <span className="absolute inset-0.5 right-1 bg-white/90 rounded-[1px]" />
              </span>
            </div>
          </div>

          {/* Dynamic Island */}
          <div className="absolute top-[18px] left-1/2 -translate-x-1/2 z-30">
            <div
              className={`flex items-center gap-1.5 rounded-full bg-black border px-2 py-1 transition-all duration-300 ${
                linked
                  ? "border-violet-400/50 shadow-[0_0_12px_#a78bfa66] min-w-[92px]"
                  : "border-white/10 min-w-[72px]"
              }`}
            >
              <img
                src="/avatars/pixel-stick-island.png"
                alt=""
                className="w-4 h-5 object-contain"
                style={{ imageRendering: "pixelated" }}
                draggable={false}
              />
              <div className="min-w-0">
                <p className="text-[8px] font-extrabold text-white tracking-wider leading-none">
                  BAA
                </p>
                <p className="text-[6px] text-slate-400 leading-none mt-0.5 truncate max-w-[52px]">
                  {linked ? "linked · tap" : "offline"}
                </p>
              </div>
              {linked && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
            </div>
          </div>

          {/* App body */}
          <div className="absolute inset-0 pt-12 pb-6 px-2.5 flex flex-col">
            <div className="flex-1 flex flex-col items-center pt-3">
              <img
                src="/avatars/pixel-stick-lg.png"
                alt="BAA lightstick"
                className="w-12 h-16 mt-1 object-contain"
                style={{ imageRendering: "pixelated" }}
                draggable={false}
              />
              <p className="text-[11px] font-black tracking-[0.25em] text-white mt-1.5">
                BAA
              </p>
              <p className="text-[7px] text-slate-500 text-center leading-snug mt-1 px-1">
                {linked
                  ? "Mac on Wi‑Fi · calendar synced"
                  : "Waiting to pair with Mac…"}
              </p>

              {/* Sync pill */}
              <div
                className={`mt-2 flex items-center gap-1 rounded-full px-2 py-0.5 border text-[7px] ${
                  linked
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-slate-500"
                }`}
              >
                <span
                  className={`w-1 h-1 rounded-full ${
                    linked ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                {linked ? lastSyncLabel || "Synced just now" : "Not linked"}
              </div>

              {/* Mini calendar cards */}
              <div className="w-full mt-2.5 space-y-1">
                <p className="text-[7px] font-bold text-slate-500 tracking-wide px-0.5">
                  TODAY
                </p>
                {linked ? (
                  sample.map((e, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-1.5 py-1 ${
                        e.work
                          ? "border-violet-400/30 bg-violet-500/10"
                          : "border-white/10 bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[6px] font-bold text-violet-300">
                          {e.work ? "WORK" : "OTHER"}
                        </span>
                        {e.time && (
                          <span className="text-[6px] text-slate-500">
                            {e.time}
                          </span>
                        )}
                      </div>
                      <p className="text-[8px] font-semibold text-slate-100 truncate">
                        {e.title}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 py-3 text-center">
                    <p className="text-[7px] text-slate-600">
                      Events appear after sync
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom actions (visual only) */}
            <div className="space-y-1">
              <div className="rounded-lg bg-violet-400/90 py-1.5 text-center">
                <span className="text-[8px] font-extrabold text-slate-900">
                  Open calendar
                </span>
              </div>
              <div className="rounded-lg border border-white/15 py-1.5 text-center">
                <span className="text-[7px] font-semibold text-slate-300">
                  連接並更新 Mac
                </span>
              </div>
            </div>
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-16 h-0.5 rounded-full bg-white/40" />
        </div>
      </div>

      <p className="mt-1.5 text-[8px] text-slate-500 text-center max-w-[168px] leading-snug">
        {linked
          ? `模擬畫面 · ${deviceName} linked`
          : "模擬 iPhone 畫面 · pair 後會變成這樣"}
      </p>
    </div>
  );
}
