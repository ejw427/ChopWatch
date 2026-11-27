import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("D:/welch-website/node_modules/sharp");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const website = "D:/welch-website";

const variants = [
  "chopwatch-mark.svg",
  "chopwatch-mark-bars.svg",
  "chopwatch-mark-blade.svg",
  "chopwatch-mark-simple.svg",
];

async function renderPreview(name) {
  const svg = fs.readFileSync(path.join(__dirname, name));
  const out = path.join(__dirname, name.replace(".svg", "-preview.png"));
  await sharp(svg).resize(512, 512).png().toFile(out);
  return out;
}

async function writePng(svgBuf, dest, size) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await sharp(svgBuf).resize(size, size).png().toFile(dest);
}

async function writeHero(svgBuf, dest) {
  const W = 1600;
  const H = 900;
  const markSize = 520;
  const mark = await sharp(svgBuf).resize(markSize, markSize).png().toBuffer();

  const titleSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="72%" cy="48%" r="48%">
      <stop offset="0%" stop-color="#b6f26d" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="#1a2a1c" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#0c100b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#0f140e"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="120" y="390" font-family="Segoe UI, Arial, sans-serif" font-size="92" font-weight="700" fill="#f2f7ea">ChopWatch</text>
  <text x="124" y="470" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="500" fill="#9aab8f">Watch Salad chopping on this PC</text>
</svg>`);

  const base = await sharp(titleSvg).png().toBuffer();
  await sharp(base)
    .composite([{ input: mark, left: W - markSize - 140, top: Math.round((H - markSize) / 2) }])
    .png()
    .toFile(dest);
}

async function main() {
  const chosen = process.argv[2] || "chopwatch-mark.svg";
  for (const v of variants) {
    const p = await renderPreview(v);
    console.log("preview", p);
  }

  const svgBuf = fs.readFileSync(path.join(__dirname, chosen));
  const desktopAssets = path.join(root, "desktop", "assets");
  const desktopBuild = path.join(root, "desktop", "build");
  const webPublic = path.join(root, "web", "public");

  await writePng(svgBuf, path.join(desktopAssets, "icon.png"), 256);
  await writePng(svgBuf, path.join(desktopBuild, "icon.png"), 512);
  await writePng(svgBuf, path.join(website, "public", "icons", "chopwatch.png"), 512);
  await writePng(svgBuf, path.join(webPublic, "chopwatch-mark.png"), 512);

  // Keep jpg brand mark for existing <img src="/chopwatch-mark.jpg">
  await sharp(svgBuf)
    .resize(1024, 1024)
    .flatten({ background: "#12150f" })
    .jpeg({ quality: 92 })
    .toFile(path.join(webPublic, "chopwatch-mark.jpg"));

  await writeHero(svgBuf, path.join(website, "public", "heroes", "chopwatch.png"));

  // electron-builder will derive .ico from desktop/build/icon.png
  await fs.promises.copyFile(
    path.join(__dirname, chosen),
    path.join(__dirname, "chopwatch-mark-active.svg"),
  );

  console.log("generated from", chosen);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
