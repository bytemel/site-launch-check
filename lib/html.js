// A tiny HTML tokenizer: enough to read start tags, their attributes, and the text of
// <title>, <script> and <style>. It skips comments, doctype and end tags, and it does not
// build a tree. That is all a launch check needs, with no dependencies.

const RAW_TEXT = new Set(["script", "style", "title", "textarea"]);
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const isSpace = (c) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

// Returns [{ name, attrs: { lowercased name: decoded value }, text? }] in document order.
export function tokenize(html) {
  const src = String(html ?? "");
  const lower = src.toLowerCase();
  const tags = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    const next = src[lt + 1];
    if (next === "!" || next === "?" || next === "/") {
      const end = src.indexOf(">", lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    const m = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(src.slice(lt + 1, lt + 65));
    if (!m) { i = lt + 1; continue; }
    const name = m[0].toLowerCase();
    const attrs = {};
    let j = lt + 1 + m[0].length;
    while (j < src.length) {
      while (j < src.length && (isSpace(src[j]) || src[j] === "/")) j++;
      if (j >= src.length || src[j] === ">") break;
      let k = j;
      while (k < src.length && !isSpace(src[k]) && src[k] !== "/" && src[k] !== ">" && src[k] !== "=") k++;
      const attrName = src.slice(j, k).toLowerCase();
      j = k;
      while (j < src.length && isSpace(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (j < src.length && isSpace(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const close = src.indexOf(q, j + 1);
          const end = close === -1 ? src.length : close;
          value = src.slice(j + 1, end);
          j = end + 1;
        } else {
          let e = j;
          while (e < src.length && !isSpace(src[e]) && src[e] !== ">") e++;
          value = src.slice(j, e);
          j = e;
        }
      }
      if (attrName && !(attrName in attrs)) attrs[attrName] = decodeEntities(value);
    }
    const tag = { name, attrs };
    tags.push(tag);
    i = j + 1;
    if (RAW_TEXT.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      const end = close === -1 ? src.length : close;
      tag.text = name === "title" || name === "textarea" ? decodeEntities(src.slice(i, end)) : src.slice(i, end);
      i = end;
    }
  }
  return tags;
}

// Convenience view over the tags for the checks.
export function parsePage(html) {
  const tags = tokenize(html);
  const all = (name) => tags.filter((t) => t.name === name);
  const first = (name) => tags.find((t) => t.name === name);
  const meta = (key) => {
    const k = key.toLowerCase();
    const t = tags.find((x) => x.name === "meta" && ((x.attrs.name || "").toLowerCase() === k || (x.attrs.property || "").toLowerCase() === k));
    return t ? (t.attrs.content ?? "").trim() : null;
  };
  const links = (rel) => all("link").filter((l) => (l.attrs.rel || "").toLowerCase().split(/\s+/).includes(rel));
  return {
    tags, all, first, meta, links,
    title: (first("title")?.text ?? "").replace(/\s+/g, " ").trim(),
    lang: first("html")?.attrs.lang ?? null,
  };
}
