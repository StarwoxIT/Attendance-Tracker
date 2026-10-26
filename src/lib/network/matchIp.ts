import { normalizeIp } from "./getClientIp";

/**
 * Prefix length used to treat two IPv6 addresses as "the same office network".
 * Unlike IPv4 (where every device shares the office's one NAT'd public IP), each
 * IPv6 device has its own public address — and phones/laptops rotate theirs for
 * privacy. What devices on one LAN share is the /64 network prefix the office
 * router hands out (Starlink delegates a prefix to the router and gives the LAN
 * a /64), so that prefix is the IPv6 equivalent of the office's IPv4 address.
 */
export const IPV6_NETWORK_PREFIX_LENGTH = 64;

export type IpFamily = 4 | 6;

/** Parses a dotted-quad IPv4 address into a 32-bit unsigned integer, or null if invalid. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

/** Parses an IPv6 address (including `::` shorthand and an embedded IPv4 tail) into a 128-bit BigInt, or null if invalid. */
function ipv6ToBigInt(ip: string): bigint | null {
  let address = ip.toLowerCase();
  // An embedded IPv4 tail ("::ffff:1.2.3.4", "64:ff9b::1.2.3.4") becomes two hex groups.
  const v4Tail = address.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const v4 = ipv4ToInt(v4Tail[2]!);
    if (v4 === null) return null;
    address = `${v4Tail[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return n;
}

/** 4 or 6 for a valid address, null for anything else. */
export function ipFamily(ip: string): IpFamily | null {
  const normalized = normalizeIp(ip);
  if (ipv4ToInt(normalized) !== null) return 4;
  if (ipv6ToBigInt(normalized) !== null) return 6;
  return null;
}

/** True if `ip` falls inside `base`/`prefix` — both of the same family. */
function inRange(ip: string, base: string, prefix: number): boolean {
  const ipV4 = ipv4ToInt(ip);
  const baseV4 = ipv4ToInt(base);
  if (ipV4 !== null && baseV4 !== null) {
    if (prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipV4 & mask) === (baseV4 & mask);
  }

  const ipV6 = ipv6ToBigInt(ip);
  const baseV6 = ipv6ToBigInt(base);
  if (ipV6 !== null && baseV6 !== null) {
    if (prefix < 0 || prefix > 128) return false;
    const shift = BigInt(128 - prefix);
    return ipV6 >> shift === baseV6 >> shift;
  }

  return false; // mixed families never match
}

/** True if `ip` equals `candidate`, or falls inside `candidate` when it's a CIDR range (IPv4 or IPv6). */
export function ipMatches(ip: string, candidate: string): boolean {
  const normalizedIp = normalizeIp(ip);
  const normalizedCandidate = normalizeIp(candidate.trim());

  if (!normalizedCandidate.includes("/")) {
    if (ipFamily(normalizedIp) === 6 && ipFamily(normalizedCandidate) === 6) {
      // Same address written differently ("2001:db8::1" vs "2001:db8:0:0:0:0:0:1").
      return ipv6ToBigInt(normalizedIp) === ipv6ToBigInt(normalizedCandidate);
    }
    return normalizedIp.toLowerCase() === normalizedCandidate.toLowerCase();
  }

  const [base, prefixStr] = normalizedCandidate.split("/");
  const prefix = Number(prefixStr);
  if (!base || !/^\d{1,3}$/.test(prefixStr ?? "")) return false;
  return inRange(normalizedIp, base, prefix);
}

/** True if two IPv6 addresses are on the same office LAN (same /64 network prefix). */
export function sameIpv6Network(ip: string, learnedIp: string): boolean {
  return (
    ipFamily(ip) === 6 &&
    ipFamily(learnedIp) === 6 &&
    inRange(normalizeIp(ip), normalizeIp(learnedIp), IPV6_NETWORK_PREFIX_LENGTH)
  );
}

/** The /64 network an IPv6 address belongs to, for display ("2a0d:3344:1a2b:5c00::/64"). */
export function ipv6NetworkLabel(ip: string): string {
  const n = ipv6ToBigInt(normalizeIp(ip));
  if (n === null) return ip;
  const groups = [48, 32, 16, 0].map((shift) => ((n >> BigInt(64 + shift)) & BigInt(0xffff)).toString(16));
  return `${groups.join(":")}::/${IPV6_NETWORK_PREFIX_LENGTH}`;
}

/**
 * The OfficeNetwork fields to update when the office is observed on `ip` (agent
 * heartbeat or admin "Authorize"). Only that address family is replaced, so an
 * IPv6 sighting never wipes out the IPv4 address (or vice versa) — browsers in
 * the same office can be on either.
 */
export function observedAddressUpdate(ip: string, now: Date) {
  const base = { lastVerifiedAt: now, status: "VERIFIED" as const };
  return ipFamily(ip) === 6
    ? { ...base, currentPublicIpv6: normalizeIp(ip), ipv6VerifiedAt: now }
    : { ...base, currentPublicIp: normalizeIp(ip), ipv4VerifiedAt: now };
}

export interface MatchableNetwork {
  /** Last IPv4 address the office was seen on (agent heartbeat or admin "Authorize"). */
  currentPublicIp: string | null;
  /** Last IPv6 address seen from the office — matched by its /64 network, not exactly. */
  currentPublicIpv6?: string | null;
  /** Optional admin-entered address or range, IPv4 or IPv6. */
  cidr: string | null;
}

/** Which of the network's identities `sourceIp` matched, if any. */
export type NetworkMatch = "IPV4" | "IPV6" | "CIDR" | null;

export function matchOfficeNetwork(sourceIp: string, network: MatchableNetwork): NetworkMatch {
  if (network.currentPublicIp && ipMatches(sourceIp, network.currentPublicIp)) return "IPV4";
  if (network.currentPublicIpv6 && sameIpv6Network(sourceIp, network.currentPublicIpv6)) return "IPV6";
  if (network.cidr && ipMatches(sourceIp, network.cidr)) return "CIDR";
  return null;
}

/**
 * Checks a source IP against every authorized identity for an office network:
 * the last-seen IPv4 and IPv6 network, plus an optional CIDR range.
 * Returns false (deny) if there is nothing to match against — an office with
 * no verified network can never authorize attendance.
 */
export function isIpAuthorized(sourceIp: string, network: MatchableNetwork): boolean {
  return matchOfficeNetwork(sourceIp, network) !== null;
}
