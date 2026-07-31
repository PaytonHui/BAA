import type { ScheduleEvent } from "./schedule";

/** Escape text for iCalendar fields. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function parseHhmm(time?: string): { h: number; m: number } | null {
  if (!time) return null;
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function nextDayYyyymmdd(d: string): string {
  // d = YYYYMMDD
  const y = parseInt(d.slice(0, 4), 10);
  const mo = parseInt(d.slice(4, 6), 10);
  const day = parseInt(d.slice(6, 8), 10);
  const dt = new Date(y, mo - 1, day + 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/** Build a .ics calendar file from BAA schedule (for export / import). */
export function scheduleToIcs(events: ScheduleEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BAA//Lightstick//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    // Named calendar so iPhone import can target “BAA” (not Family)
    "X-WR-CALNAME:BAA",
    "NAME:BAA",
    "X-APPLE-CALENDAR-COLOR:#8B5CF6",
  ];

  for (const e of events) {
    const date = e.date.replace(/-/g, "");
    if (!/^\d{8}$/.test(date)) continue;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscape(e.id)}@baa.local`);
    lines.push(`SUMMARY:${icsEscape(e.title)}`);

    const descParts: string[] = [];
    if (e.category) descParts.push(`Category: ${e.category}`);
    if (e.note) descParts.push(e.note);
    if (descParts.length) {
      lines.push(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`);
    }

    const hm = parseHhmm(e.time);
    if (hm) {
      const start = `${date}T${String(hm.h).padStart(2, "0")}${String(hm.m).padStart(2, "0")}00`;
      let endH = hm.h + 1;
      let endDate = date;
      if (endH >= 24) {
        endH -= 24;
        endDate = nextDayYyyymmdd(date);
      }
      const end = `${endDate}T${String(endH).padStart(2, "0")}${String(hm.m).padStart(2, "0")}00`;
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${date}`);
      lines.push(`DTEND;VALUE=DATE:${nextDayYyyymmdd(date)}`);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
