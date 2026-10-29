"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateOfficeLocationAction } from "@/lib/actions/offices";
import { toast, toastError } from "@/hooks/use-toast";

/** A captured reading looser than this is worth flagging — it could put the pin on the wrong building. */
const LOOSE_CAPTURE_METERS = 50;

interface OfficeLocationPanelProps {
  officeId: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  canManage: boolean;
}

export function OfficeLocationPanel({ officeId, latitude, longitude, radiusMeters, canManage }: OfficeLocationPanelProps) {
  const [lat, setLat] = useState(latitude?.toString() ?? "");
  const [lng, setLng] = useState(longitude?.toString() ?? "");
  const [radius, setRadius] = useState(radiusMeters.toString());
  const [capture, setCapture] = useState<{ busy: boolean; note: string | null; warn: boolean }>({
    busy: false,
    note: null,
    warn: false,
  });
  const [pending, startTransition] = useTransition();

  const mapUrl =
    lat && lng ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}` : null;

  function useCurrentLocation() {
    if (!window.isSecureContext) {
      setCapture({
        busy: false,
        note: "Browsers only share location on https pages, and this site isn't on https yet — enter the coordinates instead. Staff QR check-ins need https too.",
        warn: true,
      });
      return;
    }
    if (!navigator.geolocation) {
      setCapture({ busy: false, note: "This browser can't share its location — enter the coordinates instead.", warn: true });
      return;
    }
    setCapture({ busy: true, note: null, warn: false });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLat(coords.latitude.toFixed(6));
        setLng(coords.longitude.toFixed(6));
        const accuracy = Math.round(coords.accuracy);
        setCapture({
          busy: false,
          warn: accuracy > LOOSE_CAPTURE_METERS,
          note:
            accuracy > LOOSE_CAPTURE_METERS
              ? `Only accurate to ±${accuracy} m — check the pin on the map, or try again near a window.`
              : `Captured (±${accuracy} m). Check the pin on the map, then save.`,
        });
      },
      (err) =>
        setCapture({
          busy: false,
          warn: true,
          note:
            err.code === err.PERMISSION_DENIED
              ? "Location access was blocked for this site — allow it in the browser, or enter the coordinates instead."
              : "Couldn't get a location fix — try again, or enter the coordinates instead.",
        }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
    );
  }

  function save(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await updateOfficeLocationAction(officeId, formData);
        if (result.error) toast({ title: "Couldn't save office location", description: result.error, variant: "destructive" });
        else toast({ title: "Office location saved", variant: "success" });
      } catch (err) {
        toastError(err, "Couldn't save office location");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Office location (for QR attendance)</p>
        <p className="text-xs text-muted-foreground">
          In QR + location mode, a scan only counts when the employee&apos;s phone puts them within the radius of
          this point.
          {latitude == null ? " Not set yet — QR + location mode won't work for this office until it is." : null}
        </p>
      </div>

      {canManage ? (
        <form action={save} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Latitude</label>
            <Input name="latitude" value={lat} onChange={(e) => setLat(e.target.value)} required inputMode="decimal" className="h-9 w-36" placeholder="6.524379" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Longitude</label>
            <Input name="longitude" value={lng} onChange={(e) => setLng(e.target.value)} required inputMode="decimal" className="h-9 w-36" placeholder="3.379206" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Radius (m)</label>
            <Input name="locationRadiusMeters" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} required min={25} max={2000} className="h-9 w-24" />
          </div>
          <Button type="button" size="sm" variant="outline" onClick={useCurrentLocation} disabled={capture.busy}>
            {capture.busy ? "Locating…" : "Use my current location"}
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            Save location
          </Button>
          {mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="self-center text-sm text-primary hover:underline">
              Check on map
            </a>
          ) : null}
        </form>
      ) : (
        <p className="text-sm">
          {latitude != null && longitude != null ? `${latitude}, ${longitude} · ${radiusMeters} m radius` : "Not set"}
        </p>
      )}
      {capture.note ? (
        <p className={`text-xs ${capture.warn ? "text-amber-700" : "text-muted-foreground"}`}>{capture.note}</p>
      ) : null}
      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Press &ldquo;Use my current location&rdquo; while standing inside the office, or long-press the building in
          Google Maps and copy its two numbers. Indoors, phones are often 20–60 m off (more when the Wi-Fi is down), so
          150 m is a sensible starting radius.
        </p>
      ) : null}

    </div>
  );
}
