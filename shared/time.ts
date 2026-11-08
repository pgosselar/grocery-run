// Recipe times as people write them ("1 hour 15 minutes", "1h15m", "PT75M", "20-25 mins") → minutes,
// and back to one tidy style ("1 hr 15 min"). Stored recipes keep the tidy text; filters can use minutes.

const UNIT = String.raw`(hours?|hrs?|h|minutes?|mins?|m)(?![a-z])`;
const NUM = String.raw`(\d+(?:\.\d+)?(?:\s+\d\/\d)?|\d\/\d|½|¼|¾)`;

function num(s: string): number {
  const t = s.trim().replace("½", "0.5").replace("¼", "0.25").replace("¾", "0.75");
  const mixed = t.match(/^(\d+)\s+(\d)\/(\d)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d)\/(\d)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

const isHours = (u: string) => /^h/i.test(u);

/** Minutes in a time, or null if there's no time in it. A range counts as its longer end. */
export function parseMinutes(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.trim();
  const iso = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
  if (iso) {
    const m = Math.round(Number(iso[1] ?? 0) * 1440 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0));
    return m || null;
  }
  // "20-25 minutes", "1 to 2 hours": take the longer end.
  const range = s.match(new RegExp(String.raw`^${NUM}\s*(?:-|–|—|to)\s*${NUM}\s*${UNIT}`, "i"));
  if (range) return Math.round(num(range[2]) * (isHours(range[3]) ? 60 : 1));
  let total = 0;
  let found = false;
  for (const m of s.matchAll(new RegExp(String.raw`${NUM}\s*${UNIT}`, "gi"))) {
    total += num(m[1]) * (isHours(m[2]) ? 60 : 1);
    found = true;
  }
  return found && total > 0 ? Math.round(total) : null;
}

/** 75 → "1 hr 15 min" */
export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(" ");
}

/**
 * A time in the house style. Ranges keep both ends ("20–25 min"); text we can't read is kept as written
 * (if it's short), so nothing someone typed disappears.
 */
export function normalizeTime(text: string | null | undefined): string | undefined {
  const s = text?.trim();
  if (!s) return undefined;
  const range = s.match(new RegExp(String.raw`^${NUM}\s*(?:-|–|—|to)\s*${NUM}\s*${UNIT}`, "i"));
  if (range) return `${range[1].trim()}–${range[2].trim()} ${isHours(range[3]) ? "hr" : "min"}`;
  const mins = parseMinutes(s);
  if (mins) return formatMinutes(mins);
  if (/^P(?:\d|T)/i.test(s)) return undefined; // an ISO duration of zero ("PT0S")
  return s.length <= 40 ? s : undefined;
}
