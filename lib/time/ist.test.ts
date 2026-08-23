import { runSuite, check, checkEqual } from "@/lib/test-utils/harness";
import { isWithinContactWindow, isWithinNpciNonPeakWindow, nextValidComplianceSlot, formatIST } from "./ist";
import { fromZonedTime } from "date-fns-tz";
import { IST_TIME_ZONE } from "./ist";

// Helper: build a UTC instant from an IST-naive wall-clock string, independent of system TZ.
const ist = (naiveIso: string) => fromZonedTime(naiveIso, IST_TIME_ZONE);

export default function run(): void {
  runSuite("isWithinContactWindow: 11:45 PM is outside the window", () => {
    checkEqual(isWithinContactWindow(ist("2026-01-15T23:45:00")), false, "23:45 IST should be outside 08:00-19:00");
  });

  runSuite("isWithinContactWindow: boundary at exactly 08:00:00 is inclusive (true)", () => {
    checkEqual(isWithinContactWindow(ist("2026-01-15T08:00:00")), true, "08:00:00 IST should be within the window");
  });

  runSuite("isWithinContactWindow: boundary at exactly 19:00:00 is exclusive (false)", () => {
    checkEqual(isWithinContactWindow(ist("2026-01-15T19:00:00")), false, "19:00:00 IST should be outside the window (closed)");
  });

  runSuite("isWithinContactWindow: 18:59:59 is inside, 07:59:59 is outside", () => {
    checkEqual(isWithinContactWindow(ist("2026-01-15T18:59:59")), true, "18:59:59 should be inside");
    checkEqual(isWithinContactWindow(ist("2026-01-15T07:59:59")), false, "07:59:59 should be outside");
  });

  runSuite("isWithinNpciNonPeakWindow: covers before-10, 13-17, after-21:30, and rejects the rest", () => {
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T09:59:00")), true, "09:59 should be non-peak (before 10)");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T10:00:00")), false, "10:00:00 should be peak (band closed)");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T13:00:00")), true, "13:00:00 should be non-peak (band open)");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T16:59:00")), true, "16:59 should be non-peak");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T17:00:00")), false, "17:00:00 should be peak (band closed)");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T21:30:00")), true, "21:30:00 should be non-peak (band open)");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T21:29:59")), false, "21:29:59 should be peak");
    checkEqual(isWithinNpciNonPeakWindow(ist("2026-01-15T12:00:00")), false, "noon should be peak");
  });

  runSuite("nextValidComplianceSlot: an already-valid floor is returned unchanged", () => {
    const floor = ist("2026-01-15T10:00:00");
    const result = nextValidComplianceSlot(floor, false);
    checkEqual(result.getTime(), floor.getTime(), "already-valid floor should be idempotent");
  });

  runSuite("nextValidComplianceSlot: floor of 11:45 PM does NOT naively return floor+0, lands in next valid window", () => {
    const floor = ist("2026-01-15T23:45:00");
    const result = nextValidComplianceSlot(floor, false);
    check(result.getTime() !== floor.getTime(), "result must differ from an invalid floor");
    check(result.getTime() > floor.getTime(), "result must be after the floor");
    check(isWithinContactWindow(result), "result must actually be within the contact window");
    checkEqual(formatIST(result), "16-01-2026 08:00 IST", "should land at next day 08:00 IST, the window open");
  });

  runSuite("nextValidComplianceSlot (AutoPay): floor of 11 PM lands inside BOTH windows simultaneously (Rule 6 + 8 interaction)", () => {
    // This is the specific scenario the manual calls out: a naive `floor + 24h` reschedule
    // preserves time-of-day and would still be outside the contact window. Routing through
    // nextValidComplianceSlot must not repeat that bug.
    const floor = ist("2026-01-15T23:00:00");
    const result = nextValidComplianceSlot(floor, true);
    check(isWithinContactWindow(result), "AutoPay reschedule must satisfy the contact window");
    check(isWithinNpciNonPeakWindow(result), "AutoPay reschedule must satisfy the NPCI non-peak window");
    checkEqual(formatIST(result), "16-01-2026 08:00 IST", "should land at next day 08:00 IST (first slot satisfying both)");
  });

  runSuite("nextValidComplianceSlot (AutoPay): floor inside contact window but inside NPCI peak (11 AM) moves to 13:00", () => {
    const floor = ist("2026-01-15T11:00:00");
    const result = nextValidComplianceSlot(floor, true);
    check(isWithinContactWindow(result), "must satisfy contact window");
    check(isWithinNpciNonPeakWindow(result), "must satisfy NPCI non-peak window");
    checkEqual(formatIST(result), "15-01-2026 13:00 IST", "should move forward to same-day 13:00, not skip a day");
  });

  runSuite("nextValidComplianceSlot: month/year rollover is handled (Dec 31 -> Jan 1)", () => {
    const floor = ist("2026-12-31T23:45:00");
    const result = nextValidComplianceSlot(floor, false);
    check(isWithinContactWindow(result), "result must be within contact window");
    checkEqual(formatIST(result), "01-01-2027 08:00 IST", "should roll over year correctly");
  });

  console.log("ist.test.ts: all assertions passed");
}
