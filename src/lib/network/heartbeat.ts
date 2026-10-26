import { prisma } from "@/lib/db/prisma";
import { verifyAgentSignature } from "./agentAuth";
import { observedAddressUpdate } from "./matchIp";

export type HeartbeatResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "NOT_REGISTERED" | "DISABLED" | "BAD_SIGNATURE" };

export interface HeartbeatInput {
  agentId: string;
  officeId: string;
  reportedIp: string;
  timestamp: string;
  signature: string;
  sourceIp: string;
}

/**
 * Processes an authenticated agent heartbeat. `sourceIp` (server-observed, from
 * getClientIp on the incoming request) — NOT `reportedIp` (the agent's own claim)
 * — becomes the office's authoritative address for that IP family (IPv4 or IPv6). This is what closes the
 * loop on Starlink's dynamic IP without ever trusting client-supplied network data.
 */
export async function processHeartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
  const network = await prisma.officeNetwork.findUnique({ where: { agentId: input.agentId } });
  if (!network || network.officeId !== input.officeId) return { ok: false, reason: "NOT_FOUND" };
  if (network.status === "DISABLED") return { ok: false, reason: "DISABLED" };
  if (!network.agentSigningSecret) return { ok: false, reason: "NOT_REGISTERED" };

  const payload = JSON.stringify({
    officeId: input.officeId,
    agentId: input.agentId,
    reportedIp: input.reportedIp,
  });

  const signatureValid = verifyAgentSignature({
    payload,
    timestamp: input.timestamp,
    signature: input.signature,
    secret: network.agentSigningSecret,
  });
  if (!signatureValid) return { ok: false, reason: "BAD_SIGNATURE" };

  const now = new Date();
  const update = observedAddressUpdate(input.sourceIp, now);
  // Compare against the same family's last address — an agent alternating between
  // IPv4 and IPv6 heartbeats isn't an IP change.
  const ipChanged =
    "currentPublicIpv6" in update
      ? network.currentPublicIpv6 !== update.currentPublicIpv6
      : network.currentPublicIp !== update.currentPublicIp;

  await prisma.$transaction([
    prisma.networkHeartbeat.create({
      data: {
        officeNetworkId: network.id,
        agentId: input.agentId,
        sourceIp: input.sourceIp,
        reportedIp: input.reportedIp,
        timestamp: new Date(Number(input.timestamp) * 1000),
        status: ipChanged ? "IP_CHANGED" : "OK",
      },
    }),
    prisma.officeNetwork.update({
      where: { id: network.id },
      data: update,
    }),
  ]);

  return { ok: true };
}
