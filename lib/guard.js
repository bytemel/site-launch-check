// A fetch for running checks on a public server. It refuses anything that is not a public website:
// other schemes, odd ports, and hosts that resolve to private, loopback, link-local or cloud metadata
// addresses. Every redirect hop goes through it too, because http.js follows redirects by hand.
// The CLI does not use this: on your own machine, checking localhost is the point.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const v4 = (ip) => ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;

export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const n = v4(ip);
    return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4(base) >>> (32 - bits)));
  }
  const a = ip.toLowerCase();
  if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7)); // IPv4 mapped
  return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || a.startsWith("64:ff9b:") || a.startsWith("2001:db8");
}

export class BlockedError extends Error {
  constructor(message) { super(message); this.code = "BLOCKED"; }
}

export async function assertPublicUrl(raw, { resolve = lookup } = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new BlockedError("not a valid URL"); }
  if (!/^https?:$/.test(url.protocol)) throw new BlockedError("only http and https");
  if (url.username || url.password) throw new BlockedError("no credentials in URLs");
  if (url.port && !["80", "443"].includes(url.port)) throw new BlockedError("only ports 80 and 443");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new BlockedError("not a public host");
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new BlockedError("that host points to a private address");
  return url;
}

// Wraps fetch with the guard and a budget on how many requests one run may make.
export function guardedFetch({ fetch = globalThis.fetch, resolve = lookup, budget = 160 } = {}) {
  let used = 0;
  return async (input, init) => {
    if (++used > budget) throw new BlockedError("request budget for one run used up");
    await assertPublicUrl(typeof input === "string" ? input : input.url, { resolve });
    return fetch(input, init);
  };
}
