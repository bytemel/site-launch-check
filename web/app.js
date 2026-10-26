// Site Launch Check web front end. / runs a check, /r/<id> shows a saved report.
const $ = (id) => document.getElementById(id);
const parts = location.pathname.split("/").filter(Boolean);
const reportId = parts[0] === "r" ? parts[1] : "";
const ICON = {
  PASS: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  WARN: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l7 12.5H1z" fill="currentColor"/><path d="M8 6v3.6M8 11.6v.1" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  FAIL: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  SKIP: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const LABEL = { PASS: "Pass", WARN: "Warn", FAIL: "Fail", SKIP: "Skip" };
let shareUrl = "";

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null && k !== false));
  return node;
}
const badge = (status) => {
  const span = el("span", { className: `st st-${status}` });
  span.innerHTML = ICON[status]; // static SVG strings defined above, no user data
  span.append(LABEL[status]);
  return span;
};
function status(message, kind = "", busy = false) {
  $("status").hidden = !message;
  $("status").replaceChildren(...(busy ? [el("span", { className: "busy", ariaHidden: "true" })] : []), message || "");
  $("status").className = `notice ${kind}`;
}

function show(data) {
  const r = data.report;
  status("");
  $("report").hidden = false;
  $("report-h").textContent = new URL(r.finalUrl).host;
  $("report-sub").textContent = `${r.finalUrl}${r.finalUrl !== r.url ? ` (from ${r.url})` : ""}. Checked ${data.checkedAt ? new Date(data.checkedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "just now"}.`;
  $("tally").replaceChildren(...["FAIL", "WARN", "PASS", "SKIP"].filter((s) => data.counts[s]).map((s) => el("span", { className: "pill" }, badge(s), String(data.counts[s]))));
  const order = { FAIL: 0, WARN: 1, PASS: 2, SKIP: 3 };
  const sorted = [...r.results].sort((a, b) => order[a.status] - order[b.status] || a.n - b.n);
  $("checks").replaceChildren(...sorted.map((x) => el("li", { className: "check" },
    el("div", { className: "check-top" }, badge(x.status), el("span", { className: "check-name", textContent: `${x.n}. ${x.check}` }), el("span", { className: "check-detail", textContent: x.detail })),
    (x.status === "WARN" || x.status === "FAIL") && x.items.filter((i) => i !== x.detail).length ? el("ul", {}, ...x.items.filter((i) => i !== x.detail).map((i) => el("li", { textContent: i }))) : null)));
  shareUrl = `${location.origin}/r/${data.id}`;
  document.title = `${new URL(r.finalUrl).host}: ${data.counts.FAIL} fail, ${data.counts.WARN} warn | Site Launch Check`;
}

async function call(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({ ok: false, message: res.status === 504 ? "That site took too long to answer." : "The server did not answer properly." }));
  if (!res.ok || data.ok === false) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

$("run").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  $("go").disabled = true;
  $("report").hidden = true;
  status(`Checking ${url}. This takes 10 to 40 seconds: it loads the page, robots.txt, the sitemap, images and up to 30 links.`, "", true);
  try {
    const data = await call("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    show(data);
    history.pushState(null, "", `/r/${data.id}`);
  } catch (err) {
    status(err.message, "notice-alert");
  } finally {
    $("go").disabled = false;
  }
});
document.addEventListener("click", (e) => {
  const t = e.target.dataset?.try;
  if (t) { $("url").value = t; $("run").requestSubmit(); }
});
$("share").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText(shareUrl); e.target.textContent = "Copied"; } catch { window.prompt("Copy this link", shareUrl); }
  setTimeout(() => { e.target.textContent = "Copy share link"; }, 1500);
});

if (reportId) {
  status("Loading the report.", "", true);
  call(`/api/report?id=${encodeURIComponent(reportId)}`).then(show).catch((e) => status(e.message, "notice-alert"));
}
