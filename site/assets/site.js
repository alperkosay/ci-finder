// Small enhancements for theFinder's site. Every section still reads fine without them.

// Highlights gallery: previous / next buttons.
for (const gallery of document.querySelectorAll("[data-gallery]")) {
  const track = gallery.querySelector(".gallery-track");
  const [prev, next] = gallery.querySelectorAll(".round");
  const step = () => track.querySelector(".tile").getBoundingClientRect().width + 20;
  const update = () => {
    prev.disabled = track.scrollLeft < 4;
    next.disabled = track.scrollLeft + track.clientWidth > track.scrollWidth - 4;
  };
  prev.addEventListener("click", () => track.scrollBy({ left: -step() }));
  next.addEventListener("click", () => track.scrollBy({ left: step() }));
  track.addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

// Code tabs with arrow-key navigation (WAI-ARIA tabs pattern).
for (const root of document.querySelectorAll("[data-tabs]")) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(tab);
      const to = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (!to) return;
      e.preventDefault();
      select(to);
      to.focus();
    });
  }
}

// Film: a play button over the poster, native controls after that.
for (const film of document.querySelectorAll("[data-film]")) {
  const video = film.querySelector("video");
  film.querySelector(".film-play").addEventListener("click", () => {
    film.classList.add("is-playing");
    video.controls = true;
    video.play();
  });
  video.addEventListener("play", () => {
    film.classList.add("is-playing");
    video.controls = true;
  });
}

// Copy buttons: the install command and every code block in the docs.
const label =
  document.documentElement.lang === "en"
    ? { copy: "Copy", copied: "Copied", failed: "Copy failed" }
    : { copy: "Kopyala", copied: "Kopyalandı", failed: "Kopyalanamadı" };
async function copy(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    const before = button.textContent;
    button.textContent = label.copied;
    setTimeout(() => (button.textContent = before), 1400);
  } catch {
    button.textContent = label.failed;
  }
}
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", () => copy(button, document.querySelector(button.dataset.copy).textContent));
}
for (const pre of document.querySelectorAll(".doc pre")) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = label.copy;
  button.addEventListener("click", () => copy(button, pre.querySelector("code").textContent));
  pre.append(button);
}

// Docs: mobile menu and the "on this page" highlight.
const side = document.querySelector(".docs-side");
if (side) {
  const toggle = side.querySelector(".docs-menu");
  toggle.addEventListener("click", () => {
    const open = side.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const links = new Map([...side.querySelectorAll(".toc a")].map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const headings = [...document.querySelectorAll(".doc h2[id]")].filter((h) => links.has(h.id));
  if (headings.length) {
    const mark = () => {
      let current = headings[0];
      for (const h of headings) if (h.getBoundingClientRect().top < 120) current = h;
      for (const a of links.values()) a.classList.toggle("is-active", a === links.get(current.id));
    };
    addEventListener("scroll", mark, { passive: true });
    mark();
  }
}
