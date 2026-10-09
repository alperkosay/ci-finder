import { createZipStream, encodeId } from "@thefinder/core";
import type { TheFinder } from "@thefinder/core";
import type { MemoryDriver } from "./memory-driver";

/**
 * Demo content: a small architecture studio's shared drive, in English or Turkish. Images are drawn
 * on a canvas, so nothing heavy is downloaded.
 */

export type DemoLang = "en" | "tr";

const DAY = 86_400_000;

interface Content {
  /** Folder and file paths, keyed by role so both languages build the same tree. */
  path: {
    welcome: string;
    docs: string;
    proposal: string;
    notes: string;
    budget: string;
    images: string;
    screenshots: string;
    cover: string;
    palette: string;
    plan: string;
    logo: string;
    oldLogo: string;
    hero: string;
    features: string;
    project: string;
    archive: string;
    oldSite: string;
  };
  team: { name: string; brand: string; contracts: string; agreement: string; agreementText: string };
  welcome: string;
  proposal: [string, (v1: string) => string, (v2: string) => string];
  notes: string;
  budget: string;
  appTsx: string;
  stylesComment: string;
  projectReadme: string;
  studio: string;
  colors: [string, string][];
  rooms: [string, number, number][];
  scale: string;
  oldSite: Record<string, string>;
  media: { hero: string; features: string };
}

const proposalTr = `# Web sitesi yenileme teklifi

Müşteri: Kıyı Mimarlık
Tarih: 12 Eylül 2026

## Kapsam

- Ana sayfa ve 6 iç sayfa
- Proje galerisi

## Bütçe

Toplam: 180.000 TL + KDV
`;

const proposalEn = `# Website redesign proposal

Client: Coastline Architects
Date: 12 September 2026

## Scope

- Home page and 6 inner pages
- Project gallery

## Budget

Total: $18,000 + VAT
`;

