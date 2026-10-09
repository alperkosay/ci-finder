import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCiFinder } from "@ci-finder/core";
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";
import { MemoryDriver } from "./memory-driver";
import { seed, teamName, type DemoLang } from "./seed";

const MiB = 1024 * 1024;

// ?lang=en|tr picks the language of both the UI and the demo files; without it, the browser's.
const params = new URLSearchParams(location.search);
const asked = params.get("lang");
const lang: DemoLang = asked === "tr" || asked === "en" ? asked : navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
document.documentElement.lang = lang;
if (lang === "tr") document.title = "Canlı demo · ciFinder";

const demo = new MemoryDriver(200 * MiB);
const team = new MemoryDriver(20 * MiB);
const finder = createCiFinder({
  chunkSize: MiB,
  volumes: [
    { id: "demo", name: "Demo", driver: demo, maxUploadSize: 50 * MiB, denyExtensions: ["exe"] },
    { id: "team", name: teamName(lang), driver: team, readOnly: true },
  ],
});
const seeded = seed(finder, demo, team, lang);

interface WireRequest {
  type: "ci-finder:request";
  url: string;
  method: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

/** Runs a request forwarded by the service worker through the engine and posts the response back. */
async function answer(msg: WireRequest, port: MessagePort) {
  await seeded;
  const res = await finder.handler(new Request(msg.url, { method: msg.method, headers: msg.headers, body: msg.body }));
  const empty = msg.method === "HEAD" || res.status === 204 || res.status === 304;
  const body = empty ? null : await res.arrayBuffer();
  port.postMessage({ status: res.status, statusText: res.statusText, headers: [...res.headers], body }, body ? [body] : []);
}

const API_BASE = new URL("./api/", location.href).href;

function filenameOf(disposition: string | null): string | null {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]!);
  return disposition?.match(/filename="([^"]*)"/i)?.[1] ?? null;
}

// Chromium sends <a download> requests straight to the network, past the service worker. The
// demo fetches those itself (fetch does go through the worker) and hands the browser a blob.
const nativeClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  if (!this.hasAttribute("download") || !this.href.startsWith(API_BASE)) return nativeClick.call(this);
  void fetch(this.href).then(async (res) => {
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameOf(res.headers.get("content-disposition")) ?? "download";
    nativeClick.call(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
};

/** Registers the worker and resolves once it controls this page, so ./api requests reach the engine. */
async function connect(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const sw = navigator.serviceWorker;
  sw.onmessage = (e) => {
    if (e.data?.type === "ci-finder:request") void answer(e.data as WireRequest, e.ports[0]!);
  };
  const reg = await sw.register("./sw.js", { scope: "./" });
  if (sw.controller) return true;
  await sw.ready;
  if (sw.controller) return true;
  // A hard reload bypasses the worker; ask it to take over this page.
  const changed = new Promise<boolean>((resolve) => sw.addEventListener("controllerchange", () => resolve(true), { once: true }));
  (reg.active ?? reg.waiting ?? reg.installing)?.postMessage("claim");
  return Promise.race([changed, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000))]);
}

const embedded = params.has("embed");
if (embedded) document.documentElement.classList.add("is-embed");

function Demo() {
  const [locale, setLocale] = useState<DemoLang>(lang);
  return (
    <>
      {!embedded && (
        <header className="bar">
          <a className="bar-back" href={lang === "tr" ? "../tr/" : "../"}>
            ciFinder
          </a>
          <p className="bar-note">
            {locale === "tr"
              ? "Sunucu yok. Gerçek motor bu sekmede, bellekte çalışıyor. Yenileyince sıfırlanır."
              : "No server. The real engine runs in this tab, in memory. Reloading resets it."}
          </p>
          <div className="bar-seg" role="group" aria-label="Dil / Language">
            <button type="button" aria-pressed={locale === "tr"} onClick={() => setLocale("tr")}>
              TR
            </button>
            <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
              EN
            </button>
          </div>
        </header>
      )}
      <main className="stage">
        <CiFinder endpoint="./api/files" locale={locale} persistKey="ci-finder-demo" />
      </main>
    </>
  );
}

const root = document.getElementById("root")!;
connect()
  .catch(() => false)
  .then((ok) => {
    if (ok) {
      createRoot(root).render(
        <StrictMode>
          <Demo />
        </StrictMode>,
      );
      return;
    }
    root.innerHTML =
      lang === "tr"
        ? `<div class="fallback"><h1>Demo bu tarayıcıda açılamadı.</h1><p>Canlı demo, motoru tarayıcıda çalıştırmak için Service Worker kullanır. Gizli pencerede ya da Service Worker kapalıyken çalışmaz. Sayfayı normal bir pencerede yeniden açmayı deneyin.</p><p><a href="../tr/">Siteye dön</a></p></div>`
        : `<div class="fallback"><h1>The demo could not start in this browser.</h1><p>The live demo runs the engine in the browser through a Service Worker, which is unavailable in private windows or when Service Workers are turned off. Try opening the page in a normal window.</p><p><a href="../">Back to the site</a></p></div>`;
  });
