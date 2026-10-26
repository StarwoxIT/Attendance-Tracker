import { z } from "zod";

/** Starting radius for a new office. Indoors — and especially in a power cut, when
 * the phone can't use nearby Wi-Fi to place itself — GPS is often off by tens of
 * metres, so a tight radius turns away people sitting at their desks. */
export const DEFAULT_OFFICE_RADIUS_METERS = 150;
export const MIN_OFFICE_RADIUS_METERS = 25;
export const MAX_OFFICE_RADIUS_METERS = 2000;

/** Readings vaguer than this can't place someone inside or outside the office, so the
 * employee is asked to retry (near a window, GPS on) rather than being judged on them. */
export const MAX_LOCATION_ACCURACY_METERS = 200;

/** A position as the browser's Geolocation API reports it. Untrusted client input. */
export const locationReadingSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(1_000_000),
});
export type LocationReading = z.infer<typeof locationReadingSchema>;

export interface OfficeLocation {
  latitude: number | null;
  longitude: number | null;
  locationRadiusMeters: number;
}

export type LocationCheck =
  | { ok: true; distanceMeters: number; accuracyMeters: number }
  | { ok: false; reason: "LOCATION_NOT_CONFIGURED" | "LOCATION_REQUIRED" | "LOCATION_INACCURATE" }
  | { ok: false; reason: "LOCATION_OUT_OF_RANGE"; distanceMeters: number };

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The server-side location decision. The reading comes from the employee's phone,
 * so this stops a shared photo of the QR being used from home — not someone
 * determined enough to fake their GPS; the stored distance/accuracy is there so
 * admins can spot that pattern.
 */
export function checkOfficeLocation(office: OfficeLocation, reading: LocationReading | null): LocationCheck {
  if (office.latitude == null || office.longitude == null) return { ok: false, reason: "LOCATION_NOT_CONFIGURED" };
  if (!reading) return { ok: false, reason: "LOCATION_REQUIRED" };
  if (reading.accuracy > MAX_LOCATION_ACCURACY_METERS) return { ok: false, reason: "LOCATION_INACCURATE" };

  const distance = Math.round(
    distanceMeters({ latitude: office.latitude, longitude: office.longitude }, reading)
  );
  if (distance > office.locationRadiusMeters) {
    return { ok: false, reason: "LOCATION_OUT_OF_RANGE", distanceMeters: distance };
  }
  return { ok: true, distanceMeters: distance, accuracyMeters: Math.round(reading.accuracy) };
}

/** "about 850 m" / "about 2.4 km" — for telling an employee how far off they are. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `about ${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `about ${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}
