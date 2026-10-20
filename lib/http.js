// Small fetch helpers: redirects followed by hand (so we can see every hop), timeouts,
// HEAD with a GET fallback, and a cache so no URL is fetched twice in one run.

export const USER_AGENT = "site-launch-check/1.0 (+https://github.com/bytemel/site-launch-check)";

export function createHttp({ fetch = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const cache = new Map();

  async function once(url, method = "GET") {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  }

  // GET with redirects followed by hand. Returns the hops, the final response and its body as text.
  async function page(url, { maxHops = 10 } = {}) {
    const key = `page ${url}`;
    if (cache.has(key)) return cache.get(key);
    const run = (async () => {
      const hops = [];
      let current = url;
      try {
        for (let n = 0; n <= maxHops; n++) {
          const res = await once(current);
          const location = res.headers.get("location");
          if (res.status >= 300 && res.status < 400 && location) {
            hops.push({ url: current, status: res.status, location: new URL(location, current).href });
            res.body?.cancel().catch(() => {});
            current = new URL(location, current).href;
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          return { ok: true, url: current, status: res.status, headers: res.headers, hops, bytes: buf.length, text: buf.toString("utf8") };
        }
        return { ok: false, url: current, status: 0, hops, error: "too many redirects" };
      } catch (e) {
        return { ok: false, url: current, status: 0, hops, error: errorName(e) };
      }
    })();
    cache.set(key, run);
    return run;
  }

  // One request, no redirect following: used to see where http:// and www. send people.
  async function probe(url) {
    try {
      const res = await once(url);
      res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      return { status: res.status, location: location ? new URL(location, url).href : null };
    } catch (e) {
      return { status: 0, error: errorName(e) };
    }
  }

  // Status and size of a resource (link, image, script). HEAD first, GET when HEAD is refused.
  async function resource(url) {
    const key = `res ${url}`;
    if (cache.has(key)) return cache.get(key);
    const run = (async () => {
      try {
        let current = url;
        for (let n = 0; n < 6; n++) {
          let res = await fetch(current, { method: "HEAD", redirect: "manual", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
          if ([403, 405, 501].includes(res.status) || res.status >= 500 || (res.ok && !res.headers.get("content-length"))) {
            res = await once(current, "GET");
            const location = res.headers.get("location");
            if (res.status >= 300 && res.status < 400 && location) { res.body?.cancel().catch(() => {}); current = new URL(location, current).href; continue; }
            const buf = await res.arrayBuffer();
            return { status: res.status, type: res.headers.get("content-type") || "", bytes: Number(res.headers.get("content-length")) || buf.byteLength, final: current };
          }
          const location = res.headers.get("location");
          if (res.status >= 300 && res.status < 400 && location) { current = new URL(location, current).href; continue; }
          return { status: res.status, type: res.headers.get("content-type") || "", bytes: Number(res.headers.get("content-length")) || 0, final: current };
        }
        return { status: 0, error: "too many redirects", bytes: 0, type: "" };
      } catch (e) {
        return { status: 0, error: errorName(e), bytes: 0, type: "" };
      }
    })();
    cache.set(key, run);
    return run;
  }

  return { page, probe, resource };
}

function errorName(e) {
  const code = e?.cause?.code || e?.code;
  if (code) return code;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  return e?.message || "error";
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
