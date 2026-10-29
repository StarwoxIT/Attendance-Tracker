import { describe, it, expect } from "vitest";
import {
  coveredIpFamilies,
  ipFamily,
  ipMatches,
  ipv6NetworkLabel,
  isIpAuthorized,
  matchOfficeNetwork,
  observedAddressUpdate,
  sameIpv6Network,
} from "@/lib/network/matchIp";

describe("ipMatches", () => {
  it("matches an identical single IP", () => {
    expect(ipMatches("102.89.23.4", "102.89.23.4")).toBe(true);
  });

  it("rejects a different IP", () => {
    expect(ipMatches("102.89.23.4", "102.89.23.5")).toBe(false);
  });

  it("matches an IP inside a CIDR range", () => {
    expect(ipMatches("102.89.0.42", "102.89.0.0/16")).toBe(true);
    expect(ipMatches("102.90.0.42", "102.89.0.0/16")).toBe(false);
  });

  it("handles a /32 CIDR as an exact match", () => {
    expect(ipMatches("102.89.0.1", "102.89.0.1/32")).toBe(true);
    expect(ipMatches("102.89.0.2", "102.89.0.1/32")).toBe(false);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(ipMatches(" 102.89.23.4 ", "102.89.23.4")).toBe(true);
  });
});

describe("isIpAuthorized", () => {
  it("denies when the network has no configured IP or CIDR (nothing to compare against)", () => {
    expect(isIpAuthorized("102.89.23.4", { currentPublicIp: null, cidr: null })).toBe(false);
  });

  it("allows a source IP matching the current public IP", () => {
    expect(isIpAuthorized("102.89.23.4", { currentPublicIp: "102.89.23.4", cidr: null })).toBe(true);
  });

  it("denies an unrelated source IP even with a configured network", () => {
    expect(isIpAuthorized("41.58.0.1", { currentPublicIp: "102.89.23.4", cidr: null })).toBe(false);
  });

  it("allows a source IP matching the CIDR even if currentPublicIp differs", () => {
    expect(isIpAuthorized("102.89.5.9", { currentPublicIp: "102.89.23.4", cidr: "102.89.0.0/16" })).toBe(true);
  });
});

describe("IPv6 office networks", () => {
  const officeV6 = "2a0d:3344:1a2b:5c00:1111:2222:3333:4444";

  it("treats any device in the office's /64 as the office network", () => {
    expect(sameIpv6Network("2a0d:3344:1a2b:5c00:9f3:abcd:12:7", officeV6)).toBe(true);
    expect(sameIpv6Network("2a0d:3344:1a2b:5c00::1", officeV6)).toBe(true);
  });

  it("rejects a different /64, even a neighbouring one", () => {
    expect(sameIpv6Network("2a0d:3344:1a2b:5c01::1", officeV6)).toBe(false);
    expect(sameIpv6Network("2001:db8::1", officeV6)).toBe(false);
  });

  it("never matches an IPv4 address against an IPv6 network or vice versa", () => {
    expect(sameIpv6Network("102.89.0.1", officeV6)).toBe(false);
    expect(ipMatches("2a0d:3344::1", "102.89.0.0/16")).toBe(false);
    expect(ipMatches("102.89.0.1", "2a0d:3344::/32")).toBe(false);
  });

  it("matches IPv6 CIDR ranges and equivalent spellings of the same address", () => {
    expect(ipMatches("2a0d:3344:1a2b:5c00::9", "2a0d:3344:1a2b::/48")).toBe(true);
    expect(ipMatches("2a0d:3345::9", "2a0d:3344:1a2b::/48")).toBe(false);
    expect(ipMatches("2001:db8::1", "2001:0DB8:0:0:0:0:0:1")).toBe(true);
  });

  it("rejects malformed addresses and prefixes", () => {
    expect(ipFamily("2001:db8:::1")).toBeNull();
    expect(ipFamily("1.2.3")).toBeNull();
    expect(ipMatches("2001:db8::1", "2001:db8::/abc")).toBe(false);
  });

  it("classifies address families, unwrapping IPv4-mapped IPv6", () => {
    expect(ipFamily("102.89.0.1")).toBe(4);
    expect(ipFamily("::ffff:102.89.0.1")).toBe(4);
    expect(ipFamily(officeV6)).toBe(6);
  });

  it("matches a browser on either family once both are learned", () => {
    const network = { currentPublicIp: "102.89.0.1", currentPublicIpv6: officeV6, cidr: null };
    expect(matchOfficeNetwork("102.89.0.1", network)).toBe("IPV4");
    expect(matchOfficeNetwork("2a0d:3344:1a2b:5c00::abc", network)).toBe("IPV6");
    expect(matchOfficeNetwork("41.58.0.99", network)).toBeNull();
  });

  it("records an observed address against its own family only", () => {
    const now = new Date();
    expect(observedAddressUpdate("2a0d:3344:1a2b:5c00::1", now)).toEqual({
      lastVerifiedAt: now,
      status: "VERIFIED",
      currentPublicIpv6: "2a0d:3344:1a2b:5c00::1",
      ipv6VerifiedAt: now,
    });
    expect(observedAddressUpdate("::ffff:102.89.0.1", now)).toMatchObject({ currentPublicIp: "102.89.0.1", ipv4VerifiedAt: now });
  });

  it("labels the office /64 for display", () => {
    expect(ipv6NetworkLabel(officeV6)).toBe("2a0d:3344:1a2b:5c00::/64");
  });
});

describe("coveredIpFamilies", () => {
  it("counts a CIDR toward the family it's written in", () => {
    expect(coveredIpFamilies({ currentPublicIp: null, currentPublicIpv6: "::1", cidr: "127.0.0.0/8" })).toEqual({
      ipv4: true,
      ipv6: true,
    });
    expect(coveredIpFamilies({ currentPublicIp: "102.88.14.201", currentPublicIpv6: null, cidr: null })).toEqual({
      ipv4: true,
      ipv6: false,
    });
    expect(
      coveredIpFamilies({ currentPublicIp: "102.88.14.201", currentPublicIpv6: null, cidr: "2a0d:3344:1a2b:5c00::/64" })
    ).toEqual({ ipv4: true, ipv6: true });
  });
});
