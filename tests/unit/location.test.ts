import { describe, it, expect } from "vitest";
import {
  checkOfficeLocation,
  distanceMeters,
  formatDistance,
  locationReadingSchema,
  MAX_LOCATION_ACCURACY_METERS,
} from "@/lib/attendance/location";
import { endOfOfficeDay, qrBackupState } from "@/lib/attendance/qrBackup";

// Roughly Victoria Island, Lagos. 0.001° of latitude is ~111 m.
const OFFICE = { latitude: 6.4281, longitude: 3.4219, locationRadiusMeters: 150 };

describe("distanceMeters", () => {
  it("is zero for the same point and ~111 m per 0.001° of latitude", () => {
    expect(distanceMeters(OFFICE, OFFICE)).toBe(0);
    expect(distanceMeters(OFFICE, { latitude: 6.4291, longitude: 3.4219 })).toBeCloseTo(111, 0);
  });

  it("measures Lagos to Abuja at roughly 525 km", () => {
    const km = distanceMeters(OFFICE, { latitude: 9.0765, longitude: 7.3986 }) / 1000;
    expect(km).toBeGreaterThan(500);
    expect(km).toBeLessThan(550);
  });
});

describe("checkOfficeLocation", () => {
  it("accepts a reading inside the radius and reports distance and accuracy", () => {
    const result = checkOfficeLocation(OFFICE, { latitude: 6.4291, longitude: 3.4219, accuracy: 35.4 });
    expect(result).toEqual({ ok: true, distanceMeters: 111, accuracyMeters: 35 });
  });

  it("refuses a reading outside the radius, saying how far away it was", () => {
    const result = checkOfficeLocation(OFFICE, { latitude: 6.4381, longitude: 3.4219, accuracy: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("LOCATION_OUT_OF_RANGE");
      if (result.reason === "LOCATION_OUT_OF_RANGE") expect(result.distanceMeters).toBeCloseTo(1112, -1);
    }
  });

  it("asks for a retry on a reading too vague to judge, even if it lands on the office", () => {
    const result = checkOfficeLocation(OFFICE, { ...OFFICE, accuracy: MAX_LOCATION_ACCURACY_METERS + 1 });
    expect(result).toEqual({ ok: false, reason: "LOCATION_INACCURATE" });
  });

  it("refuses without a reading, or when the office has no location saved", () => {
    expect(checkOfficeLocation(OFFICE, null)).toEqual({ ok: false, reason: "LOCATION_REQUIRED" });
    expect(
      checkOfficeLocation({ latitude: null, longitude: null, locationRadiusMeters: 150 }, { ...OFFICE, accuracy: 5 })
    ).toEqual({ ok: false, reason: "LOCATION_NOT_CONFIGURED" });
  });
});

describe("locationReadingSchema", () => {
  it("rejects malformed or out-of-range readings", () => {
    expect(locationReadingSchema.safeParse({ latitude: 6.4, longitude: 3.4, accuracy: 20 }).success).toBe(true);
    expect(locationReadingSchema.safeParse({ latitude: 91, longitude: 3.4, accuracy: 20 }).success).toBe(false);
    expect(locationReadingSchema.safeParse({ latitude: "6.4", longitude: 3.4, accuracy: 20 }).success).toBe(false);
    expect(locationReadingSchema.safeParse({ latitude: Number.NaN, longitude: 3.4, accuracy: 20 }).success).toBe(false);
    expect(locationReadingSchema.safeParse({ latitude: 6.4, longitude: 3.4 }).success).toBe(false);
  });
});

describe("formatDistance", () => {
  it("rounds to tens of metres, then kilometres", () => {
    expect(formatDistance(846)).toBe("about 850 m");
    expect(formatDistance(2380)).toBe("about 2.4 km");
    expect(formatDistance(525_000)).toBe("about 525 km");
  });
});

describe("qrBackupState", () => {
  const now = new Date("2026-10-27T09:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const agent = (lastVerifiedAt: Date | null) => ({ status: "VERIFIED" as const, agentSigningSecret: "s", lastVerifiedAt });

  it("opens automatically once the Network Agent stops checking in", () => {
    expect(qrBackupState({ qrBackupUntil: null }, [agent(minutesAgo(5))], 30, now)).toEqual({
      active: false,
      reason: "NETWORK_ONLINE",
    });
    expect(qrBackupState({ qrBackupUntil: null }, [agent(minutesAgo(45))], 30, now)).toEqual({
      active: true,
      reason: "NETWORK_OFFLINE",
      lastSeenAt: minutesAgo(45),
    });
  });

  it("never opens automatically for an office without an agent — it has no heartbeat to lose", () => {
    const manualOnly = { status: "VERIFIED" as const, agentSigningSecret: null, lastVerifiedAt: minutesAgo(600) };
    expect(qrBackupState({ qrBackupUntil: null }, [manualOnly], 30, now)).toEqual({ active: false, reason: "NO_AGENT" });
    expect(qrBackupState({ qrBackupUntil: null }, [], 30, now).active).toBe(false);
  });

  it("follows the manual switch until it lapses", () => {
    const later = new Date(now.getTime() + 3_600_000);
    expect(qrBackupState({ qrBackupUntil: later }, [agent(minutesAgo(1))], 30, now)).toEqual({
      active: true,
      reason: "MANUAL",
      until: later,
    });
    expect(qrBackupState({ qrBackupUntil: minutesAgo(1) }, [agent(minutesAgo(1))], 30, now).active).toBe(false);
  });

  it("switches off at the end of the office's day", () => {
    expect(endOfOfficeDay(now, "Africa/Lagos").toISOString()).toBe("2026-10-27T22:59:59.999Z");
  });
});
