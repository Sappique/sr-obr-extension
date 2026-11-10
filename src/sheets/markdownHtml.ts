/**
 * Markdown → HTML for sheet sections, in the vector-window look: headings with a
 * line (H1–H3), diamond bullets, task lists, ~~strike~~, quotes and [!Type] callouts.
 */
export const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function inline(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

const LIST = /^\s*([-*+]|\d+\.)\s+/;

export function markdownToHtml(src: string): string {
  const L = src.split("\n");
  let out = "";
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    let m: RegExpMatchArray | null;
    if (!l.trim()) {
      i++;
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*)/))) {
      const n = m[1].length;
      out += `<h${n}>${inline(m[2])}</h${n}>`;
      i++;
      continue;
    }
    if (l.startsWith(">")) {
      const q: string[] = [];
      while (i < L.length && L[i].startsWith(">")) q.push(L[i++].replace(/^>\s?/, ""));
      const cm = q[0].match(/^\[!([\w-]+)\]\s*(.*)/);
      out += cm
        ? `<div class="co co-${cm[1].toLowerCase()}"><div class="co-h"><span class="co-l">${esc(cm[1])}</span>${cm[2] ? `<span class="co-t">${inline(cm[2])}</span>` : ""}</div>${q.length > 1 ? `<div class="co-b">${markdownToHtml(q.slice(1).join("\n"))}</div>` : ""}</div>`
        : `<blockquote>${markdownToHtml(q.join("\n"))}</blockquote>`;
      continue;
    }
    if (LIST.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < L.length && LIST.test(L[i])) items.push(L[i++].replace(LIST, ""));
      out +=
        `<${ordered ? "ol" : "ul"}>` +
        items
          .map((t) => {
            const tm = t.match(/^\[( |x|X)\]\s+(.*)/);
            return tm
              ? `<li class="task${tm[1] !== " " ? " done" : ""}"><i class="box"></i>${inline(tm[2])}</li>`
              : `<li>${inline(t)}</li>`;
          })
          .join("") +
        `</${ordered ? "ol" : "ul"}>`;
      continue;
    }
    const p: string[] = [];
    while (i < L.length && L[i].trim() && !/^(#{1,6}\s|>)/.test(L[i]) && !LIST.test(L[i])) p.push(L[i++]);
    out += `<p>${inline(p.join(" "))}</p>`;
  }
  return out;
}
