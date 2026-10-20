import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runChecks, CHECKS } from "../lib/run.js";
import { formatText } from "../lib/report.js";
import { startFixture } from "../fixtures/sites.js";

let good, bad, goodReport, badReport;
const byN = (report, n) => report.results.find((x) => x.n === n);
const BIN = fileURLToPath(new URL("../bin/site-launch-check.mjs", import.meta.url));
const cli = (args) => new Promise((resolve) => execFile(process.execPath, [BIN, ...args], { timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

before(async () => {
  good = await startFixture("good");
  bad = await startFixture("bad");
  goodReport = await runChecks(good.url);
  badReport = await runChecks(bad.url);
});
after(async () => { await good.close(); await bad.close(); });

test("there are exactly 20 checks, numbered 1 to 20", () => {
  assert.equal(CHECKS.length, 20);
  assert.deepEqual(goodReport.results.map((x) => x.n), Array.from({ length: 20 }, (_, i) => i + 1));
});

test("a well built site passes everything a local http server can pass", () => {
  const expected = { 1: "FAIL", 14: "SKIP", 18: "WARN" }; // no HTTPS on a local fixture
  for (const x of goodReport.results) {
    assert.equal(x.status, expected[x.n] || "PASS", `${x.n} ${x.check}: ${x.detail}`);
  }
  assert.match(byN(goodReport, 1).detail, /plain HTTP/);
  assert.match(byN(goodReport, 18).items.join(" "), /needs HTTPS first/);
});

test("the good site's details name what was found", () => {
  assert.match(byN(goodReport, 3).detail, /Mkate Bakery/);
  assert.match(byN(goodReport, 9).detail, /2 URL\(s\)/);
  assert.match(byN(goodReport, 17).detail, /^3 internal link/); // /, /about and /menu; mailto, #top and the other host skipped
  assert.match(byN(goodReport, 19).detail, /Bakery/);
});

test("the broken site fails the checks it should", () => {
  const fails = { 3: /default title/, 4: /no meta description/, 5: /another host/, 6: /does not load/, 7: /icon link returns an error/,
    8: /blocks every crawler/, 9: /not on/, 10: /not to index/, 11: /no <meta name="viewport">/, 12: /no lang/, 13: /soft 404/,
    15: /over 500 KB/, 16: /no alt attribute/, 17: /broken/, 18: /none of HSTS/, 19: /do not parse/ };
  for (const [n, re] of Object.entries(fails)) {
    const x = byN(badReport, Number(n));
    assert.equal(x.status, "FAIL", `${n} ${x.check}: ${x.status} ${x.detail}`);
    assert.match(x.detail, re, `${n} ${x.check}`);
  }
  assert.ok(byN(badReport, 17).items.some((i) => i.includes("/gone")));
  assert.ok(byN(badReport, 15).items.some((i) => /600 KB .*huge\.jpg/.test(i)));
});

test("the text report is a readable table", () => {
  const text = formatText(badReport);
  assert.match(text, /^Site launch check: http:\/\/127\.0\.0\.1:\d+\//);
  assert.match(text, /PASS \d+ {2}WARN \d+ {2}FAIL \d+/);
  assert.match(text, /\n 3 {2}FAIL {2}Page title +default title "Create Next App"/);
  assert.match(text, /\n {10,}- .*\/gone/);
});

test("CLI exits 1 when any check fails and prints JSON with --json", async () => {
  const { code, stdout } = await cli([bad.url, "--json"]);
  assert.equal(code, 1);
  const json = JSON.parse(stdout);
  assert.equal(json.results.length, 20);
  assert.ok(json.counts.FAIL > 10);
});

test("CLI exits 2 when the site cannot be reached or the URL is bad", async () => {
  const down = await startFixture("good");
  const url = down.url;
  await down.close();
  const r1 = await cli([url]);
  assert.equal(r1.code, 2);
  assert.match(r1.stderr, /could not load/);
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(["http://exa mple.com"])).code, 2);
});
