// POST { url }: run the 20 checks from a server, save the report for 30 days, return it with a share id.
import { randomBytes } from "node:crypto";
import { runChecks } from "../lib/run.js";
import { counts } from "../lib/report.js";
import { assertPublicUrl, guardedFetch, BlockedError } from "../lib/guard.js";
import { db, migrate, allow } from "../lib/web-db.js";
import { json, readJson, route, fail } from "../lib/web-http.js";

export const POST = route(async (request) => {
  await migrate();
  const body = await readJson(request, 2048);
  let input = String(body.url || "").trim();
  if (!input) throw fail(400, "Paste a website address.");
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  try {
    await assertPublicUrl(input);
  } catch (e) {
    throw fail(400, e instanceof BlockedError ? `Cannot check that address: ${e.message}.` : "Cannot find that website. Check the address.");
  }
  if (!(await allow(request, "check", 6, 10))) throw fail(429, "Six checks in ten minutes is the limit here. Run the CLI for more: npx site-launch-check <url>");
  // A ceiling for the whole demo, so a busy day cannot run up the bill.
  const [day] = await db()`select count(*)::int as n from site_launch_check.reports where created_at > now() - interval '1 day'`;
  if (day.n >= 400) throw fail(429, "The demo has run its daily share of checks. Try tomorrow, or run the CLI.");

  let report;
  try {
    report = await runChecks(input, { fetch: guardedFetch(), timeoutMs: 8000 });
  } catch (e) {
    if (e.code === "UNREACHABLE") throw fail(422, `Could not load ${input}. ${/BLOCKED/.test(e.message) ? "It redirects to a private address." : "Is the site up?"}`);
    throw e;
  }
  const c = counts(report.results);
  const id = randomBytes(9).toString("base64url");
  const sql = db();
  await sql`delete from site_launch_check.reports where created_at < now() - interval '30 days'`;
  await sql`
    insert into site_launch_check.reports (id, url, final_url, pass, warn, fail, report)
    values (${id}, ${report.url}, ${report.finalUrl}, ${c.PASS}, ${c.WARN}, ${c.FAIL}, ${JSON.stringify(report)}::jsonb)`;
  return json({ ok: true, id, report, counts: c });
});
