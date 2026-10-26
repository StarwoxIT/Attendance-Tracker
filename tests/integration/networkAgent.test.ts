import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { registerNetworkAgent } from "@/lib/network/register";
import { processHeartbeat } from "@/lib/network/heartbeat";
import { generateRegistrationToken, sha256Hex } from "@/lib/network/agentAuth";
import { createHmac } from "crypto";
import { nanoid } from "nanoid";

const hasDb = !!process.env.DATABASE_URL;
const describeIfDb = hasDb ? describe : describe.skip;

function sign(secret: string, timestamp: string, payload: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

describeIfDb("Network agent auth — integration", () => {
  let officeId: string;
  let agentId: string;
  let registrationToken: string;

  beforeAll(async () => {
    const office = await prisma.office.create({ data: { name: "Agent Test Office", timezone: "Africa/Lagos" } });
    officeId = office.id;
  });

  afterAll(async () => {
    await prisma.networkHeartbeat.deleteMany({ where: { officeNetwork: { officeId } } });
    await prisma.officeNetwork.deleteMany({ where: { officeId } });
    await prisma.office.delete({ where: { id: officeId } });
  });

  beforeEach(async () => {
    agentId = nanoid(12);
    const { token, hash } = await generateRegistrationToken();
    registrationToken = token;
    await prisma.officeNetwork.create({
      data: { officeId, name: "Agent Net", agentId, registrationTokenHash: hash, status: "UNVERIFIED" },
    });
  });

  it("rejects registration with the wrong token", async () => {
    const result = await registerNetworkAgent({ agentId, registrationToken: "wrong-token", sourceIp: "1.2.3.4" });
    expect(result.ok).toBe(false);
  });

  it("registers with the correct token and rejects reuse of the same token", async () => {
    const first = await registerNetworkAgent({ agentId, registrationToken, sourceIp: "1.2.3.4" });
    expect(first.ok).toBe(true);

    const second = await registerNetworkAgent({ agentId, registrationToken, sourceIp: "1.2.3.4" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("ALREADY_USED");
  });

  it("accepts a correctly signed heartbeat and updates currentPublicIp from the server-observed source IP", async () => {
    const reg = await registerNetworkAgent({ agentId, registrationToken, sourceIp: "1.2.3.4" });
    if (!reg.ok) throw new Error("registration failed");

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ officeId, agentId, reportedIp: "102.89.0.1" });
    const signature = sign(reg.agentSigningSecret, timestamp, payload);

    const result = await processHeartbeat({
      officeId,
      agentId,
      reportedIp: "102.89.0.1",
      timestamp,
      signature,
      sourceIp: "102.89.0.1", // what the server actually observed
    });
    expect(result.ok).toBe(true);

    const network = await prisma.officeNetwork.findUnique({ where: { agentId } });
    expect(network?.currentPublicIp).toBe("102.89.0.1");
    expect(network?.status).toBe("VERIFIED");
  });

  it("rejects a heartbeat with an invalid signature (e.g. tampered payload)", async () => {
    const reg = await registerNetworkAgent({ agentId, registrationToken, sourceIp: "1.2.3.4" });
    if (!reg.ok) throw new Error("registration failed");

    const timestamp = String(Math.floor(Date.now() / 1000));
    const badSignature = sign("wrong-secret", timestamp, JSON.stringify({ officeId, agentId, reportedIp: "102.89.0.1" }));

    const result = await processHeartbeat({
      officeId,
      agentId,
      reportedIp: "102.89.0.1",
      timestamp,
      signature: badSignature,
      sourceIp: "102.89.0.1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BAD_SIGNATURE");
  });

  it("trusts the server-observed source IP over the agent's self-reported IP", async () => {
    const reg = await registerNetworkAgent({ agentId, registrationToken, sourceIp: "1.2.3.4" });
    if (!reg.ok) throw new Error("registration failed");

    const timestamp = String(Math.floor(Date.now() / 1000));
    // The agent *claims* a different IP than what the server actually sees the request come from.
    const payload = JSON.stringify({ officeId, agentId, reportedIp: "9.9.9.9" });
    const signature = sign(reg.agentSigningSecret, timestamp, payload);

    await processHeartbeat({ officeId, agentId, reportedIp: "9.9.9.9", timestamp, signature, sourceIp: "102.89.0.1" });

    const network = await prisma.officeNetwork.findUnique({ where: { agentId } });
    expect(network?.currentPublicIp).toBe("102.89.0.1");
    expect(network?.currentPublicIp).not.toBe("9.9.9.9");
  });

  it("learns IPv4 and IPv6 from separate heartbeats without one overwriting the other", async () => {
    const reg = await registerNetworkAgent({ agentId, registrationToken, sourceIp: "1.2.3.4" });
    if (!reg.ok) throw new Error("registration failed");

    for (const sourceIp of ["102.89.0.1", "2a0d:3344:1a2b:5c00::7"]) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({ officeId, agentId, reportedIp: sourceIp });
      const result = await processHeartbeat({
        officeId,
        agentId,
        reportedIp: sourceIp,
        timestamp,
        signature: sign(reg.agentSigningSecret, timestamp, payload),
        sourceIp,
      });
      expect(result.ok).toBe(true);
    }

    const network = await prisma.officeNetwork.findUnique({ where: { agentId } });
    expect(network?.currentPublicIp).toBe("102.89.0.1");
    expect(network?.currentPublicIpv6).toBe("2a0d:3344:1a2b:5c00::7");
    expect(network?.ipv4VerifiedAt).not.toBeNull();
    expect(network?.ipv6VerifiedAt).not.toBeNull();
  });
});

describeIfDb("sha256Hex sanity", () => {
  it("is deterministic", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
  });
});
