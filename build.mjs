// Genera las tres versiones de Rocío a partir de src/:
//   www/   -> app de Android (Capacitor)
//   site/  -> app web instalable para GitHub Pages (Android y iPhone)
//   dist/rocio.html -> versión de un solo archivo (Claude)
import { build } from "esbuild";
import fs from "node:fs";
const r = f => fs.readFileSync(new URL("./src/" + f, import.meta.url), "utf8");
const rm = d => fs.rmSync(d, { recursive: true, force: true });
const VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

// Dirección pública de la web (GitHub Pages), deducida del repositorio en GitHub Actions
const repo = process.env.GITHUB_REPOSITORY || process.env.ROCIO_REPO || "";
let siteUrl = process.env.ROCIO_SITE_URL || "";
if (!siteUrl && repo.includes("/")) {
  const [owner, name] = repo.split("/");
  siteUrl = name.toLowerCase() === (owner + ".github.io").toLowerCase() ? `https://${owner.toLowerCase()}.github.io/` : `https://${owner.toLowerCase()}.github.io/${name}/`;
}
const apkUrl = repo ? `https://github.com/${repo}/releases/latest/download/rocio.apk` : "";
const config = (extra = {}) => "window.ROCIO_CONFIG=" + JSON.stringify(Object.assign({
  version: VERSION, aiEndpoint: "", aiKey: "", siteUrl, apkUrl, privacyUrl: siteUrl ? siteUrl + "privacy.html" : "", contactEmail: "id00889261@usal.es"
}, (() => { try { return JSON.parse(fs.readFileSync("src/ai.json", "utf8")); } catch { return {}; } })(), extra)) + ";";

// Fuentes locales (sin conexión)
const FONTS = [["Figtree", "figtree", [400, 500, 600, 700]], ["Bricolage Grotesque", "bricolage-grotesque", [600, 700]]];
const fontFiles = []; let fontCss = "";
for (const [fam, pkg, ws] of FONTS) for (const w of ws) { const f = `${pkg}-latin-${w}-normal.woff2`; fontFiles.push([`node_modules/@fontsource/${pkg}/files/${f}`, f]); fontCss += `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:swap;src:url(fonts/${f}) format("woff2")}\n`; }
const copyFonts = dir => { fs.mkdirSync(dir + "/fonts", { recursive: true }); for (const [s, f] of fontFiles) fs.copyFileSync(s, dir + "/fonts/" + f); };
const GF = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">';

const base = r("shell.html").replace("/*CSS*/", () => r("app.css")).replace("/*CATALOG*/", () => JSON.stringify(r("catalog.txt"))).replace("/*JS*/", () => r("app.js"));
const page = (fonts, head, scripts) => base.replace("<!--FONTS-->", () => fonts + head).replace("<!--NATIVE-->", () => scripts);

// 1) Android
rm("www"); fs.mkdirSync("www", { recursive: true }); copyFonts("www");
await build({ entryPoints: ["src/native.js"], bundle: true, minify: true, format: "iife", outfile: "www/native.js", target: "chrome100", logLevel: "warning" });
fs.writeFileSync("www/config.js", config({ platform: "android" }));
fs.writeFileSync("www/index.html", page("<style>" + fontCss + "</style>", "", '<script src="config.js"></script><script src="native.js"></script>'));

// 2) Web instalable (PWA)
rm("site"); fs.mkdirSync("site/icons", { recursive: true }); copyFonts("site");
for (const f of fs.readdirSync("src/pwa/icons")) fs.copyFileSync("src/pwa/icons/" + f, "site/icons/" + f);
fs.copyFileSync("src/pwa/manifest.webmanifest", "site/manifest.webmanifest");
fs.copyFileSync("src/pwa/privacy.html", "site/privacy.html");
const buildId = VERSION + "-" + Date.now().toString(36);
fs.writeFileSync("site/sw.js", r("pwa/sw.js").replace("__BUILD__", buildId).replace("__FONTS__", fontFiles.map(([, f]) => JSON.stringify("./fonts/" + f)).join(", ")));
const pwaHead = '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" type="image/png" href="icons/favicon-32.png"><link rel="apple-touch-icon" href="icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Rocío"><meta name="description" content="Te dice cuándo y cuánto regar cada planta según el tiempo de tu ciudad.">';
fs.writeFileSync("site/index.html", page("<style>" + fontCss + "</style>", pwaHead, "<script>" + config({ platform: "pwa" }) + "</script>"));
fs.writeFileSync("site/.nojekyll", "");

// 3) Archivo único (Claude)
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/rocio.html", page(GF, "", "<script>" + config({ platform: "web" }) + "</script>"));

console.log("Listo:", { siteUrl: siteUrl || "(se rellena en GitHub)", www: fs.statSync("www/index.html").size, site: fs.statSync("site/index.html").size });
