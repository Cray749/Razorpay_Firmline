// lib/time/ist.ts
//
// The ONLY place in this codebase allowed to do timezone-sensitive date math.
// Every rule, scheduler, and timestamp comparison must import from here — never
// use raw `Date` getters (`.getHours()`, `.getDay()`, etc.) on an un-zoned Date
// anywhere else, because the deploy server's local timezone (Vercel defaults to
// UTC) is not IST, and code that assumes otherwise is wrong in a way that's
// invisible in local dev (if the dev machine happens to be IST) and only shows
// up in production.
//
// Verified empirically (not just by reading docs) under both an IST-local and a
// TZ=UTC-forced Node process: `toZonedTime(instant, IST).getHours()` and
// `fromZonedTime(naiveIsoString, IST)` both give correct, system-timezone-independent
// results as long as you (a) always read via `toZonedTime(...)` before calling
// local getters, and (b) always construct instants via `fromZonedTime` with a
// timezone-naive ISO string (no trailing "Z" / offset), never via `new Date(y,m,d,h)`.

import { toZonedTime, fromZonedTime } from "date-fns-tz";

export const IST_TIME_ZONE = "Asia/Kolkata";

/** Current instant, exposed as a Date whose local getters read as IST wall-clock time. */
export function nowIST(): Date {
  return toZonedTime(new Date(), IST_TIME_ZONE);
}

/** Internal: read `t` (any instant) as IST wall-clock time. Local getters on the
 * result (getHours/getMinutes/getSeconds/getFullYear/getMonth/getDate/getDay) are safe. */
function asIST(t: Date): Date {
  return toZonedTime(t, IST_TIME_ZONE);
}

function minuteOfDay(z: Date): number {
  return z.getHours() * 60 + z.getMinutes() + z.getSeconds() / 60;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Build a real instant (UTC-correct Date) from IST calendar-date + minute-of-day. */
function istDateFromMinuteOfDay(year: number, month0: number, day: number, minute: number): Date {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  const s = Math.round((minute - Math.floor(minute)) * 60);
  const iso = `${year}-${pad(month0 + 1)}-${pad(day)}T${pad(h)}:${pad(m)}:${pad(s)}`;
  return fromZonedTime(iso, IST_TIME_ZONE);
}

/**
 * Advance an IST calendar date (year/month0/day, no time component) by `dayOffset`
 * days, correctly rolling over month/year boundaries (e.g. Dec 31 + 1 -> Jan 1).
 * Uses Date.UTC purely as a calendar calculator — the result is never treated as
 * a real instant, only its Y/M/D components are read back.
 */
function rollIstCalendarDate(
  year: number,
  month0: number,
  day: number,
  dayOffset: number
): { year: number; month0: number; day: number } {
  const rolled = new Date(Date.UTC(year, month0, day + dayOffset));
  return { year: rolled.getUTCFullYear(), month0: rolled.getUTCMonth(), day: rolled.getUTCDate() };
}

/**
 * Contact window: 08:00–19:00 IST, per RBI 2026 recovery directions.
 * Boundary decision: inclusive at open (08:00:00 counts as within-window),
 * exclusive at close (19:00:00 counts as outside — the window is a hard
 * cutoff at 7 PM sharp, not "up to and including" 7 PM). i.e. [08:00, 19:00).
 */
export function isWithinContactWindow(t: Date): boolean {
  const minutes = minuteOfDay(asIST(t));
  return minutes >= 8 * 60 && minutes < 19 * 60;
}

/**
 * NPCI non-peak retry window: before 10:00, 13:00–17:00, or after 21:30 IST.
 * Boundary decision: all three bands are treated left-inclusive / right-exclusive,
 * i.e. [00:00, 10:00) ∪ [13:00, 17:00) ∪ [21:30, 24:00) — so 21:30:00 exactly
 * counts as non-peak (consistent with the other two bands starting exactly on
 * their boundary), and 10:00:00 / 17:00:00 exactly count as peak (window closed).
 */
export function isWithinNpciNonPeakWindow(t: Date): boolean {
  const minutes = minuteOfDay(asIST(t));
  const beforeTen = minutes < 10 * 60;
  const midday = minutes >= 13 * 60 && minutes < 17 * 60;
  const lateNight = minutes >= 21 * 60 + 30;
  return beforeTen || midday || lateNight;
}

/** The two NPCI non-peak sub-ranges that also fall inside the 08:00-19:00 contact
 * window (the late-night 21:30-24:00 band never overlaps the contact window, so
 * it is never a candidate for an AutoPay retry, which also requires human-contact-hours
 * compliance since it's paired with a pre-debit notice). Minutes from IST midnight. */
const AUTOPAY_VALID_RANGES: Array<[number, number]> = [
  [8 * 60, 10 * 60], // 08:00–10:00
  [13 * 60, 17 * 60], // 13:00–17:00
];

const CONTACT_ONLY_VALID_RANGES: Array<[number, number]> = [[8 * 60, 19 * 60]];

/**
 * Given a floor timestamp, returns the next timestamp (>= floor) that satisfies
 * isWithinContactWindow and, if `isAutoPayRetry`, also isWithinNpciNonPeakWindow
 * simultaneously. If `floor` is already valid, returns `floor` unchanged.
 *
 * This exists because naive `floor + 24h` rescheduling preserves time-of-day: a
 * failure at 11 PM naively reschedules to 11 PM the next day, still outside the
 * contact window. This function always lands inside a valid slot instead.
 */
export function nextValidComplianceSlot(after: Date, isAutoPayRetry = false): Date {
  const ranges = isAutoPayRetry ? AUTOPAY_VALID_RANGES : CONTACT_ONLY_VALID_RANGES;
  const z = asIST(after);
  const year = z.getFullYear();
  const month0 = z.getMonth();
  const startDay = z.getDate();
  const floorMinute = minuteOfDay(z);

  const MAX_DAYS = 14; // safety cap; valid windows recur daily so this should never be hit
  for (let dayOffset = 0; dayOffset < MAX_DAYS; dayOffset++) {
    const { year: y, month0: m0, day: d } = rollIstCalendarDate(year, month0, startDay, dayOffset);
    const lowerBound = dayOffset === 0 ? floorMinute : 0;

    for (const [start, end] of ranges) {
      if (lowerBound < end) {
        const candidateMinute = Math.max(lowerBound, start);
        if (candidateMinute < end) {
          return istDateFromMinuteOfDay(y, m0, d, candidateMinute);
        }
      }
    }
  }

  throw new Error(
    `nextValidComplianceSlot: no valid slot found within ${MAX_DAYS} days of ${after.toISOString()} (isAutoPayRetry=${isAutoPayRetry})`
  );
}

/** Format an instant as an IST-local string for display in the UI/audit trail. */
export function formatIST(t: Date, pattern: "date" | "datetime" = "datetime"): string {
  const z = asIST(t);
  const datePart = `${pad(z.getDate())}-${pad(z.getMonth() + 1)}-${z.getFullYear()}`;
  if (pattern === "date") return datePart;
  return `${datePart} ${pad(z.getHours())}:${pad(z.getMinutes())} IST`;
}

/** IST calendar-day key (YYYY-MM-DD in IST), for "has this happened today" checks. */
export function istCalendarDayKey(t: Date): string {
  const z = asIST(t);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}
