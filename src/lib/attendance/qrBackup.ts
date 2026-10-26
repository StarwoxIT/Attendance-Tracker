import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db/prisma";
import type { OfficeNetwork } from "@prisma/client";

/**
 * When the QR + location backup is open for an office (attendance mode
 * NETWORK_WITH_QR_BACKUP). Two ways in:
 *  - automatically, when the office's Network Agent has stopped checking in — what a
 *    power cut or internet outage at the office looks like from here;
 *  - by hand, an admin switching it on for the rest of the day (no waiting for the
 *    agent to go stale, and the only way in for an office without an agent, since an
 *    office that never sends heartbeats would otherwise look permanently offline).
 */
export type QrBackupState =
  | { active: true; reason: "MANUAL"; until: Date }
  | { active: true; reason: "NETWORK_OFFLINE"; lastSeenAt: Date | null }
  | { active: false; reason: "NETWORK_ONLINE" | "NO_AGENT" };

type AgentNetworkFields = Pick<OfficeNetwork, "status" | "agentSigningSecret" | "lastVerifiedAt">;

export function qrBackupState(
  office: { qrBackupUntil: Date | null },
  networks: AgentNetworkFields[],
  staleThresholdMinutes: number,
  now: Date = new Date()
): QrBackupState {
  if (office.qrBackupUntil && office.qrBackupUntil > now) {
    return { active: true, reason: "MANUAL", until: office.qrBackupUntil };
  }

  const agents = networks.filter((n) => n.status !== "DISABLED" && n.agentSigningSecret);
  if (agents.length === 0) return { active: false, reason: "NO_AGENT" };

  const lastSeen = agents.reduce<Date | null>(
    (latest, n) => (n.lastVerifiedAt && (!latest || n.lastVerifiedAt > latest) ? n.lastVerifiedAt : latest),
    null
  );
  const online = lastSeen && now.getTime() - lastSeen.getTime() <= staleThresholdMinutes * 60_000;
  return online ? { active: false, reason: "NETWORK_ONLINE" } : { active: true, reason: "NETWORK_OFFLINE", lastSeenAt: lastSeen };
}

export async function getQrBackupState(officeId: string, staleThresholdMinutes: number): Promise<QrBackupState> {
  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: {
      qrBackupUntil: true,
      officeNetworks: { select: { status: true, agentSigningSecret: true, lastVerifiedAt: true } },
    },
  });
  return qrBackupState(office, office.officeNetworks, staleThresholdMinutes);
}

/** The manual switch lasts until the end of the office's day, so nobody has to remember to turn it off. */
export function endOfOfficeDay(now: Date, timezone: string): Date {
  return fromZonedTime(`${formatInTimeZone(now, timezone, "yyyy-MM-dd")}T23:59:59.999`, timezone);
}
