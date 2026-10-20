#!/usr/bin/env node
// Usage: node bin/site-launch-check.mjs https://example.com [--json]
// Exit code: 0 when nothing fails, 1 when any check FAILs, 2 on a usage error or when the site cannot be reached.
import { runChecks } from "../lib/run.js";
import { formatText, counts } from "../lib/report.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
let target = args.find((a) => !a.startsWith("--"));

if (!target || args.includes("--help") || args.includes("-h")) {
  console.error("usage: site-launch-check <url> [--json]\n\nRuns 20 pre-launch checks and prints PASS, WARN or FAIL for each.\nExit code 1 if any check fails, 2 if the site cannot be reached.");
  process.exit(target ? 0 : 2);
}
if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
try { new URL(target); } catch {
  console.error(`site-launch-check: "${target}" is not a valid URL`);
  process.exit(2);
}

try {
  const report = await runChecks(target);
  if (json) console.log(JSON.stringify({ ...report, counts: counts(report.results) }, null, 2));
  else console.log(formatText(report, { color: process.stdout.isTTY && !process.env.NO_COLOR }));
  process.exit(report.results.some((x) => x.status === "FAIL") ? 1 : 0);
} catch (e) {
  console.error(`site-launch-check: ${e.message}`);
  process.exit(2);
}
