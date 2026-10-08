import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// Fills ./uploads with demo folders, documents, code and generated PNG images: `npm run seed`.
const root = process.argv[2] ?? fileURLToPath(new URL("../uploads", import.meta.url));
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x / w, y / h);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const sky = (x, y) => {
  const base = mix([248, 196, 140], [96, 132, 196], y);
  const sun = Math.max(0, 1 - Math.hypot(x - 0.7, y - 0.35) * 6);
  const hill = y > 0.62 + Math.sin(x * 7) * 0.06 ? 1 : 0;
  return hill ? mix([58, 84, 70], [34, 52, 44], y) : mix(base, [255, 236, 200], sun);
};
const sea = (x, y) => (y > 0.55 + Math.sin(x * 14) * 0.015 ? mix([40, 120, 150], [12, 54, 82], y) : mix([200, 228, 240], [120, 180, 220], y));
const dusk = (x, y) => {
  const b = mix([44, 34, 70], [230, 120, 90], y);
  const ridge = y > 0.7 + Math.sin(x * 4 + 1) * 0.08 ? 1 : 0;
  return ridge ? [28, 24, 40] : b;
};
const tiles = (x, y) => ((Math.floor(x * 8) + Math.floor(y * 8)) % 2 ? [236, 191, 95] : [42, 100, 214]);

const f = (p, data) => {
  mkdirSync(join(root, p, ".."), { recursive: true });
  writeFileSync(join(root, p), data);
};
for (const d of ["Belgeler", "Fotoğraflar/2026 Kapadokya", "Projeler/ci-finder/src", "Faturalar", "Müzik", "Tasarım"])
  mkdirSync(join(root, d), { recursive: true });

f("Fotoğraflar/kapadokya-gün-doğumu.png", png(480, 320, sky));
f("Fotoğraflar/kaş-sahil.png", png(480, 320, sea));
f("Fotoğraflar/akşam.png", png(320, 480, dusk));
f("Fotoğraflar/2026 Kapadokya/balon-1.png", png(400, 300, sky));
f("Tasarım/logo-taslak.png", png(256, 256, tiles));
f("kapak.png", png(640, 360, sky));
f("Belgeler/Proje Teklifi.pdf", "%PDF-1.4\n% fake\n" + "x".repeat(184000));
f("Belgeler/Bütçe 2026.xlsx", Buffer.alloc(48211, 1));
f("Belgeler/Sunum - Ekim.pptx", Buffer.alloc(2_312_004, 2));
f("Belgeler/Sözleşme.docx", Buffer.alloc(91234, 3));
f("Faturalar/Fatura-2026-09.pdf", "%PDF-1.4\n" + "y".repeat(52000));
f("Faturalar/Fatura-2026-10.pdf", "%PDF-1.4\n" + "y".repeat(51000));
f("Müzik/demo.mp3", Buffer.alloc(3_400_000, 4));
f("tanıtım.mp4", Buffer.alloc(12_582_912, 5));
f("yedek.zip", Buffer.alloc(734_003, 6));
f(
  "README.md",
  `# ciFinder

Native CSS ile yazılmış, **React** tabanlı bir dosya yöneticisi.

## Özellikler

- Yerel disk ve S3 desteği
- Next.js \`output: "standalone"\` uyumlu
- Dahili kod, Markdown ve görsel editörü

| Paket | Açıklama |
| --- | --- |
| \`@ci-finder/core\` | Sunucu motoru |
| \`@ci-finder/react\` | Arayüz |

> Sürükle, bırak, düzenle.

\`\`\`ts
export const { GET, POST } = createNextRoutes(finder);
\`\`\`
`,
);
f(
  "Projeler/ci-finder/src/index.ts",
  `import { createCiFinder } from "@ci-finder/core";
import { localDriver } from "@ci-finder/core/local";

/** Uploads are stored next to the project. */
export const finder = createCiFinder({
  volumes: [{ id: "files", driver: localDriver({ root: "./uploads" }), url: "/uploads" }],
  chunkSize: 5 * 1024 * 1024,
});

export async function handler(request: Request): Promise<Response> {
  const started = performance.now();
  const response = await finder.handler(request);
  console.log(\`\${request.method} \${new URL(request.url).pathname} \${Math.round(performance.now() - started)}ms\`);
  return response;
}
`,
);
f(
  "Projeler/ci-finder/src/styles.css",
  `.cf-root {\n  --cf-accent: #2a64d6;\n  border-radius: 10px;\n}\n\n@media (prefers-color-scheme: dark) {\n  .cf-root { --cf-bg: #1b1a18; }\n}\n`,
);
f("Projeler/ci-finder/package.json", JSON.stringify({ name: "ci-finder", version: "0.1.0", private: true, scripts: { dev: "next dev" } }, null, 2));
f("notlar.txt", "Pazartesi: S3 sürücüsünü bitir\nSalı: görsel editörü\nÇarşamba: yayın\n");
console.log("seeded", root);
