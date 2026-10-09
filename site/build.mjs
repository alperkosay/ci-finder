// Builds the GitHub Pages site into site/dist.
//
//   node site/build.mjs           build
//   node site/build.mjs --serve   build and serve on http://localhost:4173
//
// The docs pages are generated from README.md / README.tr.md and docs/api/**/*.md, so the markdown
// stays the single source. English docs go to /docs/, Turkish ones to /docs/tr/. The live demo bundles the real @ci-finder/core and @ci-finder/react packages,
// so run `npm run build` first.

import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const site = dirname(fileURLToPath(import.meta.url));
const repo = join(site, "..");
const out = join(site, "dist");
const GITHUB = "https://github.com/alperkosay/ci-finder";

// Syntax highlighting reuses the editor's own tokenizer from @ci-finder/react.
const { outputFiles } = await esbuild.build({
  entryPoints: [join(repo, "packages/react/src/editors/highlight.ts")],
  bundle: true,
  format: "esm",
  write: false,
});
const { tokenize, toLines, escapeHtml } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

// ---------------------------------------------------------------------------------------------
// Docs: which markdown file becomes which page

const LANGS = [
  {
    code: "en",
    dir: "docs",
    readme: "README.md",
    api: "docs/api",
    from: "## Installation",
    home: "",
    anchors: { overview: "overview", compare: "elfinder" },
    t: {
      guide: "Guide",
      api: "API reference",
      start: "Getting started",
      overview: "Overview",
      protocol: "HTTP protocol",
      prev: "Previous",
      next: "Next",
      generated: (link) => `This page is generated from ${link}.`,
      docs: "ciFinder docs",
      anchor: "Link to this heading",
      home: "ciFinder home",
      navOverview: "Overview",
      navCompare: "Compared to elFinder",
      navDocs: "Docs",
      navDemo: "Open demo",
      docsNav: "Documentation",
      language: "Language",
    },
  },
  {
    code: "tr",
    dir: "docs/tr",
    readme: "README.tr.md",
    api: "docs/api/tr",
    from: "## Kurulum",
    home: "tr/",
    anchors: { overview: "genel-bakis", compare: "elfinder" },
    t: {
      guide: "Kılavuz",
      api: "API referansı",
      start: "Başlarken",
      overview: "Genel bakış",
      protocol: "HTTP protokolü",
      prev: "Önceki",
      next: "Sonraki",
      generated: (link) => `Bu sayfa ${link} dosyasından üretildi.`,
      docs: "ciFinder belgeleri",
      anchor: "Bu başlığa bağlantı",
      home: "ciFinder ana sayfa",
      navOverview: "Genel bakış",
      navCompare: "elFinder ile karşılaştırma",
      navDocs: "Belgeler",
      navDemo: "Demoyu aç",
      docsNav: "Belgeler",
      language: "Dil",
    },
  },
];

const pages = LANGS.flatMap((lang) => {
  const { t } = lang;
  const api = (name, title, code = false) => ({ file: `${lang.api}/${name}.md`, out: `${name === "README" ? "api" : name}.html`, group: t.api, title, code });
  return [
    { file: lang.readme, out: "index.html", group: t.guide, title: t.start, from: lang.from },
    api("README", t.overview),
    api("protocol", t.protocol),
    api("core", "core", true),
    api("client", "core/client", true),
    api("next", "next", true),
    api("react", "react", true),
    api("ckeditor", "ckeditor", true),
  ].map((page) => ({ ...page, lang }));
});
const pageOf = new Map(pages.map((p) => [p.file, p]));

/** Href of `to` as seen from the page `from`; the two may be in different languages. */
const pageHref = (from, to) => (from.lang === to.lang ? to.out : posix.join(posix.relative(from.lang.dir, to.lang.dir), to.out));