const TR: Content = {
  path: {
    welcome: "/Hoş geldiniz.md",
    docs: "/Belgeler",
    proposal: "/Belgeler/teklif-2026.md",
    notes: "/Belgeler/toplantı-notları.txt",
    budget: "/Belgeler/bütçe.csv",
    images: "/Görseller",
    screenshots: "/Görseller/Ekran görüntüleri",
    cover: "/Görseller/kapak.jpg",
    palette: "/Görseller/renk-paleti.png",
    plan: "/Görseller/kat-planı.png",
    logo: "/Görseller/logo.svg",
    oldLogo: "/Görseller/eski-logo.svg",
    hero: "/Görseller/Ekran görüntüleri/thefinder.png",
    features: "/Görseller/Ekran görüntüleri/özellikler.png",
    project: "/Proje",
    archive: "/Arşiv",
    oldSite: "/Arşiv/eski-site.zip",
  },
  team: {
    name: "Ekip",
    brand: "/Marka",
    contracts: "/Sözleşmeler",
    agreement: "/Sözleşmeler/hizmet-sözleşmesi.md",
    agreementText: "# Hizmet sözleşmesi\n\nBu klasör salt okunurdur. Dosyaları kopyalayabilirsiniz ama burada değiştiremezsiniz.\n",
  },
  welcome: `# theFinder canlı demo

Bu dosya yöneticisinin arkasında sunucu yok. \`@thefinder/core\` motorunun kendisi bu sekmede,
bellekte tutulan bir sürücüyle çalışıyor. Sayfayı yenilediğinizde her şey baştan başlar.

## Deneyebilecekleriniz

- Masaüstünden bir dosya ya da klasör sürükleyip bırakın.
- Bir dosyayı seçip **Space** tuşuna basın: hızlı bakış.
- \`Belgeler/teklif-2026.md\` üzerinde sağ tık → **Sürüm geçmişi**. İki eski sürümü var.
- \`Proje/src/app.tsx\` dosyasını çift tıklayın: kod editörü. **Ctrl+F** bul, **Ctrl+S** kaydet.
- \`Görseller\` içinde bir görseli sağ tık → **Görseli düzenle**: kırp, döndür, yeniden boyutlandır.
- Birkaç dosya seçip sürükleyin; **Ctrl** basılıyken bırakırsanız kopyalanır.
- \`Arşiv/eski-site.zip\` üzerinde sağ tık → **Buraya çıkar**.
- Bir şeyi silin, ardından bildirimdeki **Geri al** düğmesine basın. Çöp kutusunda zaten bir öğe var.
- Üst çubuktaki depolama düğmesi: türlere göre kullanım, sürümler, önbellek.
- **Ekip** volume'ü salt okunurdur. Oradan kopyalayabilir ama içine yazamazsınız.
`,
  proposal: [
    proposalTr,
    (v1) => v1.replace("- Proje galerisi", "- Proje galerisi (filtrelenebilir)\n- İngilizce sürüm"),
    (v2) => `${v2.replace("180.000", "214.000")}
## Takvim

| Hafta | İş |
|---|---|
| 1–2 | Tasarım |
| 3–5 | Geliştirme |
| 6 | Yayın |

> Fiyata bir yıllık barındırma dahildir.
`,
  ],
  notes: `Toplantı notları — 18 Eylül 2026

Katılanlar: Deniz, Ece, Mert

1. Galeri sayfasında proje fotoğrafları tam ekran açılsın.
2. Fotoğraflar sunucuda WebP'ye çevrilsin (theFinder → Görselleri optimize et).
3. Editörler CKEditor'den görsel seçebilsin. useFilePicker ile çözüldü.
4. Bir sonraki toplantı: 25 Eylül, 10:00.
`,
  budget: `kalem,adet,birim_fiyat,toplam
Tasarım,1,60000,60000
Geliştirme,1,110000,110000
İngilizce çeviri,7,4000,28000
Barındırma (1 yıl),1,16000,16000
`,
  appTsx: appTsx("Kapak görseli yok", "Görsel seç"),
  stylesComment: "theFinder'ı markaya uydurmak için yalnızca değişkenler yeterli",
  projectReadme: `# Kıyı Mimarlık web sitesi

Next.js 16, \`output: "standalone"\`. Dosyalar proje kökündeki \`uploads/\` klasöründe.

\`\`\`bash
npm run dev
\`\`\`
`,
  studio: "Kıyı Mimarlık",
  colors: [
    ["Kum", "#E9DCC9"],
    ["Mercan", "#E07A5F"],
    ["Deniz", "#3D5A80"],
    ["Yosun", "#81B29A"],
    ["Gece", "#1D1D1F"],
    ["Kireç", "#F5F5F7"],
  ],
  rooms: [
    ["Salon", 340, 350],
    ["Mutfak", 840, 270],
    ["Yatak odası", 830, 450],
    ["Çalışma", 470, 690],
    ["Banyo", 990, 690],
  ],
  scale: "ÖLÇEK 1:100",
  oldSite: {
    "eski-site/index.html": "<!doctype html>\n<title>Kıyı Mimarlık</title>\n<h1>Yakında</h1>\n",
    "eski-site/style.css": "body { font-family: Georgia, serif; }\n",
    "eski-site/notlar.txt": "2025 sitesi. Arşiv için saklanıyor.\n",
  },
  media: { hero: "../media/thefinder-hero.tr.png", features: "../media/thefinder-features.tr.png" },
};

