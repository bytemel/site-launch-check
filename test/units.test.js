import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, parsePage, decodeEntities } from "../lib/html.js";
import * as J from "../lib/judge.js";

test("tokenizer reads attributes in every quoting style and skips comments", () => {
  const tags = tokenize(`<!doctype html><!-- <img src=hidden.png> --><IMG SRC=/a.png alt='A "b"' data-x="1 &amp; 2" hidden>`);
  assert.equal(tags.length, 1);
  assert.deepEqual(tags[0], { name: "img", attrs: { src: "/a.png", alt: 'A "b"', "data-x": "1 & 2", hidden: "" } });
});

test("tokenizer keeps script text whole and does not read tags inside it", () => {
  const tags = tokenize(`<script>var s = "<img src=x>"; if (a<b) {}</script><p class=x>`);
  assert.equal(tags[0].text, 'var s = "<img src=x>"; if (a<b) {}');
  assert.deepEqual(tags.map((t) => t.name), ["script", "p"]);
});

test("tokenizer survives broken HTML without hanging", () => {
  assert.doesNotThrow(() => tokenize(`<a href="unclosed <div <<< <img src= > <title>never closed`));
  assert.deepEqual(tokenize(""), []);
});

test("parsePage finds title, lang, meta by name or property, and link rel tokens", () => {
  const p = parsePage(`<html lang="en-KE"><title>\n Mkate &amp; Co </title><meta property="og:image" content=" /og.png "><meta NAME="Description" content="Hi"><link rel="shortcut icon" href="/f.ico">`);
  assert.equal(p.title, "Mkate & Co");
  assert.equal(p.lang, "en-KE");
  assert.equal(p.meta("og:image"), "/og.png");
  assert.equal(p.meta("description"), "Hi");
  assert.equal(p.links("icon")[0].attrs.href, "/f.ico");
  assert.equal(decodeEntities("&#8217;&#x41;&nope;"), "’A&nope;");
});

test("HTTPS: https, http 301s and www redirects to the main host passes", () => {
  const out = J.judgeHttps({ final: "https://mkate.co.ke/", httpProbe: { status: 301, location: "https://mkate.co.ke/" }, altHost: "www.mkate.co.ke", altFinal: "https://mkate.co.ke/" });
  assert.equal(out.status, "PASS");
  assert.match(out.detail, /www\.mkate\.co\.ke redirects to mkate\.co\.ke/);
});

test("HTTPS: a temporary redirect warns, http serving the page fails", () => {
  assert.equal(J.judgeHttps({ final: "https://a.co.ke/", httpProbe: { status: 302, location: "https://a.co.ke/" }, altHost: null }).status, "WARN");
  const out = J.judgeHttps({ final: "https://a.co.ke/", httpProbe: { status: 200, location: null }, altHost: null });
  assert.equal(out.status, "FAIL");
  assert.match(out.detail, /instead of redirecting/);
});

test("HTTPS: two hosts serving the site fails, a www that does not resolve warns", () => {
  assert.equal(J.judgeHttps({ final: "https://a.co.ke/", altHost: "www.a.co.ke", altFinal: "https://www.a.co.ke/" }).status, "FAIL");
  assert.match(J.judgeHttps({ final: "https://a.co.ke/", altHost: "www.a.co.ke", altError: "ENOTFOUND" }).detail, /does not load \(ENOTFOUND\)/);
  assert.equal(J.judgeHttps({ final: "https://a.co.ke/", altHost: null, hops: [{}, {}, {}] }).status, "WARN");
});

test("title and description length rules", () => {
  assert.equal(J.judgeTitle("").status, "FAIL");
  assert.equal(J.judgeTitle("Home").status, "FAIL");
  assert.equal(J.judgeTitle("x".repeat(61)).status, "WARN");
  assert.equal(J.judgeTitle("Mkate Bakery: fresh bread").status, "PASS");
  assert.equal(J.judgeDescription(null).status, "FAIL");
  assert.equal(J.judgeDescription("Short.").status, "WARN");
  assert.equal(J.judgeDescription("x".repeat(150)).status, "PASS");
});