/** Rewrites a markdown link: other docs become site pages, everything else in the repo goes to GitHub. */
function resolveHref(href, from) {
  if (/^([a-z]+:|#)/i.test(href)) return href;
  const [path, hash] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(from.file), path));
  const page = pageOf.get(target);
  if (page) return pageHref(from, page) + (hash ? `#${hash}` : "");
  const kind = extname(target) ? "blob" : "tree";
  return `${GITHUB}/${kind}/main/${target}${hash ? `#${hash}` : ""}`;
}

/** GitHub's heading slug: lower case, punctuation dropped (Unicode letters kept), spaces to hyphens. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Plain text of an inline markdown string (for slugs and the table of contents). */
const plainText = (s) =>
  s
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1");

function inline(text, ctx) {
  const parked = [];
  const park = (html) => `\u0000${parked.push(html) - 1}\u0000`;
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => park(`<code>${escapeHtml(code.trim())}</code>`));
  s = s.replace(/\\\|/g, "|");
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => park(`<img src="${resolveHref(src, ctx.page)}" alt="${alt}" loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const url = resolveHref(href.replace(/&amp;/g, "&"), ctx.page);
    const external = /^https?:/.test(url) ? ' rel="noopener"' : "";
    return park(`<a href="${escapeHtml(url)}"${external}>`) + label + park("</a>");
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => parked[Number(i)]);
}

const FENCE_LANG = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  json: "json",
  css: "css",
  html: "html",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  yaml: "yaml",
  yml: "yaml",
};

function codeBlock(code, lang) {
  const html = toLines(tokenize(code, FENCE_LANG[lang] ?? "plain")).join("\n");
  return `<pre${lang ? ` data-lang="${lang}"` : ""}><code>${html}</code></pre>`;
}

const indentOf = (line) => line.match(/^ */)[0].length;
const LIST = /^( *)([-*+]|\d+\.) +/;
const isBlockStart = (line) => /^ *(```|~~~|#{1,6} |> ?|\|)/.test(line) || LIST.test(line);

function splitRow(line) {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/);
  return cells.map((c) => c.trim());
}