const EN: Content = {
  path: {
    welcome: "/Welcome.md",
    docs: "/Documents",
    proposal: "/Documents/proposal-2026.md",
    notes: "/Documents/meeting-notes.txt",
    budget: "/Documents/budget.csv",
    images: "/Images",
    screenshots: "/Images/Screenshots",
    cover: "/Images/cover.jpg",
    palette: "/Images/color-palette.png",
    plan: "/Images/floor-plan.png",
    logo: "/Images/logo.svg",
    oldLogo: "/Images/old-logo.svg",
    hero: "/Images/Screenshots/thefinder.png",
    features: "/Images/Screenshots/features.png",
    project: "/Project",
    archive: "/Archive",
    oldSite: "/Archive/old-site.zip",
  },
  team: {
    name: "Team",
    brand: "/Brand",
    contracts: "/Contracts",
    agreement: "/Contracts/service-agreement.md",
    agreementText: "# Service agreement\n\nThis folder is read-only. You can copy files out of it, but you cannot change them here.\n",
  },
  welcome: `# theFinder live demo

There is no server behind this file manager. The \`@thefinder/core\` engine itself runs in this tab,
with a driver that keeps everything in memory. Reload the page and it all starts over.

## Things to try

- Drag a file or a folder in from your desktop.
- Select a file and press **Space**: Quick Look.
- Right-click \`Documents/proposal-2026.md\` → **Version history**. It has two older versions.
- Double-click \`Project/src/app.tsx\`: the code editor. **Ctrl+F** to find, **Ctrl+S** to save.
- Right-click an image in \`Images\` → **Edit image**: crop, rotate, resize.
- Select a few files and drag them; hold **Ctrl** while dropping to copy instead of move.
- Right-click \`Archive/old-site.zip\` → **Extract here**.
- Delete something, then press **Undo** in the notification. The trash already has one item.
- The storage button in the top bar: usage by type, versions, cache.
- The **Team** volume is read-only. You can copy from it, but not write into it.
`,
  proposal: [
    proposalEn,
    (v1) => v1.replace("- Project gallery", "- Project gallery (filterable)\n- Turkish version"),
    (v2) => `${v2.replace("$18,000", "$21,400")}
## Timeline

| Week | Work |
|---|---|
| 1–2 | Design |
| 3–5 | Development |
| 6 | Launch |

> The price includes one year of hosting.
`,
  ],
  notes: `Meeting notes — 18 September 2026

Attendees: Dana, Eli, Marco

1. Project photos on the gallery page should open full screen.
2. Convert photos to WebP on the server (theFinder → Optimize images).
3. Editors should pick images from CKEditor. Solved with useFilePicker.
4. Next meeting: 25 September, 10:00.
`,
  budget: `item,qty,unit_price,total
Design,1,6000,6000
Development,1,11000,11000
Turkish translation,7,400,2800
Hosting (1 year),1,1600,1600
`,
  appTsx: appTsx("No cover image", "Choose image"),
  stylesComment: "Variables are all it takes to match theFinder to the brand",
  projectReadme: `# Coastline Architects website

Next.js 16, \`output: "standalone"\`. Files live in \`uploads/\` at the project root.

\`\`\`bash
npm run dev
\`\`\`
`,
  studio: "Coastline Architects",
  colors: [
    ["Sand", "#E9DCC9"],
    ["Coral", "#E07A5F"],
    ["Sea", "#3D5A80"],
    ["Moss", "#81B29A"],
    ["Night", "#1D1D1F"],
    ["Chalk", "#F5F5F7"],
  ],
  rooms: [
    ["Living room", 300, 350],
    ["Kitchen", 840, 270],
    ["Bedroom", 840, 450],
    ["Study", 470, 690],
    ["Bath", 1000, 690],
  ],
  scale: "SCALE 1:100",
  oldSite: {
    "old-site/index.html": "<!doctype html>\n<title>Coastline Architects</title>\n<h1>Coming soon</h1>\n",
    "old-site/style.css": "body { font-family: Georgia, serif; }\n",
    "old-site/notes.txt": "The 2025 site. Kept for the archive.\n",
  },
  media: { hero: "../media/thefinder-hero.png", features: "../media/thefinder-features.png" },
};

export const teamName = (lang: DemoLang) => (lang === "tr" ? TR : EN).team.name;

const packageJson = `{
  "name": "coastline",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "node .next/standalone/server.js"
  },
  "dependencies": {
    "@thefinder/next": "^0.1.0",
    "@thefinder/react": "^0.1.0",
    "next": "^16.0.0",
    "react": "^19.0.0"
  }
}
`;

function appTsx(empty: string, choose: string) {
  return `"use client";
import { useState } from "react";
import { useFilePicker } from "@thefinder/react";
import "@thefinder/react/styles.css";

export function CoverField({ initial }: { initial?: string }) {
  const [cover, setCover] = useState(initial ?? "");
  const picker = useFilePicker({ endpoint: "/api/files", accept: "image/*" });

  async function choose() {
    const files = await picker.open();
    if (files) setCover(files[0].url);
  }

  return (
    <div className="cover-field">
      {cover ? <img src={cover} alt="" /> : <span>${empty}</span>}
      <button type="button" onClick={choose} disabled={picker.isOpen}>
        ${choose}
      </button>
    </div>
  );
}
`;
}

