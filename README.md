# site-launch-check

Run 20 pre-launch checks against any URL and get a PASS, WARN or FAIL table in a few seconds. For developers and agencies shipping small business sites, and for anyone who wants a quick "is this ready?" before telling a client it is live.

**Try it in the browser: [site-launch-check.vercel.app](https://site-launch-check.vercel.app)** (paste any public address; reports get a share link for 30 days)

```sh
node bin/site-launch-check.mjs https://example.com
```

## Why I built this

I ship sites for Kenyan clients and community programmes, usually alone, and the bugs that embarrass you after launch are rarely hard ones. A `noindex` left on from staging. A social preview with no picture. `http://` serving a second copy of the site. A 404 page that answers 200. A 2 MB hero photo on a phone with three bars of signal.

I kept a launch checklist and a script that walks it in a headless browser. This repo is the part of that script that needs nothing but Node: one command, no install, no browser, safe to run in CI.

## Quick start

```sh
git clone https://github.com/bytemel/site-launch-check.git
cd site-launch-check
node bin/site-launch-check.mjs https://your-site.co.ke
node bin/site-launch-check.mjs https://your-site.co.ke --json   # for scripts and CI
npm test                                                        # node --test, no internet needed
```

Needs Node 20 or newer. No dependencies. A bare domain like `your-site.co.ke` is treated as `https://your-site.co.ke`.

Exit codes: `0` when nothing fails, `1` when any check FAILs, `2` when the URL is invalid or the site cannot be reached. So `node bin/site-launch-check.mjs "$URL" || exit 1` blocks a deploy pipeline on a real problem, and WARNs do not.

## Sample output

Run against `https://example.com` on 21 October 2026 (exit code 1):

```
$ node bin/site-launch-check.mjs https://example.com
Site launch check: https://example.com  2026-10-21
PASS 9  WARN 6  FAIL 5

 1  FAIL  HTTPS and one canonical host  http:// serves the page instead of redirecting to https://
                                        - www.example.com ends at www.example.com, not example.com: two hosts serve the site
 2  PASS  Home page returns 200         200 OK
 3  PASS  Page title                    14 chars: "Example Domain"
 4  FAIL  Meta description              no meta description
 5  WARN  Canonical tag                 no <link rel="canonical">
 6  FAIL  Open Graph and Twitter image  no og:image, so shared links show no picture
                                        - add <meta property="og:image" content="https://.../og.png"> (1200 x 630)
 7  WARN  Favicon and apple-touch-icon  1 icon link(s), no apple-touch-icon for iPhone home screens
 8  WARN  robots.txt                    /robots.txt answers 404; add one that points to your sitemap
 9  FAIL  sitemap.xml                   no sitemap at https://example.com/sitemap.xml (404)
10  PASS  No stray noindex              no noindex in meta tags or headers
11  PASS  Viewport meta                 width=device-width,initial-scale=1
12  PASS  lang attribute                lang="en"
13  WARN  404 page returns 404          404 status is right, but the page has no link back to the home page
14  PASS  Mixed content                 no http:// resources on the HTTPS page
15  PASS  Heavy images                  no images on the home page
16  PASS  Alt text                      no images on the home page
17  WARN  Broken internal links         no internal links found on the home page
18  FAIL  Security headers              none of HSTS, nosniff or frame protection is set
                                        - Strict-Transport-Security: max-age=63072000; includeSubDomains
                                        - X-Content-Type-Options: nosniff
                                        - X-Frame-Options: DENY (or CSP frame-ancestors)
19  WARN  Structured data               no JSON-LD; add Organization or WebSite data so search engines know who you are
20  PASS  Page weight                   2 KB across the HTML and 1 file(s)
```

## The 20 checks

| # | Check | FAIL when | WARN when |
|---|---|---|---|
| 1 | HTTPS and one canonical host | served over plain HTTP, `http://` serves the page, or `www` and the bare domain both serve it | redirect is temporary (302 or 307), `www` does not resolve, more than 2 redirects |
| 2 | Home page returns 200 | any other status | not served as HTML |
| 3 | Page title | missing or a framework default ("Create Next App") | over 60 or under 10 characters |
| 4 | Meta description | missing or a default | outside 110 to 160 characters |
| 5 | Canonical tag | points to another host or a URL that is not 200 | missing or relative |
| 6 | Open Graph and Twitter image | no `og:image`, or it does not load | relative URL, not an image, no `twitter:card` |
| 7 | Favicon and apple-touch-icon | no icon at all, or an icon link is broken | only `/favicon.ico`, or no apple-touch-icon |
| 8 | robots.txt | blocks every crawler, or returns an HTML page | missing, or no `Sitemap:` line |
| 9 | sitemap.xml | missing, empty, not a sitemap, or lists URLs on another host or scheme | the robots `Sitemap:` line uses another host |
| 10 | No stray noindex | `noindex` in a robots meta tag or the `X-Robots-Tag` header | |
| 11 | Viewport meta | missing, or no `width=device-width` | pinch zoom blocked |
| 12 | lang attribute | `<html>` has no `lang` | value does not look like a language code |
| 13 | 404 page returns 404 | a made up URL answers 200 (a soft 404) | other status, or no link back home |
| 14 | Mixed content | `http://` scripts, stylesheets, frames or form actions on an HTTPS page | `http://` images or media |
| 15 | Heavy images | an image over 500 KB, or a broken image | an image over 200 KB |
| 16 | Alt text | an `<img>` with no `alt` attribute (`alt=""` is fine for decoration) | |
| 17 | Broken internal links | a link on the home page answers 404, 410, 5xx or nothing (first 30 links) | links answer 401, 403, 429 or time out |
| 18 | Security headers | none of HSTS, `X-Content-Type-Options: nosniff`, frame protection | one or two missing |
| 19 | Structured data | a JSON-LD block that is not valid JSON | no JSON-LD or microdata |
| 20 | Page weight | HTML, CSS, JS and images over 4 MB | over 2 MB, or the HTML alone over 500 KB |

A check shows SKIP when it cannot apply, for example mixed content on a page that is not HTTPS.

## How it works

- `lib/http.js` fetches with redirects followed by hand, so every hop is visible. Resources get a HEAD request first and a GET when the server refuses HEAD. Nothing is fetched twice.
- `lib/html.js` is a small tokenizer, about 100 lines. It reads start tags and their attributes, keeps the text of `<title>` and `<script>`, and skips comments. It does not build a DOM.
- `lib/judge.js` has one pure function per check. They take facts and return a status, so each rule is tested without a network.
- `lib/run.js` gathers the facts for one URL and calls the judges in order. `lib/report.js` prints the table or JSON.
- Tests run two local `node:http` sites, one built right and one with every mistake on the list, plus unit tests for the tokenizer and the judges.

## The web version

The same `runChecks` runs behind [site-launch-check.vercel.app](https://site-launch-check.vercel.app), on Vercel Functions with [Neon](https://neon.tech) Postgres for share links and rate limits.

- `web/` is the page, `api/check.js` runs a check, `api/report.js` reads a saved one.
- A server that fetches any URL you give it can be pointed at its own network. `lib/guard.js` wraps `fetch` and refuses other schemes, ports other than 80 and 443, and any host that resolves to a private, loopback, link-local or cloud metadata address. It runs on every redirect hop, and caps one run at 160 requests. The CLI does not use it: on your own machine, checking `localhost` is the point.
- Limits: 6 checks per 10 minutes per visitor, 400 a day for the whole demo, reports deleted after 30 days.
- `@neondatabase/serverless` is a dev dependency, used only by the web routes, so the CLI still installs with no dependencies.

To run your own: import the repo on Vercel, add Neon from the Marketplace (it sets `DATABASE_URL`), deploy. The app creates its `site_launch_check` tables on first request.

## Limits

- It checks the home page only (plus robots, sitemap, a made up 404 URL, and the links and files the home page uses). It does not crawl the whole site.
- It reads the HTML the server sends. A site that renders everything in the browser with JavaScript will look empty to it, and that is also roughly what many crawlers and link previews see.
- Page weight is approximate: it uses `Content-Length` where the server sends it, and the downloaded size otherwise. It counts up to 40 stylesheets and scripts and 40 images, and nothing loaded later by scripts.
- Image sizes come from the `src` attribute, not `srcset`, so it measures the fallback image.
- It cannot see layout problems (horizontal scroll, tap target size, a mobile menu that does not open). Those need a real browser.
- Some hosts block bots or rate limit. Those links show as WARN, not FAIL. Open them by hand.

## License

MIT. Copyright 2026 Timothy Mwangi.
