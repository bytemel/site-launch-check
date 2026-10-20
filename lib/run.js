// Gathers the facts for one URL and runs the 20 checks in order.
import { randomBytes } from "node:crypto";
import { parsePage } from "./html.js";
import { createHttp, pool } from "./http.js";
import * as J from "./judge.js";

export const CHECKS = [
  "HTTPS and one canonical host", "Home page returns 200", "Page title", "Meta description", "Canonical tag",
  "Open Graph and Twitter image", "Favicon and apple-touch-icon", "robots.txt", "sitemap.xml", "No stray noindex",
  "Viewport meta", "lang attribute", "404 page returns 404", "Mixed content", "Heavy images",
  "Alt text", "Broken internal links", "Security headers", "Structured data", "Page weight",
];

const MAX_LINKS = 30;
const MAX_IMAGES = 40;
const MAX_ASSETS = 40;

const abs = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };
const sameSite = (url, host) => { try { return J.bareHost(new URL(url).host) === J.bareHost(host); } catch { return false; } };

export async function runChecks(input, { fetch = globalThis.fetch, timeoutMs } = {}) {
  const http = createHttp({ fetch, timeoutMs });
  const home = await http.page(input);
  if (!home.ok) {
    const err = new Error(`could not load ${input}: ${home.error}`);
    err.code = "UNREACHABLE";
    throw err;
  }
  const finalUrl = home.url;
  const final = new URL(finalUrl);
  const page = parsePage(home.text);
  const results = [];
  const add = (n, out) => results.push({ n, check: CHECKS[n - 1], ...out, items: (out.items || []).slice(0, 15) });

  // 1. HTTPS and one canonical host
  const httpProbe = final.protocol === "https:" ? await http.probe(`http://${final.host}${final.pathname}`) : null;
  let altHost = null; let altFinal = null; let altError = null;
  if (!J.isLocalHost(final.hostname)) {
    altHost = final.hostname.startsWith("www.") ? final.hostname.slice(4) : `www.${final.hostname}`;
    const alt = await http.page(`${final.protocol}//${altHost}${final.port ? `:${final.port}` : ""}/`);
    if (alt.ok) altFinal = alt.url; else altError = alt.error;
  }
  add(1, J.judgeHttps({ final: finalUrl, hops: home.hops, httpProbe, altHost, altFinal, altError }));

  // 2 to 5: status, title, description, canonical
  add(2, J.judgeStatus({ status: home.status, type: home.headers.get("content-type") || "" }));
  add(3, J.judgeTitle(page.title));
  add(4, J.judgeDescription(page.meta("description")));
  const canonicalHref = page.links("canonical")[0]?.attrs.href || null;
  const canonicalUrl = canonicalHref ? abs(canonicalHref, finalUrl) : null;
  const canonicalStatus = canonicalUrl && sameSite(canonicalUrl, final.host) ? (await http.page(canonicalUrl)).status : null;
  add(5, J.judgeCanonical({ href: canonicalHref, pageUrl: finalUrl, status: canonicalStatus }));

  // 6. Social image
  const ogImage = page.meta("og:image") || page.meta("og:image:url");
  const twitterImage = page.meta("twitter:image") || page.meta("twitter:image:src");
  const og = ogImage ? await http.resource(abs(ogImage, finalUrl)) : null;
  const tw = twitterImage && abs(twitterImage, finalUrl) !== abs(ogImage || "", finalUrl) ? await http.resource(abs(twitterImage, finalUrl)) : og;
  add(6, J.judgeSocial({ ogImage, ogStatus: og?.status, ogType: og?.type, twitterCard: page.meta("twitter:card"), twitterImage, twStatus: tw?.status }));

  // 7. Icons
  const iconLinks = [...page.links("icon"), ...page.links("shortcut"), ...page.links("apple-touch-icon"), ...page.links("apple-touch-icon-precomposed")];
  const uniqueIcons = [...new Map(iconLinks.filter((l) => l.attrs.href).map((l) => [abs(l.attrs.href, finalUrl), l])).entries()];
  const icons = await pool(uniqueIcons, 4, async ([href, l]) => ({ href, rel: l.attrs.rel, status: (await http.resource(href)).status }));
  const fallback = icons.length ? null : await http.resource(`${final.origin}/favicon.ico`);
  add(7, J.judgeIcons({ icons, fallback }));

  // 8 and 9. robots.txt and sitemap.xml
  const robots = await http.page(`${final.origin}/robots.txt`);
  add(8, J.judgeRobots({ status: robots.status, type: robots.headers?.get("content-type") || "", text: robots.text || "" }));
  const robotsSitemaps = robots.status === 200 ? J.parseRobots(robots.text).sitemaps : [];
  const sitemapUrl = robotsSitemaps.find((s) => sameSite(s, final.host)) || `${final.origin}/sitemap.xml`;
  const sitemap = await http.page(sitemapUrl);
  add(9, J.judgeSitemap({ url: sitemapUrl, status: sitemap.status, text: sitemap.text || "", pageUrl: finalUrl, robotsSitemaps }));

  // 10 to 12. noindex, viewport, lang
  const metaRobots = page.all("meta").filter((m) => /^(robots|googlebot)$/i.test(m.attrs.name || "")).map((m) => m.attrs.content || "");
  add(10, J.judgeNoindex({ metaRobots, header: home.headers.get("x-robots-tag") || "" }));
  add(11, J.judgeViewport(page.meta("viewport")));
  add(12, J.judgeLang(page.lang));

  // 13. 404
  const missing = await http.page(`${final.origin}/site-launch-check-${randomBytes(6).toString("hex")}`);
  const missingPage = missing.ok ? parsePage(missing.text) : null;
  const homeLink = !!missingPage?.all("a").some((a) => { const u = abs(a.attrs.href || "", missing.url); return u && sameSite(u, final.host) && new URL(u).pathname === "/"; });
  add(13, J.judge404({ status: missing.status, hops: missing.hops, homeLink, error: missing.error }));

  // 14. Mixed content
  add(14, J.judgeMixed(finalUrl, page.tags));

  // 15 and 16. Images
  const imgUrls = [...new Set(page.all("img").map((t) => t.attrs.src).filter((s) => s && !/^data:/i.test(s)).map((s) => abs(s, finalUrl)).filter(Boolean))].slice(0, MAX_IMAGES);
  const images = await pool(imgUrls, 6, async (url) => ({ url, ...(await http.resource(url)) }));
  add(15, J.judgeImages(images));
  add(16, J.judgeAlt(page.tags));

  // 17. Internal links
  const hrefs = page.all("a").map((a) => (a.attrs.href || "").trim()).filter((h) => h && !/^(#|mailto:|tel:|javascript:|sms:|whatsapp:)/i.test(h));
  const internal = [...new Set(hrefs.map((h) => abs(h, finalUrl)).filter((u) => u && /^https?:/.test(u) && sameSite(u, final.host)).map((u) => u.split("#")[0]))];
  const toCheck = internal.slice(0, MAX_LINKS);
  const links = await pool(toCheck, 6, async (url) => ({ url, ...(await http.resource(url)) }));
  add(17, J.judgeLinks(links, { checked: toCheck.length, total: internal.length }));

  // 18 and 19. Headers and structured data
  add(18, J.judgeHeaders((h) => home.headers.get(h), final.protocol === "https:"));
  add(19, J.judgeStructured(page.tags));

  // 20. Page weight: HTML plus stylesheets, scripts and the images already measured
  const assetUrls = [
    ...page.links("stylesheet").map((l) => l.attrs.href),
    ...page.all("script").map((s) => s.attrs.src),
  ].filter(Boolean).map((h) => abs(h, finalUrl)).filter(Boolean);
  const assets = await pool([...new Set(assetUrls)].slice(0, MAX_ASSETS), 6, async (url) => ({ url, ...(await http.resource(url)) }));
  add(20, J.judgePageWeight({ htmlBytes: home.bytes, resources: [...assets, ...images.filter((i) => i.status === 200)] }));

  return { url: input, finalUrl, date: new Date().toLocaleDateString("en-CA"), results };
}
