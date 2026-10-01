/**
 * ShiPu WP - block-letter wordmark.
 *
 * The Termux app draws "SHIPU WP" as a 6-row ASCII face built from solid
 * blocks (tool/app/animations.py). The web version rebuilds the same wordmark
 * as a CSS grid of real elements, so it scales with `clamp()`, takes the
 * gradient fill, and needs no image asset.
 *
 * `#` = solid block, `.` = empty. Each glyph keeps its own natural width, the
 * way the terminal does, so the wordmark stays optically even.
 */

const GLYPHS = {
  S: ["#######", "##.....", "#######", ".....##", "#######", ".....##"],
  H: ["##...##", "##...##", "#######", "##...##", "##...##", "##...##"],
  I: ["#######", "..##...", "..##...", "..##...", "..##...", "#######"],
  P: ["######.", "##...##", "##...##", "######.", "##.....", "##....."],
  U: ["##...##", "##...##", "##...##", "##...##", "##...##", ".#####."],
  W: ["##...##", "##...##", "##.#.##", "#######", "##.#.##", "##...##"],
  " ": [".....", ".....", ".....", ".....", ".....", "....."]
};

const ROWS = 6;
const GAP = 1; // empty column between letters

/**
 * Build the flat cell layout for a label.
 * Returns `{ cols, rows, cells: [{ r, c, tone }] }` where tone is
 * "primary" or "accent" (the part of the wordmark after the space).
 */
export function layout(label) {
  const chars = String(label || "SHIPU WP").toUpperCase().split("");
  const letters = chars.map((char) => GLYPHS[char] || GLYPHS[" "]);

  const cols = letters.reduce((total, glyph) => total + glyph[0].length, 0) + GAP * (letters.length - 1);

  // The accent starts after the last space, so "WP" glows purple.
  const accentFrom = letters.findIndex((glyph) => glyph === GLYPHS[" "]) + 1;

  const cells = [];
  let column = 0;
  letters.forEach((glyph, index) => {
    glyph.forEach((row, r) => {
      row.split("").forEach((cell, c) => {
        if (cell !== "#") return;
        cells.push({ r, c: column + c, tone: accentFrom > 0 && index >= accentFrom ? "accent" : "primary" });
      });
    });
    column += glyph[0].length + GAP;
  });

  return { cols, rows: ROWS, cells };
}

/**
 * Render the wordmark into a host element.
 *
 * @param {HTMLElement} host   container (emptied)
 * @param {object}      [opts]
 * @param {string}      [opts.label]  wordmark text, defaults to "SHIPU WP"
 * @param {string}      [opts.size]   CSS size keyword: "hero" | "lg" | "md" | "sm"
 * @param {boolean}     [opts.tag]    render a neighbouring hidden a11y label
 */
export function renderWordmark(host, opts = {}) {
  if (!host) return null;
  const { label = "SHIPU WP", size = "lg", tag = true } = opts;
  const { cols, rows, cells } = layout(label);

  host.textContent = "";
  host.classList.add("wordmark");
  host.dataset.size = size;
  host.style.setProperty("--wm-cols", String(cols));
  host.style.setProperty("--wm-rows", String(rows));
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", label);

  const fragment = document.createDocumentFragment();
  for (const cell of cells) {
    const dot = document.createElement("span");
    dot.className = `wm-cell wm-${cell.tone}`;
    dot.style.gridArea = `${cell.r + 1} / ${cell.c + 1}`;
    fragment.appendChild(dot);
  }
  host.appendChild(fragment);

  if (tag) {
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = label;
    host.appendChild(sr);
  }
  return host;
}

/** Replace every `[data-wordmark]` element on the page. */
export function mountWordmarks(scope = document, size = null) {
  scope.querySelectorAll("[data-wordmark]").forEach((node) => {
    renderWordmark(node, {
      label: node.dataset.wordmark || "SHIPU WP",
      size: size || node.dataset.size || "lg"
    });
  });
}