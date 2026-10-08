/**
 * Small, dependency-free syntax highlighter. It is a single-pass scanner per language family that
 * produces tokens; the editor renders them line by line so it can show line numbers and the
 * active line. Accuracy is "good editor tint", not a full parser.
 */

export type Lang = "js" | "json" | "css" | "html" | "md" | "py" | "php" | "sql" | "yaml" | "sh" | "clike" | "ruby" | "ini" | "plain";

export type TokenType = "kw" | "str" | "com" | "num" | "fn" | "type" | "prop" | "tag" | "attr" | "op" | "const" | "var" | "meta" | "head" | "bold" | "em" | "link" | "code";

export interface Token {
  t?: TokenType;
  v: string;
}

const EXT_LANG: Record<string, Lang> = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", mts: "js", cts: "js", tsx: "js",
  json: "json", jsonc: "json", webmanifest: "json",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html", svelte: "html",
  md: "md", markdown: "md",
  py: "py",
  php: "php",
  sql: "sql",
  yml: "yaml", yaml: "yaml",
  sh: "sh", bash: "sh", zsh: "sh", env: "sh",
  c: "clike", h: "clike", cpp: "clike", hpp: "clike", cs: "clike", java: "clike", kt: "clike", go: "clike", rs: "clike", swift: "clike", graphql: "clike",
  rb: "ruby",
  ini: "ini", toml: "ini", conf: "ini", properties: "ini",
};

export const LANG_LABEL: Record<Lang, string> = {
  js: "JavaScript", json: "JSON", css: "CSS", html: "HTML", md: "Markdown", py: "Python", php: "PHP", sql: "SQL",
  yaml: "YAML", sh: "Shell", clike: "C-like", ruby: "Ruby", ini: "INI", plain: "Plain text",
};

export function langOf(name: string): Lang {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return "sh";
  if (lower.startsWith(".env")) return "sh";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (ext === "ts" || ext === "tsx") return "js";
  return EXT_LANG[ext] ?? "plain";
}

const words = (s: string) => new Set(s.split(" "));

const JS_KW = words("break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await as interface type enum implements private protected public readonly declare namespace abstract satisfies keyof infer is get set");
const JS_LIT = words("true false null undefined NaN Infinity");
const PY_KW = words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls");
const PY_LIT = words("True False None");
const PHP_KW = words("abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield enum");
const PHP_LIT = words("true false null TRUE FALSE NULL");
const SQL_KW = words("select from where and or not insert into values update set delete create table drop alter add column index primary key foreign references join left right inner outer full on as group by order having limit offset union all distinct case when then else end is null in like between exists default constraint unique check view trigger begin commit rollback transaction with returning asc desc cascade if replace database schema grant revoke");
const SQL_TYPES = words("int integer bigint smallint serial bigserial varchar char text boolean bool date time timestamp timestamptz numeric decimal float real double json jsonb uuid blob bytea");
const SH_KW = words("if then else elif fi for while until do done case esac function in return export local readonly declare unset shift source alias echo exit set cd FROM RUN CMD ENTRYPOINT COPY ADD ENV ARG WORKDIR EXPOSE USER VOLUME LABEL");
const CLIKE_KW = words("auto break case catch char class const continue default delete do double else enum explicit extern float for friend goto if inline int long mutable namespace new operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while bool abstract assert boolean byte extends final finally implements import instanceof interface native package super synchronized throws transient func go chan defer fallthrough map range select type var fn let mut impl pub use mod crate trait where match loop move ref self Self dyn async await override sealed val fun when object companion is in out internal lateinit init guard struct protocol extension");
const CLIKE_LIT = words("true false null nullptr nil None");
const RUBY_KW = words("alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_accessor attr_reader private protected public");
const RUBY_LIT = words("true false nil");

