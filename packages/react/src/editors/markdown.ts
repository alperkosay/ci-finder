import { escapeHtml, langOf, toLines, tokenize } from "./highlight";

/**
 * Minimal CommonMark-ish renderer for the preview pane. Raw HTML is escaped (never rendered) and
 * link/image URLs are restricted to safe schemes, so previewing an untrusted file is harmless.
 */

/** `url` comes from already-escaped text; only the scheme needs checking. */
function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return "#";
}

function inline(text: string): string {
  // Protect code spans first so their content is not formatted.
  const codes: string[] = [];
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code: string) => {
    codes.push(`<code>${escapeHtml(code.trim())}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) => `<img src="${safeUrl(src)}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy">`,
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, label, href, title) => `<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ""}>${label}</a>`,
  );
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)|(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, (_, p1, a, p3, b) => `${p1 ?? p3 ?? ""}<em>${a ?? b}</em>`);
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/ {2,}$/gm, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]!);
}

function table(lines: string[]): string {
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const head = cells(lines[0]!);
  const aligns = cells(lines[1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
  const style = (i: number) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : "");
  const body = lines.slice(2).map(
    (l) =>
      `<tr>${cells(l)
        .map((c, i) => `<td${style(i)}>${inline(c)}</td>`)
        .join("")}</tr>`,
  );
  return `<table><thead><tr>${head.map((c, i) => `<th${style(i)}>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.join("")}</tbody></table>`;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const isBlockStart = (l: string) => /^\s*(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|([-*_])(\s*\2){2,}\s*$)/.test(l) || /^\s*\|.*\|\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      const lang = fence[2] ? langOf(`x.${fence[2]}`) : "plain";
      const html = toLines(tokenize(body.join("\n"), lang)).join("\n");
      out.push(`<pre class="cf-md-code"><code>${html}</code></pre>`);
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(body.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(lines[i++]!);
      out.push(table(rows));
      continue;
    }

    const li = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m) {
          // continuation lines are indented
          if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length) {
            items[items.length - 1] += " " + lines[i]!.trim();
            i++;
            continue;
          }
          break;
        }
        items.push(m[3]!);
        i++;
      }
      const html = items
        .map((it) => {
          const task = /^\[([ xX])\]\s+(.*)$/.exec(it);
          if (task) return `<li class="is-task"><input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ${inline(task[2]!)}</li>`;
          return `<li>${inline(it)}</li>`;
        })
        .join("");
      out.push(ordered ? `<ol>${html}</ol>` : `<ul>${html}</ul>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && (para.length === 0 || !isBlockStart(lines[i]!))) para.push(lines[i++]!);
    out.push(`<p>${inline(para.join("\n"))}</p>`);
  }
  return out.join("\n");
}