const stylesCss = (comment: string) => `.cover-field {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #d2d2d7;
  border-radius: 12px;

  & img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 8px;
  }
}

/* ${comment} */
.tf-root {
  --tf-accent: #0f766e;
  --tf-radius: 6px;
}
`;

const finderTs = `import { createTheFinder, localDriver, uploadsDir } from "@thefinder/next";
import { sharpImages, sharpThumbnailer } from "@thefinder/core/sharp";

export const finder = createTheFinder({
  volumes: [
    {
      id: "uploads",
      name: "Uploads",
      driver: localDriver({ root: uploadsDir() }),
      url: "/uploads",
      denyExtensions: ["php", "exe"],
    },
  ],
  thumbnails: { generator: sharpThumbnailer() },
  images: sharpImages(),
});
`;

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h9.4a2.5 2.5 0 0 1 1.85.82L19.1 10.5H34.5A2.5 2.5 0 0 1 37 13v19.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 3 32.5z" fill="#d6a03d"/><path d="M3 15.75a2.5 2.5 0 0 1 2.5-2.5h29a2.5 2.5 0 0 1 2.5 2.5V32.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 3 32.5z" fill="#ecbf5f"/><circle cx="20" cy="24" r="4.5" fill="none" stroke="#7a5310" stroke-width="2"/><path d="M23.3 27.3 26.5 30.5" stroke="#7a5310" stroke-width="2" stroke-linecap="round"/></svg>
`;

const oldLogoSvg = (word: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#1d1d1f"/><text x="60" y="26" font-family="Georgia, serif" font-size="16" fill="#f5f5f7" text-anchor="middle">${word}</text></svg>
`;

function canvas(width: number, height: number) {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return { el, ctx: el.getContext("2d")! };
}

async function encode(el: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, type, quality));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
}

/** A flat coastal landscape: sky, sun, two hill lines and the sea. */
async function landscape(): Promise<Uint8Array> {
  const { el, ctx } = canvas(1600, 1000);
  const sky = ctx.createLinearGradient(0, 0, 0, 620);
  sky.addColorStop(0, "#f6b48f");
  sky.addColorStop(1, "#fbe3c8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = "#fff4e6";
  ctx.beginPath();
  ctx.arc(1080, 470, 120, 0, Math.PI * 2);
  ctx.fill();
  const hills = [
    { color: "#c98a7a", base: 600, amp: 70, freq: 0.004 },
    { color: "#8c5f68", base: 650, amp: 50, freq: 0.007 },
  ];
  for (const h of hills) {
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.moveTo(0, 1000);
    for (let x = 0; x <= 1600; x += 10) ctx.lineTo(x, h.base - Math.sin(x * h.freq + h.base) * h.amp);
    ctx.lineTo(1600, 1000);
    ctx.fill();
  }
  const sea = ctx.createLinearGradient(0, 700, 0, 1000);
  sea.addColorStop(0, "#3f6f8f");
  sea.addColorStop(1, "#1f3a52");
  ctx.fillStyle = sea;
  ctx.fillRect(0, 700, 1600, 300);
  ctx.strokeStyle = "rgba(255,244,230,.35)";
  ctx.lineWidth = 3;
  for (let y = 730; y < 1000; y += 34) {
    ctx.beginPath();
    ctx.moveTo(900 - (y - 700) * 0.9, y);
    ctx.lineTo(1260 + (y - 700) * 0.9, y);
    ctx.stroke();
  }
  return encode(el, "image/jpeg", 0.86);
}

/** A colour palette sheet, the kind of file a design folder always has. */
async function palette(c: Content): Promise<Uint8Array> {
  const { el, ctx } = canvas(1200, 760);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1200, 760);
  ctx.font = "600 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#1d1d1f";
  ctx.fillText(`${c.studio} — ${c === TR ? "renkler" : "colors"}`, 60, 92);
  c.colors.forEach(([name, hex], i) => {
    const x = 60 + (i % 3) * 370;
    const y = 140 + Math.floor(i / 3) * 300;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.roundRect(x, y, 340, 200, 18);
    ctx.fill();
    if (hex === "#F5F5F7") {
      ctx.strokeStyle = "#d2d2d7";
      ctx.stroke();
    }
    ctx.fillStyle = "#1d1d1f";
    ctx.font = "600 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(name, x, y + 240);
    ctx.fillStyle = "#6e6e73";
    ctx.font = "22px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText(hex, x + 200, y + 240);
  });
  return encode(el, "image/png");
}

