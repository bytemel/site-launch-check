// GET ?id=: a saved report, for share links. Reports are kept 30 days.
import { counts } from "../lib/report.js";
import { db, migrate } from "../lib/web-db.js";
import { json, route, fail } from "../lib/web-http.js";

export const GET = route(async (request) => {
  await migrate();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) throw fail(404, "No report here.");
  const [row] = await db()`select report, created_at from site_launch_check.reports where id = ${id} and created_at > now() - interval '30 days'`;
  if (!row) throw fail(404, "This report has expired or the link is wrong. Reports are kept for 30 days.");
  return json({ ok: true, id, report: row.report, counts: counts(row.report.results), checkedAt: new Date(row.created_at).toISOString() });
});
