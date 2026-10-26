import { prisma } from "@/lib/db/prisma";
import { matchOfficeNetwork } from "./matchIp";
import { getAttendanceSettings } from "@/lib/attendance/settings";

export type NetworkVerificationResult =
  | { allowed: true; officeNetworkId: string }
  | { allowed: false; reason: "NO_NETWORK_CONFIGURED" | "NETWORK_DISABLED" | "STALE_FAIL_CLOSED" | "IP_NOT_AUTHORIZED" };

/**
 * Authoritative office-network check. Only ever call this with a `sourceIp`
 * obtained from `getClientIp()` on the current request — never a client-supplied value.
 */
export async function verifyOfficeNetwork(
  officeId: string,
  sourceIp: string
): Promise<NetworkVerificationResult> {
  const [networks, settings] = await Promise.all([
    prisma.officeNetwork.findMany({ where: { officeId } }),
    getAttendanceSettings(),
  ]);

  const active = networks.filter((n) => n.status !== "DISABLED");
  if (active.length === 0) {
    return { allowed: false, reason: "NO_NETWORK_CONFIGURED" };
  }

  const staleThresholdMs = settings.networkStaleThresholdMinutes * 60_000;
  const now = Date.now();
  const isStale = (verifiedAt: Date | null) => now - (verifiedAt?.getTime() ?? 0) > staleThresholdMs;

  let matchedOnlyStale = false;
  for (const network of active) {
    const match = matchOfficeNetwork(sourceIp, network);
    if (!match) continue;

    // Staleness is judged on the identity that matched: each learned address by
    // its own family's last sighting (so a fresh IPv6 heartbeat can't keep a
    // stale IPv4 address alive), an admin-entered CIDR by the network overall.
    const verifiedAt: Date | null =
      match === "IPV4" ? network.ipv4VerifiedAt : match === "IPV6" ? network.ipv6VerifiedAt : network.lastVerifiedAt;
    if (isStale(verifiedAt) && network.failMode === "FAIL_CLOSED") {
      matchedOnlyStale = true;
      continue; // never authorize on stale data when configured fail-closed
    }
    // FAIL_OPEN: staleness alone doesn't block — the IP still had to match the
    // last-known network, so this never authorizes an unrelated random IP.
    return { allowed: true, officeNetworkId: network.id };
  }

  if (matchedOnlyStale || active.every((n) => isStale(n.lastVerifiedAt) && n.failMode === "FAIL_CLOSED")) {
    return { allowed: false, reason: "STALE_FAIL_CLOSED" };
  }
  return { allowed: false, reason: "IP_NOT_AUTHORIZED" };
}

