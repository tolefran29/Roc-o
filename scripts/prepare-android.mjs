// Aplica a android/ (generado con "npx cap add android") los ajustes de Rocío: icono, splash, permisos y firma.
import fs from "node:fs";
import path from "node:path";
function copyDir(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d); } else fs.copyFileSync(s, d);
  }
}
if (!fs.existsSync("android")) { console.error("Primero ejecuta: npx cap add android"); process.exit(1); }
copyDir("android-overrides", "android");
console.log("Ajustes de Android aplicados");
