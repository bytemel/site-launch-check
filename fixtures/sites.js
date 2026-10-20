// Two local sites for the tests: one built right, one with every common launch mistake.
import { createServer } from "node:http";

const DESCRIPTION = "Nairobi bakery baking sourdough, chapati and birthday cakes every morning. Order online by 10am for same day delivery across Westlands and Kilimani.";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

function goodHome(origin) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mkate Bakery: fresh bread in Nairobi</title>
  <meta name="description" content="${DESCRIPTION}">
  <link rel="canonical" href="${origin}/">
  <meta property="og:title" content="Mkate Bakery">
  <meta property="og:image" content="${origin}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/icon.png" type="image/png">
  <link rel="apple-touch-icon" href="/apple-icon.png">
  <link rel="stylesheet" href="/style.css">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Bakery","name":"Mkate Bakery"}</script>
</head>
<body>
  <header><a href="/"><img src="/logo.png" alt="Mkate Bakery"></a></header>
  <main>
    <img src="/bread.png" alt="">
    <a href="/about">About</a> <a href="/menu#cakes">Cakes</a> <a href="mailto:hi@mkate.test">Email</a> <a href="#top">Top</a>
    <a href="https://elsewhere.test/">Partner</a>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

const badHome = `<html>
<head>
  <title>Create Next App</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="canonical" href="https://another-host.test/">
  <meta property="og:image" content="/missing-og.png">
  <link rel="icon" href="/broken-icon.png">
  <script type="application/ld+json">{"@type": "Organization",}</script>
</head>
<body>
  <img src="/huge.jpg">
  <img src="/ok.png" alt="fine">
  <a href="/gone">Old page</a>
  <a href="/about">About</a>
</body>
</html>`;

export function startFixture(kind) {
  const server = createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const path = new URL(req.url, origin).pathname;
    const send = (status, body, type = "text/html; charset=utf-8", extra = {}) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, { "content-type": type, "content-length": buf.length, ...extra });
      res.end(req.method === "HEAD" ? undefined : buf);
    };
    if (kind === "good") {
      const sec = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "strict-transport-security": "max-age=63072000" };
      if (path === "/") return send(200, goodHome(origin), undefined, sec);
      if (path === "/about" || path === "/menu") return send(200, "<!doctype html><title>About</title>");
      if (["/og.png", "/icon.png", "/apple-icon.png", "/logo.png", "/bread.png"].includes(path)) return send(200, PNG, "image/png");
      if (path === "/style.css") return send(200, "body{margin:0}", "text/css");
      if (path === "/app.js") return send(200, "console.log(1)", "text/javascript");
      if (path === "/robots.txt") return send(200, `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, "text/plain");
      if (path === "/sitemap.xml") return send(200, `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/about</loc></url></urlset>`, "application/xml");
      return send(404, `<!doctype html><title>Not found</title><p>That page is not here. <a href="/">Go home</a></p>`);
    }
    // The bad site: a soft 404 SPA fallback, noindex, a robots file that blocks everyone, and more.
    if (path === "/") return send(200, badHome);
    if (path === "/huge.jpg") return send(200, Buffer.alloc(600 * 1024, 1), "image/jpeg");
    if (path === "/ok.png") return send(200, PNG, "image/png");
    if (path === "/about") return send(200, "<title>About</title>");
    if (path === "/robots.txt") return send(200, "User-agent: *\nDisallow: /\n", "text/plain");
    if (path === "/sitemap.xml") return send(200, `<urlset><url><loc>https://another-host.test/</loc></url></urlset>`, "application/xml");
    if (path === "/gone" || path.endsWith(".png")) return send(404, "Not found", "text/plain");
    return send(200, badHome); // everything else falls back to the home page
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) })));
}