interface Spec {
  line?: string[];
  block?: [string, string][];
  quotes: string;
  multiline?: string;
  kw: Set<string>;
  lit?: Set<string>;
  types?: Set<string>;
  ci?: boolean;
  vars?: RegExp;
  decorators?: boolean;
  capsAreTypes?: boolean;
}

const SPECS: Partial<Record<Lang, Spec>> = {
  js: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", multiline: "`", kw: JS_KW, lit: JS_LIT, decorators: true, capsAreTypes: true },
  py: { line: ["#"], quotes: "\"'", kw: PY_KW, lit: PY_LIT, decorators: true, capsAreTypes: true },
  php: { line: ["//", "#"], block: [["/*", "*/"]], quotes: "\"'", multiline: "\"'", kw: PHP_KW, lit: PHP_LIT, vars: /\$[A-Za-z_]\w*/y, capsAreTypes: true },
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: "'\"`", kw: SQL_KW, types: SQL_TYPES, ci: true },
  sh: { line: ["#"], quotes: "\"'", multiline: "\"'", kw: SH_KW, vars: /\$\{?[A-Za-z_][\w]*\}?|\$[0-9@#?*$!-]/y },
  clike: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", multiline: "`", kw: CLIKE_KW, lit: CLIKE_LIT, decorators: true, capsAreTypes: true },
  ruby: { line: ["#"], quotes: "\"'", kw: RUBY_KW, lit: RUBY_LIT, vars: /[@$][A-Za-z_]\w*|:[A-Za-z_]\w*/y, capsAreTypes: true },
};

const IDENT = /[A-Za-z_$À-￿][\w$À-￿]*/y;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[a-zA-Z%]*/y;
const OPS = "=+-*/%<>!&|^~?:";

function match(re: RegExp, s: string, i: number): string | null {
  re.lastIndex = i;
  const m = re.exec(s);
  return m ? m[0] : null;
}

function scanString(s: string, i: number, q: string, multiline: boolean): number {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j]!;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    if (c === "\n" && !multiline) return j;
    j++;
  }
  return j;
}

function scanGeneric(s: string, spec: Spec): Token[] {
  const out: Token[] = [];
  let plain = "";
  const push = (t: TokenType | undefined, v: string) => {
    if (!t) {
      plain += v;
      return;
    }
    if (plain) out.push({ v: plain }), (plain = "");
    out.push({ t, v });
  };
  let i = 0;
  let prevSignificant = "";
  while (i < s.length) {
    const c = s[i]!;
    // comments
    const line = spec.line?.find((p) => s.startsWith(p, i));
    if (line && !(line === "#" && spec === SPECS.php && s[i + 1] === "[")) {
      const end = s.indexOf("\n", i);
      const j = end < 0 ? s.length : end;
      push("com", s.slice(i, j));
      i = j;
      continue;
    }
    const block = spec.block?.find(([a]) => s.startsWith(a, i));
    if (block) {
      const end = s.indexOf(block[1], i + block[0].length);
      const j = end < 0 ? s.length : end + block[1].length;
      push("com", s.slice(i, j));
      i = j;
      continue;
    }
    // python triple-quoted strings
    if (spec === SPECS.py && (s.startsWith('"""', i) || s.startsWith("'''", i))) {
      const q = s.slice(i, i + 3);
      const end = s.indexOf(q, i + 3);
      const j = end < 0 ? s.length : end + 3;
      push("str", s.slice(i, j));
      i = j;
      continue;
    }
    if (spec.quotes.includes(c)) {
      const j = scanString(s, i, c, !!spec.multiline?.includes(c));
      push("str", s.slice(i, j));
      i = j;
      prevSignificant = c;
      continue;
    }
    if (spec.vars) {
      const v = match(spec.vars, s, i);
      if (v) {
        push("var", v);
        i += v.length;
        continue;
      }
    }
    if (spec.decorators && c === "@") {
      const id = match(IDENT, s, i + 1);
      if (id) {
        push("meta", "@" + id);
        i += id.length + 1;
        continue;
      }
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(s[i + 1] ?? ""))) {
      const prev = s[i - 1] ?? "";
      if (!/[\w$]/.test(prev)) {
        const n = match(NUMBER, s, i);
        if (n) {
          push("num", n);
          i += n.length;
          continue;
        }
      }
    }
    const id = match(IDENT, s, i);
    if (id) {
      const key = spec.ci ? id.toLowerCase() : id;
      let t: TokenType | undefined;
      if (spec.kw.has(key)) t = "kw";
      else if (spec.lit?.has(key)) t = "const";
      else if (spec.types?.has(key)) t = "type";
      else {
        let k = i + id.length;
        while (s[k] === " ") k++;
        if (s[k] === "(") t = "fn";
        else if (prevSignificant === ".") t = "prop";
        else if (spec.capsAreTypes && /^[A-Z][a-z]/.test(id)) t = "type";
      }
      push(t, id);
      i += id.length;
      prevSignificant = "a";
      continue;
    }
    if (OPS.includes(c)) push("op", c);
    else push(undefined, c);
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  if (plain) out.push({ v: plain });
  return out;
}

function scanJson(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '"') {
      const j = scanString(s, i, '"', false);
      let k = j;
      while (s[k] === " " || s[k] === "\t") k++;
      out.push({ t: s[k] === ":" ? "prop" : "str", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (s.startsWith("//", i)) {
      const end = s.indexOf("\n", i);
      const j = end < 0 ? s.length : end;
      out.push({ t: "com", v: s.slice(i, j) });
      i = j;
      continue;
    }
    const n = /[-\d]/.test(c) ? match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, s, i) : null;
    if (n) {
      out.push({ t: "num", v: n });
      i += n.length;
      continue;
    }
    const lit = match(/true|false|null/y, s, i);
    if (lit) {
      out.push({ t: "const", v: lit });
      i += lit.length;
      continue;
    }
    out.push({ v: c });
    i++;
  }
  return out;
}

function scanCss(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let depth = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (s.startsWith("/*", i)) {
      const end = s.indexOf("*/", i + 2);
      const j = end < 0 ? s.length : end + 2;
      out.push({ t: "com", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (s.startsWith("//", i) && (s[i - 1] === "\n" || s[i - 1] === " " || i === 0)) {
      const end = s.indexOf("\n", i);
      const j = end < 0 ? s.length : end;
      out.push({ t: "com", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = scanString(s, i, c, false);
      out.push({ t: "str", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "@") {
      const id = match(/@[\w-]+/y, s, i)!;
      out.push({ t: "kw", v: id });
      i += id.length;
      continue;
    }
    if (c === "#" && depth > 0) {
      const hex = match(/#[\da-fA-F]{3,8}\b/y, s, i);
      if (hex) {
        out.push({ t: "num", v: hex });
        i += hex.length;
        continue;
      }
    }
    if (/[\d.]/.test(c) && depth > 0 && !/[\w-]/.test(s[i - 1] ?? "")) {
      const n = match(/-?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)?/y, s, i);
      if (n && n !== ".") {
        out.push({ t: "num", v: n });
        i += n.length;
        continue;
      }
    }
    const id = match(/-?-?[A-Za-z_][\w-]*/y, s, i);
    if (id) {
      let k = i + id.length;
      while (s[k] === " ") k++;
      let t: TokenType | undefined;
      if (depth > 0) {
        if (s[k] === ":" && s[k + 1] !== ":" && !/^(hover|focus|active|before|after|root|not|is|where|has)$/.test(id)) t = "prop";
        else if (s[k] === "(") t = "fn";
        else if (id === "important") t = "kw";
        else t = "const";
      } else {
        const prev = s[i - 1];
        if (prev === "." || prev === "#") t = "type";
        else if (prev === ":") t = "kw";
        else t = "tag";
      }
      out.push({ t, v: id });
      i += id.length;
      continue;
    }
    out.push({ v: c });
    i++;
  }
  return out;
}

const SPECIAL = /<|&|\{\{/g;

function scanHtml(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      const j = end < 0 ? s.length : end + 3;
      out.push({ t: "com", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (s[i] === "<" && /[A-Za-z/!?]/.test(s[i + 1] ?? "")) {
      const m = match(/<\/?[!?]?[\w:.-]*/y, s, i)!;
      out.push({ t: "tag", v: m });
      const tagName = m.replace(/^<\/?/, "").toLowerCase();
      i += m.length;
      // attributes until '>'
      while (i < s.length && s[i] !== ">") {
        const c = s[i]!;
        if (c === '"' || c === "'") {
          const j = scanString(s, i, c, true);
          out.push({ t: "str", v: s.slice(i, j) });
          i = j;
          continue;
        }
        const attr = match(/[^\s=>"'/]+/y, s, i);
        if (attr) {
          out.push({ t: "attr", v: attr });
          i += attr.length;
          continue;
        }
        out.push({ t: c === "=" ? "op" : c === "/" ? "tag" : undefined, v: c });
        i++;
      }
      if (s[i] === ">") {
        out.push({ t: "tag", v: ">" });
        i++;
        // Embedded script/style blocks are highlighted with their own language.
        if (!m.startsWith("</") && (tagName === "script" || tagName === "style")) {
          const close = s.toLowerCase().indexOf(`</${tagName}`, i);
          const j = close < 0 ? s.length : close;
          out.push(...(tagName === "script" ? scanGeneric(s.slice(i, j), SPECS.js!) : scanCss(s.slice(i, j))));
          i = j;
        }
      }
      continue;
    }
    if (s[i] === "&") {
      const ent = match(/&#?\w+;/y, s, i);
      if (ent) {
        out.push({ t: "const", v: ent });
        i += ent.length;
        continue;
      }
    }
    if (s[i] === "{" && s[i + 1] === "{") {
      const end = s.indexOf("}}", i);
      const j = end < 0 ? s.length : end + 2;
      out.push({ t: "var", v: s.slice(i, j) });
      i = j;
      continue;
    }
    SPECIAL.lastIndex = i + 1;
    const found = SPECIAL.exec(s);
    const j = found ? found.index : s.length;
    out.push({ v: s.slice(i, j) });
    i = j;
  }
  return out;
}

function inlineMd(line: string): Token[] {
  const out: Token[] = [];
  const re = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|!?\[([^\]]*)\]\(([^)]*)\)/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ v: line.slice(last, m.index) });
    const v = m[0];
    if (m[1]) out.push({ t: "code", v });
    else if (m[3] || m[4]) out.push({ t: "bold", v });
    else if (m[5] || m[6]) out.push({ t: "em", v });
    else out.push({ t: "link", v });
    last = m.index + v.length;
  }
  if (last < line.length) out.push({ v: line.slice(last) });
  return out;
}

function scanMarkdown(s: string): Token[] {
  const out: Token[] = [];
  const lines = s.split("\n");
  let fence: string | null = null;
  lines.forEach((line, n) => {
    const nl = n < lines.length - 1 ? "\n" : "";
    if (fence !== null) {
      out.push({ t: "code", v: line + nl });
      if (line.trimStart().startsWith(fence)) fence = null;
      return;
    }
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      fence = f[1]!;
      out.push({ t: "code", v: line + nl });
      return;
    }
    if (/^#{1,6}\s/.test(line)) return void out.push({ t: "head", v: line + nl });
    if (/^\s*>/.test(line)) return void out.push({ t: "com", v: line + nl });
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return void out.push({ t: "op", v: line + nl });
    const li = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line);
    if (li) {
      out.push({ v: li[1]! }, { t: "op", v: li[2]! }, { v: li[3]! });
      out.push(...inlineMd(line.slice(li[0].length)));
    } else out.push(...inlineMd(line));
    if (nl) out.push({ v: nl });
  });
  return out;
}

function scanYaml(s: string): Token[] {
  const out: Token[] = [];
  for (const [n, line] of s.split("\n").entries()) {
    if (n > 0) out.push({ v: "\n" });
    const com = /^(\s*)#.*$/.exec(line);
    if (com) {
      out.push({ v: com[1]! }, { t: "com", v: line.slice(com[1]!.length) });
      continue;
    }
    const m = /^(\s*)(- )?([^:#'"]+?|"[^"]*"|'[^']*')(:)(\s|$)(.*)$/.exec(line);
    if (m) {
      out.push({ v: m[1]! });
      if (m[2]) out.push({ t: "op", v: m[2] });
      out.push({ t: "prop", v: m[3]! }, { t: "op", v: m[4]! }, { v: m[5]! });
      out.push(...yamlValue(m[6]!));
    } else {
      const li = /^(\s*)(- )(.*)$/.exec(line);
      if (li) out.push({ v: li[1]! }, { t: "op", v: li[2]! }, ...yamlValue(li[3]!));
      else out.push(...yamlValue(line));
    }
  }
  return out;
}

function yamlValue(v: string): Token[] {
  const hash = v.search(/\s#/);
  const value = hash >= 0 ? v.slice(0, hash) : v;
  const comment = hash >= 0 ? v.slice(hash) : "";
  const out: Token[] = [];
  const trimmed = value.trim();
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(trimmed)) out.push({ t: "const", v: value });
  else if (/^-?\d+(\.\d+)?$/.test(trimmed)) out.push({ t: "num", v: value });
  else if (/^["']/.test(trimmed)) out.push({ t: "str", v: value });
  else if (/^[&*!]/.test(trimmed)) out.push({ t: "type", v: value });
  else out.push({ v: value });
  if (comment) out.push({ t: "com", v: comment });
  return out;
}

function scanIni(s: string): Token[] {
  const out: Token[] = [];
  for (const [n, line] of s.split("\n").entries()) {
    if (n > 0) out.push({ v: "\n" });
    if (/^\s*[;#]/.test(line)) out.push({ t: "com", v: line });
    else if (/^\s*\[.*\]\s*$/.test(line)) out.push({ t: "tag", v: line });
    else {
      const m = /^(\s*)([^=:\s]+)(\s*[=:]\s*)(.*)$/.exec(line);
      if (m) {
        out.push({ v: m[1]! }, { t: "prop", v: m[2]! }, { t: "op", v: m[3]! });
        const val = m[4]!;
        out.push({ t: /^["']/.test(val) ? "str" : /^-?\d+(\.\d+)?$/.test(val) ? "num" : /^(true|false)$/i.test(val) ? "const" : undefined, v: val });
      } else out.push({ v: line });
    }
  }
  return out;
}

export function tokenize(code: string, lang: Lang): Token[] {
  switch (lang) {
    case "plain":
      return [{ v: code }];
    case "json":
      return scanJson(code);
    case "css":
      return scanCss(code);
    case "html":
      return scanHtml(code);
    case "md":
      return scanMarkdown(code);
    case "yaml":
      return scanYaml(code);
    case "ini":
      return scanIni(code);
    default:
      return scanGeneric(code, SPECS[lang] ?? SPECS.clike!);
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]!);

/** Splits tokens into per-line HTML strings (tokens spanning lines are closed and reopened). */
export function toLines(tokens: Token[]): string[] {
  const lines: string[] = [""];
  for (const tok of tokens) {
    const parts = tok.v.split("\n");
    parts.forEach((part, k) => {
      if (k > 0) lines.push("");
      if (!part) return;
      const html = escapeHtml(part);
      lines[lines.length - 1] += tok.t ? `<span class="tk-${tok.t}">${html}</span>` : html;
    });
  }
  return lines;
}