test("robots parsing understands groups, comments and Allow: /", () => {
  assert.equal(J.parseRobots("User-agent: *\nDisallow: /").blocksAll, true);
  assert.equal(J.parseRobots("User-agent: *\nDisallow: /admin\nDisallow:").blocksAll, false);
  assert.equal(J.parseRobots("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /").blocksAll, false);
  assert.equal(J.parseRobots("User-agent: *\nDisallow: / # everything\nAllow: /").blocksAll, false);
  assert.deepEqual(J.parseRobots("Sitemap: https://a.co.ke/sitemap.xml").sitemaps, ["https://a.co.ke/sitemap.xml"]);
  assert.equal(J.judgeRobots({ status: 200, type: "text/html", text: "<!doctype html><html>" }).status, "FAIL");
});

test("sitemap must be on the same scheme and host as the site", () => {
  const xml = `<urlset><url><loc>https://a.co.ke/</loc></url><url><loc>http://a.co.ke/about</loc></url></urlset>`;
  const out = J.judgeSitemap({ url: "https://a.co.ke/sitemap.xml", status: 200, text: xml, pageUrl: "https://a.co.ke/" });
  assert.equal(out.status, "FAIL");
  assert.match(out.items[0], /http:\/\/a\.co\.ke\/about/);
  const warn = J.judgeSitemap({ url: "https://a.co.ke/sitemap.xml", status: 200, text: `<urlset><url><loc>https://a.co.ke/</loc></url></urlset>`, pageUrl: "https://a.co.ke/", robotsSitemaps: ["https://www.a.co.ke/sitemap.xml"] });
  assert.equal(warn.status, "WARN");
});

test("mixed content: scripts fail, images warn, http pages are skipped", () => {
  const page = (html) => J.judgeMixed("https://a.co.ke/", tokenize(html));
  assert.equal(page(`<script src="http://cdn.test/x.js"></script>`).status, "FAIL");
  assert.equal(page(`<link rel="stylesheet" href="http://cdn.test/x.css">`).status, "FAIL");
  assert.equal(page(`<img src="http://cdn.test/x.png" alt="">`).status, "WARN");
  assert.equal(page(`<img src="https://cdn.test/x.png" alt=""><a href="http://old.test/">ok to link</a>`).status, "PASS");
  assert.equal(J.judgeMixed("http://a.co.ke/", []).status, "SKIP");
});

test("viewport, lang, noindex and alt text", () => {
  assert.equal(J.judgeViewport("width=device-width, initial-scale=1, maximum-scale=1").status, "WARN");
  assert.equal(J.judgeViewport("initial-scale=1").status, "FAIL");
  assert.equal(J.judgeLang("sw").status, "PASS");
  assert.equal(J.judgeLang(null).status, "FAIL");
  assert.equal(J.judgeNoindex({ header: "noindex" }).status, "FAIL");
  assert.equal(J.judgeNoindex({ metaRobots: ["index, follow"] }).status, "PASS");
  assert.equal(J.judgeAlt(tokenize(`<img src=a alt=""><img src=b aria-hidden="true"><img src=c role="presentation">`)).status, "PASS");
  assert.equal(J.judgeAlt(tokenize(`<img src=a><input type=image src=b>`)).items.length, 2);
});

test("404, links, headers, structured data and weight", () => {
  assert.equal(J.judge404({ status: 404, homeLink: true }).status, "PASS");
  assert.equal(J.judge404({ status: 200, hops: [{ location: "https://a.co.ke/" }] }).status, "FAIL");
  assert.equal(J.judgeLinks([{ url: "/x", status: 403 }], { checked: 1, total: 1 }).status, "WARN");
  assert.equal(J.judgeLinks([{ url: "/x", status: 0, error: "ECONNRESET" }], { checked: 1, total: 1 }).status, "FAIL");
  const h = { "strict-transport-security": "max-age=31536000", "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors 'none'" };
  assert.equal(J.judgeHeaders((k) => h[k], true).status, "PASS");
  assert.equal(J.judgeHeaders((k) => ({ ...h, "strict-transport-security": "max-age=0" })[k], true).status, "WARN");
  assert.equal(J.judgeStructured(tokenize(`<div itemscope itemtype="https://schema.org/Organization">`)).status, "PASS");
  assert.match(J.judgeStructured(tokenize(`<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Organization","Bakery"]}]}</script>`)).detail, /WebSite, Organization\/Bakery/);
  assert.equal(J.judgePageWeight({ htmlBytes: 1000, resources: [{ url: "/big.js", bytes: 5 * 1024 * 1024 }] }).status, "FAIL");
  assert.equal(J.judgePageWeight({ htmlBytes: 600 * 1024, resources: [] }).status, "WARN");
});
