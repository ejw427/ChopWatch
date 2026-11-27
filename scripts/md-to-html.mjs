#!/usr/bin/env node
/**
 * Convert project Markdown docs to sibling HTML files.
 * Usage:
 *   node scripts/md-to-html.mjs                 # all root / docs *.md
 *   node scripts/md-to-html.mjs OPEN.md FIRST_RUN.md
 *   node scripts/md-to-html.mjs --file path.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "release",
  ".git",
  ".cursor",
]);

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rewriteMdHref(href) {
  if (/^https?:\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) {
    return href;
  }
  return href.replace(/\.md(\b|$|#)/i, ".html$1");
}

function inline(md) {
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = rewriteMdHref(href.trim());
    return `<a href="${escapeHtml(safeHref)}">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return s;
}

function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let listType = null; // "ul" | "ol"
  let para = [];
  let hasMermaid = false;

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };

  const flushList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };

  const flushCode = () => {
    if (!inCode) return;
    const raw = codeLines.join("\n");
    if (codeLang.toLowerCase() === "mermaid") {
      hasMermaid = true;
      // Mermaid reads textContent; escape so </script>-like sequences stay safe in HTML.
      out.push(`<pre class="mermaid">${escapeHtml(raw)}</pre>`);
    } else {
      const body = escapeHtml(raw);
      const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
      out.push(`<pre><code${cls}>${body}</code></pre>`);
    }
    inCode = false;
    codeLang = "";
    codeLines = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushPara();
      flushList();
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        flushCode();
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // GFM tables: | a | b | then |---|---| then data rows
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(lines[i + 1])
    ) {
      flushPara();
      flushList();
      const splitRow = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = splitRow(line);
      i += 2; // skip header + separator
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        bodyRows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push('<div class="table-wrap"><table>');
      out.push("<thead><tr>");
      for (const cell of header) out.push(`<th>${inline(cell)}</th>`);
      out.push("</tr></thead><tbody>");
      for (const row of bodyRows) {
        out.push("<tr>");
        for (let c = 0; c < header.length; c += 1) {
          out.push(`<td>${inline(row[c] ?? "")}</td>`);
        }
        out.push("</tr>");
      }
      out.push("</tbody></table></div>");
      continue;
    }

    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      i += 1;
      continue;
    }

    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inline(ol[2])}</li>`);
      i += 1;
      continue;
    }

    flushList();
    para.push(line.trim());
    i += 1;
  }

  flushPara();
  flushList();
  flushCode();
  return { html: out.join("\n"), hasMermaid };
}

function pageShell(title, bodyHtml, sourceName, { hasMermaid = false } = {}) {
  const mermaidCss = hasMermaid
    ? `
    main { max-width: 58rem; }
    pre.mermaid {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem 1rem;
      overflow-x: auto;
      text-align: center;
      color: var(--text);
    }
    pre.mermaid svg { max-width: 100%; height: auto; }
`
    : "";
  const mermaidScript = hasMermaid
    ? `
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({
      startOnLoad: true,
      theme: "dark",
      securityLevel: "strict",
      flowchart: { htmlLabels: true, curve: "basis" },
      themeVariables: {
        primaryColor: "#1a3d2e",
        primaryTextColor: "#e8f0ea",
        primaryBorderColor: "#3dcf8e",
        lineColor: "#9ab0a4",
        secondaryColor: "#18201c",
        tertiaryColor: "#0f1412",
        background: "#18201c",
        mainBkg: "#1a3d2e",
        nodeBorder: "#3dcf8e",
        clusterBkg: "#141c18",
        titleColor: "#3dcf8e",
        edgeLabelBackground: "#18201c"
      }
    });
  </script>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0f1412;
      --panel: #18201c;
      --text: #e8f0ea;
      --muted: #9ab0a4;
      --accent: #3dcf8e;
      --border: #2a3830;
      --code-bg: #0a0e0c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "IBM Plex Sans", system-ui, sans-serif;
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, #1a3d2e 0%, transparent 55%),
        radial-gradient(ellipse 60% 40% at 100% 0%, #243528 0%, transparent 50%),
        var(--bg);
      color: var(--text);
      line-height: 1.55;
      min-height: 100vh;
    }
    main {
      max-width: 52rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
    }
    ${mermaidCss}
    .meta {
      font-size: 0.8rem;
      color: #8aa090;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
    }
    h1, h2, h3, h4 {
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    h1 { font-size: 2rem; margin: 0 0 0.75rem; color: var(--accent); }
    h2 {
      font-size: 1.35rem;
      margin: 2rem 0 0.75rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
    }
    h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    h4 { font-size: 1rem; margin: 1.15rem 0 0.4rem; color: #c5d8cc; }
    p { margin: 0.75rem 0; color: #d5e2d9; }
    a { color: var(--accent); }
    ul, ol { margin: 0.75rem 0; padding-left: 1.35rem; color: #d5e2d9; }
    li { margin: 0.35rem 0; }
    blockquote {
      margin: 1rem 0;
      padding: 0.65rem 1rem;
      border-left: 3px solid var(--accent);
      background: var(--panel);
      color: var(--muted);
      border-radius: 0 8px 8px 0;
    }
    blockquote p { margin: 0.35rem 0; color: inherit; }
    hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 1.75rem 0;
    }
    .table-wrap {
      overflow-x: auto;
      margin: 1rem 0 1.25rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    th, td {
      text-align: left;
      padding: 0.55rem 0.75rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th {
      background: #1f2a24;
      color: #c8e0d0;
      font-weight: 600;
      white-space: nowrap;
    }
    tr:last-child td { border-bottom: 0; }
    td code { white-space: nowrap; }
    .callout {
      margin: 1rem 0;
      padding: 0.85rem 1rem;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--panel);
    }
    code {
      font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
      font-size: 0.9em;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.1em 0.35em;
    }
    pre {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.1rem;
      overflow-x: auto;
    }
    pre code {
      border: 0;
      background: transparent;
      padding: 0;
      font-size: 0.88rem;
    }
    strong { color: #fff; }
  </style>
</head>
<body>
  <main>
    <p class="meta">Generated from <code>${escapeHtml(sourceName)}</code> · do not edit by hand</p>
    ${bodyHtml}
  </main>
  ${mermaidScript}
</body>
</html>
`;
}

function titleFromMarkdown(md, fallback) {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].replace(/\*\*/g, "").trim() : fallback;
}

