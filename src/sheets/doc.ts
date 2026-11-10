/**
 * A sheet's body is one Markdown document (`Sheet.doc`), edited in one box:
 *
 *   <!-- name -->            the name block (label/value list)
 *   <!-- skills -->          Fertigkeiten with dice and roll targets
 *   ## Bodytech
 *   - …
 *   <!-- column -->          starts the next column (columns share the width equally)
 *   ## Ausrüstung
 *   - …
 *   <!-- nuyen -->           the nuyen readout (GM: ± buttons)
 *
 * A structured part whose placeholder is missing still appears: name and skills at the
 * start of the first column, nuyen at the end of the last. A repeated placeholder only
 * counts once; other HTML comments are ignored. No runtime imports, so node's test
 * runner can load this file directly.
 */

export type Part = "name" | "skills" | "nuyen";
export type Block = { kind: "md"; src: string } | { kind: Part };
export type Column = Block[];

const COLUMN = /^\s*<!--\s*column\s*-->\s*$/i;
const PLACEHOLDER = /^\s*<!--\s*(name|skills|nuyen)\s*-->\s*$/i;
const COMMENT = /^\s*<!--.*-->\s*$/;

/** Which structured parts this sheet has (the shared sheet has no name block or skills). */
export interface Parts {
  name: boolean;
  skills: boolean;
  nuyen: boolean;
}

export function parseDoc(doc: string, has: Parts): Column[] {
  const cols: Column[] = [[]];
  const seen = new Set<Part>();
  let md: string[] = [];
  const flush = () => {
    const src = md.join("\n").replace(/^\n+|\n+$/g, "");
    if (src.trim()) cols[cols.length - 1].push({ kind: "md", src });
    md = [];
  };
  for (const line of doc.replace(/\r\n?/g, "\n").split("\n")) {
    if (COLUMN.test(line)) {
      flush();
      cols.push([]);
      continue;
    }
    const m = line.match(PLACEHOLDER);
    if (m) {
      flush();
      const kind = m[1].toLowerCase() as Part;
      if (has[kind] && !seen.has(kind)) cols[cols.length - 1].push({ kind });
      seen.add(kind);
      continue;
    }
    if (COMMENT.test(line)) continue;
    md.push(line);
  }
  flush();
  // Missing structured parts go to their default spots, so nothing gets lost.
  const lead: Block[] = [];
  if (has.name && !seen.has("name")) lead.push({ kind: "name" });
  if (has.skills && !seen.has("skills")) lead.push({ kind: "skills" });
  cols[0].unshift(...lead);
  if (has.nuyen && !seen.has("nuyen")) cols[cols.length - 1].push({ kind: "nuyen" });
  return cols;
}

// ---------- migration from the old per-section model ----------

/** Height estimate the old sidebar used to fill its columns (keeps today's layout). */
const estimate = (src: string) => src.split("\n").reduce((a, l) => a + Math.ceil(Math.max(1, l.length) / 40), 0) * 24 + 40;
const isGear = (src: string) => /^## Ausrüstung\b/m.test(src);

/**
 * "## Lebensstil" used to hold a callout box; turn callouts in it into a plain list:
 *   > [!Wohnort] Harrow Ost            - **Wohnort:** Harrow Ost
 *   > Ausgaben **50 ¥** · Miete **3k**  - **Ausgaben:** 50 ¥
 *                                       - **Miete:** 3k
 */
export function plainLifestyle(src: string): string {
  if (!/^## Lebensstil\b/m.test(src)) return src;
  return src
    .split("\n")
    .flatMap((line) => {
      const head = line.match(/^>\s*\[!([\w-]+)\]\s*(.*)$/);
      if (head) return [head[2] ? `- **${head[1]}:** ${head[2]}` : `- **${head[1]}**`];
      if (!line.startsWith(">")) return [line];
      const body = line.replace(/^>\s?/, "").trim();
      if (!body) return [];
      // "Label **value** · Label **value**" pairs become one item each.
      const pairs = [...body.matchAll(/([^·*]+?)\s*\*\*(.+?)\*\*/g)];
      if (pairs.length && pairs.map((p) => p[0]).join("").replace(/[\s·]/g, "") === body.replace(/[\s·]/g, ""))
        return pairs.map((p) => `- **${p[1].trim()}:** ${p[2].trim()}`);
      return [`- ${body}`];
    })
    .join("\n");
}

/**
 * Builds a document that reproduces the old layout: runner sheets had name + skills in
 * the first column and their sections spread over two more (shortest column first);
 * the shared sheet spread its sections over up to three. Nuyen followed "## Ausrüstung"
 * (or closed the last column when there was none).
 */
export function docFromSections(sections: string[], shared: boolean): string {
  const n = shared ? Math.max(1, Math.min(3, sections.length)) : 2;
  const cols = Array.from({ length: n }, () => ({ h: 0, parts: [] as string[] }));
  for (const old of sections) {
    const src = plainLifestyle(old);
    const c = cols.reduce((a, b) => (b.h < a.h ? b : a));
    c.parts.push(isGear(src) ? `${src}\n\n<!-- nuyen -->` : src);
    c.h += estimate(old); // the old text decides the column, as it did before
  }
  if (!sections.some(isGear)) cols[cols.length - 1].parts.push("<!-- nuyen -->");
  const body = cols.map((c) => c.parts.join("\n\n"));
  const all = shared ? body : ["<!-- name -->\n\n<!-- skills -->", ...body];
  return all.join("\n\n<!-- column -->\n\n") + "\n";
}