function blocks(src, ctx) {
  const lines = src.split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^( *)(```+|~~~+) *([\w-]*)/);
    if (fence) {
      const [, pad, mark, lang] = fence;
      const body = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(mark); i++) body.push(lines[i].slice(Math.min(pad.length, indentOf(lines[i]))));
      i++;
      html.push(codeBlock(body.join("\n"), lang));
      continue;
    }

    const heading = line.match(/^(#{1,6}) +(.*?) *#*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        ctx.title ??= text;
        html.push(`<h1>${inline(text, ctx)}</h1>`);
      } else {
        const id = ctx.slug(plainText(text));
        if (level === 2) ctx.toc.push({ id, text: plainText(text) });
        html.push(
          `<h${level} id="${escapeHtml(id)}">${inline(text, ctx)}<a class="anchor" href="#${escapeHtml(id)}" aria-label="${ctx.page.lang.t.anchor}">#</a></h${level}>`,
        );
      }
      i++;
      continue;
    }

    if (/^ *(-{3,}|\*{3,}) *$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }

    if (line.trim().startsWith("|") && /^ *\|? *:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(splitRow(lines[i]));
      const th = head.map((c) => `<th>${inline(c, ctx)}</th>`).join("");
      const tb = rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "", ctx)}</td>`).join("")}</tr>`).join("\n");
      html.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>\n${tb}\n</tbody></table></div>`);
      continue;
    }

    if (/^ *> ?/.test(line)) {
      const body = [];
      for (; i < lines.length && /^ *> ?/.test(lines[i]); i++) body.push(lines[i].replace(/^ *> ?/, ""));
      html.push(`<blockquote>${blocks(body.join("\n"), ctx)}</blockquote>`);
      continue;
    }

    const list = line.match(LIST);
    if (list) {
      const base = list[1].length;
      const ordered = /\d/.test(list[2]);
      const items = [];
      let tight = true;
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
        const width = m[0].length;
        const body = [lines[i].slice(width)];
        for (i++; i < lines.length; i++) {
          const l = lines[i];
          if (!l.trim()) {
            const next = lines.slice(i + 1).find((x) => x.trim());
            if (next !== undefined && indentOf(next) > base) {
              tight = false;
              body.push("");
              continue;
            }
            break;
          }
          if (indentOf(l) > base) body.push(l.slice(Math.min(width, indentOf(l))));
          else if (!isBlockStart(l)) body.push(l.trim());
          else break;
        }
        items.push(body.join("\n"));
        if (!lines[i]?.trim()) {
          const next = lines.slice(i).findIndex((x) => x.trim());
          const m2 = next >= 0 && lines[i + next].match(LIST);
          if (m2 && m2[1].length === base) {
            tight = false;
            i += next;
          }
        }
      }
      const tag = ordered ? "ol" : "ul";
      const lis = items.map((body) => {
        let inner = blocks(body, ctx);
        if (tight) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
        return `<li>${inner}</li>`;
      });
      html.push(`<${tag}>\n${lis.join("\n")}\n</${tag}>`);
      continue;
    }

    const para = [];
    for (; i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i])); i++) para.push(lines[i].trim());
    html.push(`<p>${inline(para.join("\n"), ctx)}</p>`);
  }
  return html.join("\n");
}

function renderMarkdown(src, page) {
  const ctx = { page, slug: slugger(), toc: [], title: undefined };
  const html = blocks(src.replace(/\r\n/g, "\n"), ctx);
  return { html, toc: ctx.toc, title: ctx.title };
}

// ---------------------------------------------------------------------------------------------
// Docs template

/** EN / TR switch; each language links to the same page in that language. */
const langSwitch = (page, twin) => {
  const links = [page, twin]
    .sort((a, b) => LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang))
    .map((p) => {
      const here = p === page;
      return `<a href="${here ? p.out : pageHref(page, p)}" hreflang="${p.lang.code}" lang="${p.lang.code}"${here ? ' aria-current="true"' : ""}>${p.lang.code.toUpperCase()}</a>`;
    });
  return `<div class="langs" role="group" aria-label="${page.lang.t.language}">${links.join("")}</div>`;
};

const nav = (prefix, page, twin) => {
  const { t, home, anchors } = page.lang;
  const demo = `${prefix}demo/?lang=${page.lang.code}`;
  return `<nav class="localnav" aria-label="Site">
      <div class="localnav-in">
        <a class="wordmark" href="${prefix}${home}" aria-label="${t.home}"><span>ci</span>Finder</a>
        <div class="localnav-links">
          <a href="${prefix}${home}#${anchors.overview}">${t.navOverview}</a>
          <a href="${prefix}${home}#${anchors.compare}">${t.navCompare}</a>
          <a href="${prefix}${page.lang.dir}/" aria-current="page">${t.navDocs}</a>
          <a href="${GITHUB}">GitHub</a>
          ${langSwitch(page, twin)}
          <a class="pill pill-sm" href="${demo}">${t.navDemo}</a>
        </div>
      </div>
    </nav>`;
};

function sidebar(current, toc) {
  const own = pages.filter((p) => p.lang === current.lang);
  const groups = [...new Set(own.map((p) => p.group))];
  return groups
    .map((group) => {
      const items = own
        .filter((p) => p.group === group)
        .map((p) => {
          const label = p.code ? `<code>${p.title}</code>` : p.title;
          const here = p === current;
          const sub =
            here && toc.length ? `<ul class="toc">${toc.map((t) => `<li><a href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a></li>`).join("")}</ul>` : "";
          return `<li><a href="${p.out}"${here ? ' aria-current="page"' : ""}>${label}</a>${sub}</li>`;
        })
        .join("");
      return `<h2>${group}</h2><ul>${items}</ul>`;
    })
    .join("");
}

function docPage(page, { html, toc, title }) {
  const { lang } = page;
  const own = pages.filter((p) => p.lang === lang);
  const index = own.indexOf(page);
  const prev = own[index - 1];
  const next = own[index + 1];
  const twin = pages.find((p) => p.lang !== lang && p.out === page.out);
  const root = posix.relative(lang.dir, ".") + "/";
  const plainTitle = plainText(title ?? page.title);
  return `<!doctype html>