/** A floor plan sketch drawn with lines. */
async function plan(c: Content): Promise<Uint8Array> {
  const { el, ctx } = canvas(1400, 1000);
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, 1400, 1000);
  ctx.strokeStyle = "rgba(61,90,128,.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 1400; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1000);
    ctx.stroke();
  }
  for (let i = 0; i <= 1000; i += 40) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1400, i);
    ctx.stroke();
  }
  ctx.strokeStyle = "#2b3a4a";
  ctx.lineWidth = 10;
  ctx.strokeRect(200, 160, 1000, 680);
  ctx.lineWidth = 6;
  const walls: [number, number, number, number][] = [
    [600, 160, 600, 520],
    [200, 520, 900, 520],
    [900, 520, 900, 840],
    [600, 360, 1200, 360],
  ];
  for (const [x1, y1, x2, y2] of walls) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.fillStyle = "#2b3a4a";
  ctx.font = "500 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  for (const [label, x, y] of c.rooms) ctx.fillText(label, x, y);
  ctx.font = "22px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText(c.scale, 200, 900);
  return encode(el, "image/png");
}

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const now = Date.now() - 400 * DAY;
  const sources = Object.entries(files).map(([name, text]) => ({
    name,
    mtime: now,
    open: async () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(text));
          c.close();
        },
      }),
  }));
  return new Uint8Array(await new Response(createZipStream(sources)).arrayBuffer());
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function seed(finder: TheFinder, demo: MemoryDriver, team: MemoryDriver, lang: DemoLang) {
  const c = lang === "tr" ? TR : EN;
  const p = c.path;
  const dirs = [p.docs, p.images, p.screenshots, p.project, `${p.project}/src`, `${p.project}/lib`, p.archive];
  for (const d of dirs) await demo.mkdir(d);

  const [cover, colors, floor, hero, features] = await Promise.all([landscape(), palette(c), plan(c), fetchBytes(c.media.hero), fetchBytes(c.media.features)]);
  const [proposalV1, toV2, toV3] = c.proposal;
  const proposalV2 = toV2(proposalV1);

  const files: Record<string, string | Uint8Array> = {
    [p.welcome]: c.welcome,
    [p.proposal]: proposalV1,
    [p.notes]: c.notes,
    [p.budget]: c.budget,
    [p.cover]: cover,
    [p.palette]: colors,
    [p.plan]: floor,
    [p.logo]: logoSvg,
    [p.oldLogo]: oldLogoSvg(lang === "tr" ? "KIYI" : "COAST"),
    [`${p.project}/package.json`]: packageJson,
    [`${p.project}/README.md`]: c.projectReadme,
    [`${p.project}/src/app.tsx`]: c.appTsx,
    [`${p.project}/src/styles.css`]: stylesCss(c.stylesComment),
    [`${p.project}/lib/finder.ts`]: finderTs,
    [p.oldSite]: await zipOf(c.oldSite),
  };
  if (hero) files[p.hero] = hero;
  if (features) files[p.features] = features;
  for (const [path, data] of Object.entries(files)) await demo.write(path, data);

  // History and trash go through the engine, exactly as they would on a server.
  const proposal = encodeId("demo", p.proposal);
  await finder.execute("put", { id: proposal, content: proposalV2 });
  await finder.execute("put", { id: proposal, content: toV3(proposalV2) });
  await finder.execute("rm", { ids: [encodeId("demo", p.oldLogo)] });

  const t = c.team;
  for (const d of [t.brand, t.contracts]) await team.mkdir(d);
  await team.write(`${t.brand}/logo.svg`, logoSvg);
  await team.write(`${t.brand}/${p.cover.split("/").pop()}`, cover);
  await team.write(t.agreement, t.agreementText);
}
