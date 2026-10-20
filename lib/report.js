// Plain text table for people, JSON for scripts and CI.
export function counts(results) {
  return results.reduce((a, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 });
}

export function formatText(report, { color = false } = {}) {
  const paint = { PASS: "32", WARN: "33", FAIL: "31", SKIP: "90" };
  const tint = (s, status) => (color ? `\u001b[${paint[status]}m${s}\u001b[0m` : s);
  const c = counts(report.results);
  const width = Math.max(...report.results.map((x) => x.check.length));
  const lines = [
    `Site launch check: ${report.finalUrl}${report.finalUrl !== report.url ? `  (from ${report.url})` : ""}  ${report.date}`,
    `PASS ${c.PASS}  WARN ${c.WARN}  FAIL ${c.FAIL}${c.SKIP ? `  SKIP ${c.SKIP}` : ""}`,
    "",
  ];
  for (const x of report.results) {
    lines.push(`${String(x.n).padStart(2)}  ${tint(x.status.padEnd(4), x.status)}  ${x.check.padEnd(width)}  ${x.detail}`);
    if (x.status === "WARN" || x.status === "FAIL") {
      for (const it of x.items) if (it !== x.detail) lines.push(`${" ".repeat(width + 12)}- ${it}`);
    }
  }
  return lines.join("\n");
}
