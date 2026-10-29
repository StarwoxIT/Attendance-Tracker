import { describe, it, expect } from "vitest";
import {
  checkOfficeLocation,
  distanceMeters,
  formatDistance,
  locationReadingSchema,
  MAX_LOCATION_ACCURACY_METERS,
} from "@/lib/attendance/location";

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
