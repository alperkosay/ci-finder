"use client";

import { useState, type FormEvent } from "react";
import { Nav } from "../nav";
import { FileField, GalleryField } from "./file-field";
import { RichEditor } from "./rich-editor";
import { RichEditor4 } from "./rich-editor-4";

const HOOK_SNIPPET = `import { useFilePicker } from "@ci-finder/react";

const picker = useFilePicker({ endpoint: "/api/files", accept: "image/*" });

<input value={cover} onChange={(e) => setCover(e.target.value)} />
<button onClick={async () => {
  const files = await picker.open();      // null: vazgeçildi
  if (files) setCover(files[0].url);      // "/uploads/kapak.png"
}}>Dosya seç</button>`;

const CK_SNIPPET = `import { CiFinder } from "@ci-finder/ckeditor";

ClassicEditor.create(el, {
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, Image, ImageUpload, Link, CiFinder],
  toolbar: ["bold", "link", "|", "ciFinder"],
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});`;

const CK4_SNIPPET = `import { registerCiFinder } from "@ci-finder/ckeditor/v4";

registerCiFinder(window.CKEDITOR);
CKEDITOR.replace("body", {
  extraPlugins: "cifinder,uploadimage",
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});`;

const INITIAL_HTML_4 =
  "<p>CKEditor 4: araç çubuğundaki klasör düğmesine ek olarak <strong>Resim</strong> ve <strong>Bağlantı</strong> pencerelerindeki “Sunucuyu Gözat” düğmeleri de ciFinder'ı açar.</p>";

const INITIAL_HTML =
  "<h2>Kapadokya notları</h2><p>Araç çubuğundaki <strong>klasör</strong> düğmesiyle dosya yöneticisini açın: görseller görsel olarak, diğer dosyalar bağlantı olarak eklenir. Panodan yapıştırılan görseller <code>/editor</code> klasörüne yüklenir.</p>";

interface Post {
  title: string;
  cover: string;
  attachment: string;
  file: string;
  gallery: string[];
}

export function Playground() {
  const [post, setPost] = useState<Post>({ title: "Kapadokya gezisi", cover: "", attachment: "", file: "", gallery: [] });
  const [submitted, setSubmitted] = useState<Post | null>(null);
  const [html, setHtml] = useState("");
  const [html4, setHtml4] = useState("");
  const set = <K extends keyof Post>(key: K, value: Post[K]) => setPost((p) => ({ ...p, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(post);
  };

  return (
    <div className="page is-scroll">
      <header className="bar">
        <div className="brand">
          <strong>ciFinder</strong>
          <span>playground</span>
        </div>
        <Nav />
      </header>

      <main className="play">
        <section className="panel">
          <header className="panel-head">
            <h2>Form alanı</h2>
            <p>
              <code>useFilePicker</code> ciFinder&apos;ı seçici olarak açar ve seçilen dosyaları bir <code>Promise</code> ile döndürür. Aşağıdaki alanlar bu
              hook ile yazılmış küçük bir <code>FileField</code> bileşeni.
            </p>
          </header>

          <form className="form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="title">Başlık</label>
              <input id="title" name="title" value={post.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <FileField
              label="Kapak görseli"
              name="cover"
              accept="image/*"
              value={post.cover}
              placeholder="/uploads/…"
              hint="Yalnızca görseller seçilebilir; diğer dosyalar soluk görünür."
              onChange={(v) => set("cover", v)}
            />
            <FileField
              label="Ek dosya"
              name="attachment"
              accept=".pdf,.docx,.xlsx"
              value={post.attachment}
              placeholder="/uploads/Belgeler/…"
              hint="accept: .pdf, .docx, .xlsx"
              onChange={(v) => set("attachment", v)}
            />
            <FileField
              label="Herhangi bir dosya"
              name="file"
              value={post.file}
              placeholder="/uploads/…"
              hint="accept verilmedi: her türden dosya seçilebilir."
              onChange={(v) => set("file", v)}
            />
            <GalleryField label="Galeri" value={post.gallery} onChange={(v) => set("gallery", v)} />
            <div className="form-actions">
              <button type="submit" className="btn primary">
                Gönder
              </button>
            </div>
          </form>

          {submitted && (
            <div className="output">
              <span className="output-label">Gönderilen veri</span>
              <pre>{JSON.stringify(submitted, null, 2)}</pre>
            </div>
          )}

          <details className="snippet">
            <summary>Kod</summary>
            <pre>{HOOK_SNIPPET}</pre>
          </details>
        </section>

        <div className="stack">
          <section className="panel">
            <header className="panel-head">
              <h2>CKEditor 5</h2>
              <p>
                <code>@ci-finder/ckeditor</code> connector&apos;ı: araç çubuğuna bir dosya yöneticisi düğmesi ekler ve yapıştırılan / sürüklenen görselleri
                ciFinder üzerinden yükler (CKFinder&apos;ın yaptığı iş).
              </p>
            </header>

            <RichEditor initialData={INITIAL_HTML} onChange={setHtml} />
            <EditorOutput html={html} />

            <details className="snippet">
              <summary>Kod</summary>
              <pre>{CK_SNIPPET}</pre>
            </details>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>CKEditor 4</h2>
              <p>
                <code>@ci-finder/ckeditor/v4</code>: global <code>CKEDITOR</code> nesnesine bir <code>cifinder</code> eklentisi kaydeder. Araç çubuğu düğmesi,
                pencerelerdeki “Sunucuyu Gözat” ve yapıştırılan görseller (<code>uploadimage</code>) ciFinder&apos;a bağlanır.
              </p>
            </header>

            <RichEditor4 initialData={INITIAL_HTML_4} onChange={setHtml4} />
            <EditorOutput html={html4} />

            <details className="snippet">
              <summary>Kod</summary>
              <pre>{CK4_SNIPPET}</pre>
            </details>
          </section>
        </div>
      </main>
    </div>
  );
}

function EditorOutput({ html }: { html: string }) {
  const [tab, setTab] = useState<"preview" | "html">("preview");
  return (
    <div className="output">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>
          Önizleme
        </button>
        <button type="button" role="tab" aria-selected={tab === "html"} onClick={() => setTab("html")}>
          HTML
        </button>
      </div>
      {tab === "preview" ? <div className="rendered" dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{html}</pre>}
    </div>
  );
}
