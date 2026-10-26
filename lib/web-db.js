// Web demo only (the CLI never imports this). Neon Postgres over HTTP, for shareable reports and rate limits.
// The tables live in their own schema so this app can share a database with others.
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

let sql = null;
let ready = null;

export function db() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is not set"), { status: 503 });
  sql ??= neon(process.env.DATABASE_URL);
  return sql;
}

// Creates the tables on the first request after a cold start. Every statement is idempotent,
// so a fresh Neon database needs no setup step. The same SQL is in schema.sql for reading.
export function migrate() {
  ready ??= db().transaction((q) => [
    q`create schema if not exists site_launch_check`,
    q`create table if not exists site_launch_check.reports (
        id text primary key,
        url text not null,
        final_url text not null,
        pass int not null,
        warn int not null,
        fail int not null,
        report jsonb not null,
        created_at timestamptz not null default now())`,
    q`create index if not exists reports_created on site_launch_check.reports (created_at)`,
    q`create table if not exists site_launch_check.hits (
        bucket text primary key,
        n int not null,
        expires_at timestamptz not null)`,
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

export const hash = (s) => createHash("sha256").update(String(s)).digest("hex");

// The caller's IP, hashed so the table never stores a raw address.
export function clientId(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  return hash(`site-launch-check:${ip}`).slice(0, 32);
}

// Fixed-window rate limit in Postgres: at most `max` calls per `minutes` for one action and caller.
export async function allow(request, action, max, minutes) {
  const bucket = `${action}:${clientId(request)}`;
  const [row] = await db()`
    insert into site_launch_check.hits (bucket, n, expires_at)
    values (${bucket}, 1, now() + make_interval(mins => ${minutes}))
    on conflict (bucket) do update set
      n = case when hits.expires_at < now() then 1 else hits.n + 1 end,
      expires_at = case when hits.expires_at < now() then excluded.expires_at else hits.expires_at end
    returning n`;
  return row.n <= max;
}