export function convertMarkdownFile(mdPath) {
  const abs = path.resolve(mdPath);
  if (!abs.toLowerCase().endsWith(".md")) {
    return null;
  }
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing file: ${abs}`);
  }
  const md = fs.readFileSync(abs, "utf8");
  const base = path.basename(abs);
  const title = titleFromMarkdown(md, base);
  const { html: bodyHtml, hasMermaid } = markdownToHtml(md);
  const html = pageShell(title, bodyHtml, base, { hasMermaid });
  const outPath = abs.replace(/\.md$/i, ".html");
  fs.writeFileSync(outPath, html, "utf8");
  return outPath;
}

function walkMarkdown(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkMarkdown(full, acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

function parseArgs(argv) {
  const files = [];
  let openInBrowser = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--open" || a === "-o") {
      openInBrowser = true;
      continue;
    }
    if (a === "--file" || a === "-f") {
      const next = argv[i + 1];
      if (next) {
        files.push(next);
        i += 1;
      }
      continue;
    }
    if (a.startsWith("-")) continue;
    files.push(a);
  }
  return { files, openInBrowser };
}

async function openPath(filePath) {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", filePath], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  if (platform === "darwin") {
    spawn("open", [filePath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  const { files, openInBrowser } = parseArgs(process.argv.slice(2));
  const targets = files.length
    ? files.map((f) => path.resolve(ROOT, f))
    : walkMarkdown(ROOT);

  const written = [];
  for (const file of targets) {
    const out = convertMarkdownFile(file);
    if (out) {
      written.push(out);
      console.log(`wrote ${path.relative(ROOT, out)}`);
    }
  }
  if (!written.length) {
    console.log("no markdown files converted");
    return;
  }
  if (openInBrowser) {
    for (const out of written) {
      await openPath(out);
      console.log(`opened ${path.relative(ROOT, out)}`);
    }
  }
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main();
}