<html lang="${lang.code}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(plainTitle)} · ${lang.t.docs}</title>
    <link rel="alternate" hreflang="${twin.lang.code}" href="${pageHref(page, twin)}" />
    <link rel="icon" href="${root}icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${root}assets/site.css" />
  </head>
  <body>
    ${nav(root, page, twin)}
    <div class="docs">
      <aside class="docs-side">
        <button type="button" class="docs-menu" aria-expanded="false">${escapeHtml(page.title)}</button>
        <nav aria-label="${lang.t.docsNav}">${sidebar(page, toc)}</nav>
      </aside>
      <main class="doc">
        <p class="doc-kicker">${page.group}</p>
        ${html}
        <div class="doc-pager">
          ${prev ? `<a class="prev" href="${prev.out}"><span>${lang.t.prev}</span>${escapeHtml(prev.title)}</a>` : ""}
          ${next ? `<a class="next" href="${next.out}"><span>${lang.t.next}</span>${escapeHtml(next.title)}</a>` : ""}
        </div>
        <p class="doc-edit">${lang.t.generated(`<a href="${GITHUB}/blob/main/${page.file}">${page.file}</a>`)}</p>
      </main>
    </div>
    <script src="${root}assets/site.js" defer></script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// Build

async function build() {
  const started = Date.now();
  await rm(out, { recursive: true, force: true });
  for (const lang of LANGS) await mkdir(join(out, lang.dir), { recursive: true });

  await cp(join(site, "pages"), out, { recursive: true });
  await cp(join(site, "assets"), join(out, "assets"), { recursive: true });
  await cp(join(repo, "docs/media"), join(out, "media"), { recursive: true });
  await cp(join(repo, "examples/next/app/icon.svg"), join(out, "icon.svg"));
  await writeFile(join(out, ".nojekyll"), "");

  for (const page of pages) {
    // The "🌐 English · Türkçe" line is for GitHub readers; the site has its own language switch.
    let src = (await readFile(join(repo, page.file), "utf8")).replace(/^🌐 .*\r?\n/mu, "");
    if (page.from) {
      const start = src.indexOf(page.from);
      if (start < 0) throw new Error(`${page.file}: "${page.from}" not found`);
      src = `# ${page.title}\n\n${src.slice(start)}`;
    }
    const doc = renderMarkdown(src, page);
    await writeFile(join(out, page.lang.dir, page.out), docPage(page, doc));
  }

  await mkdir(join(out, "demo"), { recursive: true });
  await cp(join(site, "demo/index.html"), join(out, "demo/index.html"));
  await cp(join(site, "demo/sw.js"), join(out, "demo/sw.js"));
  await esbuild.build({
    entryPoints: { main: join(site, "demo/main.tsx") },
    outdir: join(out, "demo"),
    bundle: true,
    format: "esm",
    minify: true,
    target: ["es2022"],
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "none",
    logLevel: "warning",
    // tsup leaves bare imports of pure chunks behind; dropping them is correct.
    logOverride: { "ignored-bare-import": "silent" },
  });

  console.log(`site built in ${Date.now() - started} ms → ${relative(process.cwd(), out) || "."}`);
}

await build();

// ---------------------------------------------------------------------------------------------
// Local preview (service workers need http://localhost, file:// will not do)

if (process.argv.includes("--serve")) {
  const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".mp4": "video/mp4",
  };
  const port = Number(process.env.PORT ?? 4173);
  createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    if (path.includes("..")) return res.writeHead(400).end();
    let file = join(out, path);
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, "index.html");
    else if (!info) return res.writeHead(404).end("Not found");
    const size = (await stat(file).catch(() => null))?.size;
    if (size === undefined) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": size, "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`serving on http://localhost:${port}`));
}
