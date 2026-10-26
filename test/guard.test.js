import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, assertPublicUrl, guardedFetch } from "../lib/guard.js";

test("private, loopback, link-local and metadata addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.100.85.47", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.1.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("URLs are checked for scheme, port, credentials and where the host resolves", async () => {
  const resolve = async (host) => (host === "evil.example" ? [{ address: "8.8.8.8" }, { address: "10.0.0.5" }] : [{ address: "93.184.215.14" }]);
  await assertPublicUrl("https://example.com/", { resolve });
  await assert.rejects(assertPublicUrl("file:///etc/passwd", { resolve }), /http and https/);
  await assert.rejects(assertPublicUrl("http://example.com:8080/", { resolve }), /ports/);
  await assert.rejects(assertPublicUrl("http://user:pw@example.com/", { resolve }), /credentials/);
  await assert.rejects(assertPublicUrl("http://localhost/", { resolve }), /public host/);
  await assert.rejects(assertPublicUrl("http://127.0.0.1/", { resolve }), /private/);
  await assert.rejects(assertPublicUrl("http://[::1]/", { resolve }), /private/);
  await assert.rejects(assertPublicUrl("http://evil.example/", { resolve }), /private/, "any private record blocks the host");
});

test("the guarded fetch checks every call and stops at the budget", async () => {
  const seen = [];
  const f = guardedFetch({ fetch: async (u) => { seen.push(u); return new Response("ok"); }, resolve: async () => [{ address: "93.184.215.14" }], budget: 2 });
  await f("https://example.com/a");
  await f("https://example.com/b");
  await assert.rejects(f("https://example.com/c"), /budget/);
  await assert.rejects(guardedFetch({ resolve: async () => [{ address: "169.254.169.254" }] })("http://metadata.example/"), /private/);
  assert.deepEqual(seen, ["https://example.com/a", "https://example.com/b"]);
});
