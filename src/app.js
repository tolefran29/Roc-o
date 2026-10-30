"use strict";
/* ================== Utilidades ================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const uid = () => Math.random().toString(36).slice(2, 10);
const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
function isoDate(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); }
function localInput(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 16); }
function addDays(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDate(d); }
function diffDays(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5); }
const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DOWL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function niceDay(iso, today) {
  const n = diffDays(today, iso), d = new Date(iso + "T12:00:00");
  if (n === 0) return "hoy"; if (n === 1) return "mañana"; if (n === -1) return "ayer";
  if (n > 1 && n < 7) return "el " + DOWL[d.getDay()];
  return "el " + d.getDate() + " " + MON[d.getMonth()];
}
function fmtL(l) { if (!isFinite(l) || l <= 0) return "—"; if (l < 1) return nf0.format(Math.max(10, Math.round(l * 100) * 10)) + " ml"; return (l < 10 ? nf1.format(l) : nf0.format(l)) + " L"; }
function toast(m, opt = {}) {
  const t = $("#toast"), a = $("#toastAct"); $("#toastMsg").textContent = m;
  if (opt.action) { a.textContent = opt.action; a.classList.remove("hidden"); a.onclick = () => { t.classList.remove("show"); opt.onAction && opt.onAction(); }; t.classList.add("has-act"); }
  else { a.classList.add("hidden"); a.onclick = null; t.classList.remove("has-act"); }
  t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), opt.action ? 5000 : 2800);
}
/* Fracción de la ET diaria transcurrida a una hora local (concentrada entre 8 y 20 h) */
function etFrac(h) { if (h <= 8) return 0; if (h >= 20) return 1; return .5 - .5 * Math.cos(Math.PI * (h - 8) / 12); }
const hourOf = d => d.getHours() + d.getMinutes() / 60;
function claudeUse(name) { try { return window.claude && window.claude.use ? window.claude.use(name) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
/* ================== Plataforma (Android nativo / web / Claude) ================== */
const N = window.RocioNative || {};
const IS_NATIVE = !!(N.Capacitor && N.Capacitor.isNativePlatform && N.Capacitor.isNativePlatform());
const CONFIG = Object.assign({ version: "1.0.0", platform: "web", aiEndpoint: "", aiKey: "", siteUrl: "", apkUrl: "", privacyUrl: "", contactEmail: "" }, window.ROCIO_CONFIG || {});
const UA = navigator.userAgent || "";
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(UA);
const IS_STANDALONE = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const IS_PWA = CONFIG.platform === "pwa";
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (typeof render === "function") render(); });
window.addEventListener("appinstalled", () => { installEvt = null; S.prefs.installed = true; save(); render(); toast("Rocío instalada en tu móvil"); });
const IN_CLAUDE = !!(window.claude && window.claude.use);
function haptic(kind = "light") {
  try {
    if (IS_NATIVE && N.Haptics) { if (kind === "success") N.Haptics.notification({ type: N.NotificationType.Success }); else N.Haptics.impact({ style: kind === "medium" ? N.ImpactStyle.Medium : N.ImpactStyle.Light }); }
    else if (navigator.vibrate) navigator.vibrate(kind === "success" ? [12, 40, 18] : 10);
  } catch (e) { }
}
function applyTheme() {
  const t = S.prefs.theme || "auto"; if (t === "auto") { if (!IN_CLAUDE) delete document.documentElement.dataset.theme; } else document.documentElement.dataset.theme = t;
  if (IS_NATIVE && N.SystemBars) { const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches); N.SystemBars.setStyle({ style: dark ? N.SystemBarsStyle.Dark : N.SystemBarsStyle.Light }).catch(() => { }); }
}
/* Recordatorios locales en Android: uno por día con las plantas que tocan */
let remT = null;
function scheduleRemindersSoon() { if (!IS_NATIVE) return; clearTimeout(remT); remT = setTimeout(scheduleReminders, 1200); }
async function notifPermission() { if (!IS_NATIVE || !N.LocalNotifications) return "unavailable"; try { return (await N.LocalNotifications.checkPermissions()).display; } catch (e) { return "unavailable"; } }
async function askNotif() {
  if (!IS_NATIVE || !N.LocalNotifications) return false;
  try { const r = await N.LocalNotifications.requestPermissions(); return r.display === "granted"; } catch (e) { return false; }
}
async function scheduleReminders() {
  if (!IS_NATIVE || !N.LocalNotifications) return;
  const LN = N.LocalNotifications;
  try {
    const pend = await LN.getPending(); if (pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) });
    if (S.prefs.notify === false || !S.plants.length) return;
    if ((await notifPermission()) !== "granted") return;
    const [hh, mm] = (S.prefs.hour || "09:00").split(":").map(Number); const now = new Date(), today = isoDate(now), L = sims(), out = [];
    for (let k = 0; k < 10; k++) {
      const d = addDays(today, k), at = new Date(d + "T00:00:00"); at.setHours(hh, mm, 0, 0); if (at <= now) continue;
      const list = L.filter(x => x.s.status === "rain" ? x.s.waitRain.date < d : (x.s.dd <= 0 || x.s.due <= d));
      if (!list.length) continue;
      const urg = list.filter(x => x.s.status === "crit");
      out.push({ id: 1000 + k, channelId: "riego", schedule: { at, allowWhileIdle: true },
        title: list.length === 1 ? "Toca regar: " + list[0].p.name : "Toca regar " + list.length + " plantas",
        body: (urg.length ? "Urgente: " + urg.map(x => x.p.name).join(", ") + ". " : "") + list.map(x => x.p.name + " (" + fmtL(x.s.liters) + ")").join(" · "),
        largeBody: list.map(x => "• " + x.p.name + ": " + fmtL(x.s.liters)).join("\n"), smallIcon: "ic_stat_drop", iconColor: "#2c6a4c" });
    }
    if (out.length) await LN.schedule({ notifications: out });
  } catch (e) { console.warn("avisos", e); }
}
async function getGPS() {
  let pos;
  if (IS_NATIVE && N.Geolocation) {
    const p = await N.Geolocation.requestPermissions({ permissions: ["coarseLocation"] }).catch(() => null);
    if (p && p.coarseLocation === "denied") throw { code: "denied" };
    pos = await N.Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  } else {
    if (!navigator.geolocation) throw { code: "unsupported" };
    pos = await new Promise((ok, ko) => navigator.geolocation.getCurrentPosition(ok, e => ko({ code: e.code === 1 ? "denied" : "error" }), { timeout: 15000, maximumAge: 600000 }));
  }
  const lat = +pos.coords.latitude.toFixed(4), lon = +pos.coords.longitude.toFixed(4); let name = "Mi ubicación", region = lat + ", " + lon;
  try { const j = await fetchJSON("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=es", 6000); name = j.city || j.locality || name; region = [j.principalSubdivision, j.countryName].filter(Boolean).join(", ") || region; } catch (e) { }
  return { name, region, lat, lon };
}
function mdLite(t) {
  const lines = esc(t).split(/\n/); let out = "", inList = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$|[.,;:])/g, "$1<i>$2</i>");
    if (/^\s*([-•*]|\d+\.)\s+/.test(l)) { if (!inList) { out += "<ul>"; inList = true; } out += "<li>" + l.replace(/^\s*([-•*]|\d+\.)\s+/, "") + "</li>"; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    if (/^#{1,4}\s/.test(l)) out += "<h4>" + l.replace(/^#{1,4}\s/, "") + "</h4>";
    else if (l.trim()) out += "<p>" + l + "</p>";
  }
  if (inList) out += "</ul>";
  return out;
}

/* ================== Iconos ================== */
const I = {
  drop: '<path d="M12 2.8c3.3 3.9 6 7.2 6 10.6a6 6 0 0 1-12 0c0-3.4 2.7-6.7 6-10.6z"/>',
  dropFill: '<path fill="currentColor" stroke="none" d="M12 2.8c3.3 3.9 6 7.2 6 10.6a6 6 0 0 1-12 0c0-3.4 2.7-6.7 6-10.6z"/>',
  pin: '<path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19 13 11"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partly: '<path d="M8 6.5a4 4 0 0 1 7.6 1.3"/><path d="M8.5 19h8.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 8.5 19z"/><path d="M6 3v1.5M2.5 6.5H4M3.3 3.8l1 1"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  storm: '<path d="M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 14z"/><path d="m12 15-2 4h3l-2 3"/>',
  fog: '<path d="M4 9h16M4 13h16M6 17h12"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3"/>',
  thermo: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/>',
  chat: '<path d="M5 5h14v10H9l-4 4z"/>',
  stethoscope: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v3a4 4 0 0 0 8 0v-2"/><circle cx="18" cy="12" r="2"/>',
  wand: '<path d="m4 20 11-11M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 10l.6 1.4L21 12l-1.4.6L19 14l-.6-1.4L17 12l1.4-.6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  warn: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.5v.01"/>',
};
const svg = (k, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k] || ""}</svg>`;
/* Glifos por categoría */
const G = {
  huerto: '<path d="M12 21v-8"/><path d="M12 13c-4 0-7-3-7-7 4 0 7 3 7 7zM12 11c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M7 21h10"/>',
  aromaticas: '<path d="M12 21V4"/><path d="M12 8c-3 0-5-2-5-4 3 0 5 2 5 4zM12 8c3 0 5-2 5-4-3 0-5 2-5 4zM12 14c-3 0-5-2-5-4 3 0 5 2 5 4zM12 14c3 0 5-2 5-4-3 0-5 2-5 4z"/>',
  frutales: '<circle cx="12" cy="14" r="6.5"/><path d="M12 7.5V4M12 6c1-2 3-3 5-2.5-1 2-3 3-5 2.5z"/>',
  interior: '<path d="M7 15h10l-1.5 6h-7z"/><path d="M12 15V9M12 11c-3.5 0-5.5-2.5-5.5-6 3.5 0 5.5 2.5 5.5 6zM12 9c0-3 2-5 5.5-5 0 3-2 5-5.5 5z"/>',
  suculentas: '<path d="M10 21V8a2 2 0 0 1 4 0v13M14 12h2a2 2 0 0 0 2-2V8M10 14H8a2 2 0 0 1-2-2v-1M7 21h10"/>',
  flores: '<circle cx="12" cy="9" r="2.2"/><path d="M12 6.8c0-2.5 1.2-3.8 0-3.8s0 1.3 0 3.8zM12 6.8C13 4 15.8 3.6 15.6 5.5 15.4 7 13.6 7.6 14.1 8.3M9.9 8.3C10.4 7.6 8.6 7 8.4 5.5 8.2 3.6 11 4 12 6.8M14.1 9.7c1.8 1 2.8 3 1 3.3-1.4.2-2.4-1.3-3.1-1.8M9.9 9.7c-1.8 1-2.8 3-1 3.3 1.4.2 2.4-1.3 3.1-1.8"/><path d="M12 11.2V21M12 17c-2 0-3.5-1-4-3 2 0 3.5 1 4 3z"/>',
  arbustos: '<path d="M5 17a4 4 0 0 1 1-7.8A5 5 0 0 1 15.5 7 4 4 0 0 1 19 14a3 3 0 0 1-2 3z"/><path d="M12 17v4M8 21h8"/>',
  trepadoras: '<path d="M6 21c0-6 12-6 12-12 0-3-2-5-4-5"/><path d="M9 15c-2 0-3.5-1.3-3.5-3 2 0 3.5 1.3 3.5 3zM15 10c2 0 3.5-1.3 3.5-3-2 0-3.5 1.3-3.5 3z"/>',
  arboles: '<path d="M12 21v-6"/><path d="M12 3 6 11h3l-4 5h14l-4-5h3z"/>',
  cesped: '<path d="M3 20h18M5 20l-1-7M8 20l1-9M11 20l-1-11M14 20l1-8M17 20l-1-10M20 20l1-6"/>',
  orquideas: '<path d="M12 10c-1.5-3-5-3.5-6-1.5 1.5 1 4 1.6 6 1.5zM12 10c1.5-3 5-3.5 6-1.5-1.5 1-4 1.6-6 1.5zM12 10c-1-2.5 0-5 0-6 0 1 1 3.5 0 6zM12 10c-2 1.5-2.5 4-1 5 1-.5 1.5-3 1-5zM12 10c2 1.5 2.5 4 1 5-1-.5-1.5-3-1-5z"/><path d="M12 15v6"/>',
  bonsai: '<path d="M5 18h14l-1.5 3h-11z"/><path d="M12 18c0-3-3-4-3-7M12 18c0-3 2-5 4-6"/><path d="M5 9a3 3 0 0 1 5-2.5A3 3 0 0 1 15 8a2.5 2.5 0 0 1 4 2 2 2 0 0 1-2 2H7a2 2 0 0 1-2-3z"/>',
  carnivoras: '<path d="M12 21v-7"/><path d="M12 14c-4 0-6-3-6-6l2 1 1-2 1 2 2-1M12 14c4 0 6-3 6-6l-2 1-1-2-1 2-2-1"/>',
  otra: '<path d="M12 21v-8"/><path d="M12 13c-4 0-7-3-7-7 4 0 7 3 7 7zM12 11c0-4 3-7 7-7 0 4-3 7-7 7z"/>',
};
const glyph = c => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[c] || G.otra}</svg>`;
const CAT_LABEL = { huerto: "Huerto", aromaticas: "Aromáticas", frutales: "Frutales", interior: "Interior", suculentas: "Cactus y suculentas", flores: "Flores", arbustos: "Arbustos", trepadoras: "Trepadoras", arboles: "Árboles y palmeras", cesped: "Césped", orquideas: "Orquídeas", bonsai: "Bonsáis", carnivoras: "Carnívoras", otra: "Otras" };
const CAT_TINT = { huerto: "#3f8a4f", aromaticas: "#5b8f3a", frutales: "#c26a2c", interior: "#2c6a4c", suculentas: "#6b8a3a", flores: "#b8477a", arbustos: "#457a52", trepadoras: "#4c8a6a", arboles: "#3a6b46", cesped: "#4f9a3f", orquideas: "#9a4fa8", bonsai: "#6b5a3a", carnivoras: "#a0442f", otra: "#2c6a4c" };

/* ================== Catálogo ================== */
const CATALOG = (window.__CATALOG__ || "").trim().split("\n").filter(Boolean).map(l => {
  const [id, n, sci, cat, kc, p, minC, maxC, place, sun, sub, d, size, note] = l.split("|");
  return { id, n, sci, cat, kc: +kc, p: +p, minC: +minC, maxC: +maxC, place, sun, sub, d: +d, size, note };
});
const CAT_BY_ID = Object.fromEntries(CATALOG.map(c => [c.id, c]));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ================== Parámetros físicos ================== */
const SUB_AW = { universal: .20, peat: .24, cactus: .12, soil: .14, bark: .10, acid: .22 }; // agua fácilmente disponible (fracción de volumen)
const SUB_LABEL = { universal: "Universal", peat: "Turba / fibra de coco", cactus: "Cactus (drenante)", soil: "Tierra de jardín", bark: "Corteza (orquídeas)", acid: "Ácido (acidófilas)" };
const SOIL_AW = { sand: .08, loam: .14, clay: .17 }; // compatibilidad con plantas antiguas
/* 12 clases texturales USDA (arena y arcilla típicas de cada clase) */
const TEXTURES = {
  arena: { n: "Arenoso", S: .92, C: .03, t: "No forma bola: se deshace entre los dedos" },
  arenoso_franco: { n: "Arenoso franco", S: .82, C: .06, t: "Forma una bola frágil" },
  franco_arenoso: { n: "Franco arenoso", S: .65, C: .10, t: "Bola que se rompe al tocarla; áspero" },
  franco: { n: "Franco", S: .40, C: .20, t: "Bola estable, tacto suave; el suelo «ideal»" },
  franco_limoso: { n: "Franco limoso", S: .20, C: .15, t: "Tacto sedoso, como harina" },
  limo: { n: "Limoso", S: .07, C: .06, t: "Muy sedoso; se encostra al secarse" },
  franco_arcillo_arenoso: { n: "Franco arcillo-arenoso", S: .60, C: .27, t: "Algo pegajoso pero áspero" },
  franco_arcilloso: { n: "Franco arcilloso", S: .33, C: .34, t: "Forma un churro que se agrieta al doblarlo" },
  franco_arcillo_limoso: { n: "Franco arcillo-limoso", S: .10, C: .34, t: "Churro sedoso y algo pegajoso" },
  arcillo_arenoso: { n: "Arcillo-arenoso", S: .52, C: .42, t: "Pegajoso con granos de arena" },
  arcillo_limoso: { n: "Arcillo-limoso", S: .07, C: .47, t: "Muy pegajoso y sedoso" },
  arcilla: { n: "Arcilloso", S: .20, C: .60, t: "Churro flexible, muy pegajoso y brillante" },
};
/* Saxton & Rawls (2006): capacidad de campo y punto de marchitez a partir de arena, arcilla y materia orgánica */
function saxton(S, C, OM) {
  OM = clamp(+OM || 0, 0, 8);
  const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
  const wp = t1500 + (0.14 * t1500 - 0.02);
  const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
  const fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
  return { fc: clamp(fc, .03, .6), wp: clamp(wp, .01, .45), aw: clamp(fc - wp, .02, .3) };
}
function soilInfo(p) {
  const gravel = clamp(+p.gravel || 0, 0, 80) / 100;
  if (p.awOverride > 0) return { aw: p.awOverride / 1000, label: "Agua útil medida: " + p.awOverride + " mm/m", fc: null, wp: null };
  if (SOIL_AW[p.soil]) return { aw: SOIL_AW[p.soil] * (1 - gravel), label: { sand: "Arenoso", loam: "Franco", clay: "Arcilloso" }[p.soil] };
  let S, C, label;
  if (p.soil === "custom") { S = clamp(+p.sand || 40, 0, 100) / 100; C = clamp(+p.clay || 20, 0, 100 - S * 100) / 100; label = `Análisis: ${Math.round(S * 100)} % arena, ${Math.round(C * 100)} % arcilla, ${Math.round((1 - S - C) * 100)} % limo`; }
  else { const t = TEXTURES[p.soil] || TEXTURES.franco; S = t.S; C = t.C; label = t.n; }
  const r = saxton(S, C, p.om != null && p.om !== "" ? +p.om : 2);
  return { aw: r.aw * (1 - gravel), fc: r.fc, wp: r.wp, label: label + (gravel ? `, ${Math.round(gravel * 100)} % piedras` : "") };
}
/* Componentes de sustrato: agua fácilmente disponible por volumen */
const MIX = {
  turba: { n: "Turba", aw: .25 }, coco: { n: "Fibra de coco", aw: .23 }, compost: { n: "Compost", aw: .20 }, humus: { n: "Humus de lombriz", aw: .22 },
  tierra: { n: "Tierra de jardín", aw: .14 }, vermiculita: { n: "Vermiculita", aw: .24 }, perlita: { n: "Perlita", aw: .05 }, arena: { n: "Arena gruesa", aw: .04 },
  corteza: { n: "Corteza de pino", aw: .08 }, arlita: { n: "Arlita", aw: .06 }, akadama: { n: "Akadama", aw: .14 }, kanuma: { n: "Kanuma", aw: .15 }, pomez: { n: "Pómez", aw: .07 }, musgo: { n: "Musgo sphagnum", aw: .35 },
};
function mixAW(mix) { let t = 0, a = 0; for (const k in mix) { const v = +mix[k] || 0; if (MIX[k] && v > 0) { t += v; a += v * MIX[k].aw; } } return t ? a / t : .2; }
function subInfo(p) { if (p.sub === "mix" && p.mix) return { aw: mixAW(p.mix), label: "Mezcla: " + Object.entries(p.mix).filter(([, v]) => v > 0).map(([k, v]) => v + " % " + MIX[k].n.toLowerCase()).join(", ") }; return { aw: SUB_AW[p.sub] || .2, label: SUB_LABEL[p.sub] || "Universal" }; }
const MAT_K = { plastic: 1.0, terracotta: 1.18, fabric: 1.12, tray: 1.05, glazed: 1.0 };
const SUN_K = { out: { full: 1, part: .75, shade: .55 }, cov: { full: .9, part: .7, shade: .5 }, in: { full: 1.25, part: 1, shade: .7 } };
const RAIN_EXPO = { out: 1, cov: .15, in: 0 };
const ROOT_DEF = { huerto: 40, frutales: 60, arboles: 60, cesped: 15, flores: 30, arbustos: 50, trepadoras: 50, aromaticas: 30 };

function spec(p) {
  if (p.custom) return Object.assign({ cat: "otra", note: "" }, p.custom);
  return CAT_BY_ID[p.type] || { id: "x", n: "Planta", sci: "", cat: "otra", kc: .8, p: .5, minC: 2, maxC: 36, note: "" };
}
function params(p) {
  const S = spec(p);
  let taw, area;
  if (p.cont === "ground") { taw = (+p.root || 30) * 10 * soilInfo(p).aw; area = +p.area || 1; }
  else { taw = (+p.depth || 15) * 10 * subInfo(p).aw; const r = (+p.diam || 15) / 200; area = Math.PI * r * r; }
  const pDep = clamp(+S.p || .5, .1, .95);
  const k = (+S.kc || .8) * SUN_K[p.place || "out"][p.sun || "full"] * (+p.size || 1) * (p.cont === "pot" ? (MAT_K[p.mat] || 1) : 1) * (p.cal || 1);
  return { S, taw, raw: taw * pDep, area, k, drain: p.cont === "pot" ? 1.1 : 1 };
}

/* ================== Estado y almacenamiento ================== */
const LS = "rocio.v2";
const DEFAULT_LOC = { name: "Salamanca", region: "Castilla y León, España", lat: 40.9649, lon: -5.6631 };
let S = { v: 2, loc: null, plants: [], wx: null, wxlog: {}, chat: [], prefs: { hour: "09:00" }, seeded: false };
let DB = null, saveT = null, thumbs = {};
function lsGet() { try { const r = localStorage.getItem(LS); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function lsSet() { try { localStorage.setItem(LS, JSON.stringify(S)); localStorage.setItem(LS + ".th", JSON.stringify(thumbs)); } catch (e) { } }
function save() {
  lsSet(); scheduleRemindersSoon();
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    if (!DB) return;
    try {
      const body = JSON.parse(JSON.stringify({ v: 2, loc: S.loc, plants: S.plants, prefs: S.prefs, seeded: S.seeded, chat: S.chat.slice(-30), schedule: buildSchedule(), savedAt: new Date().toISOString() }));
      await DB.doc("garden/state").set(body);
      await DB.doc("garden/weather").set(JSON.parse(JSON.stringify({ wx: S.wx, wxlog: pruneLog(S.wxlog) })));
    } catch (e) { console.warn("db", e && e.code); }
  }, 900);
}
async function saveThumb(id, dataUrl) {
  thumbs[id] = dataUrl; lsSet();
  if (DB) { try { await DB.doc("garden/thumb-" + id).set({ d: dataUrl }); } catch (e) { } }
}
function pruneLog(log) { const keep = {}, min = addDays(isoDate(new Date()), -75); for (const k in log) if (k >= min) keep[k] = log[k]; return keep; }
async function initDB() {
  DB = await claudeUse("db");
  if (!DB) return;
  try {
    const [st, w] = await Promise.all([DB.doc("garden/state").get(), DB.doc("garden/weather").get()]);
    if (st.exists) { const d = st.data(); S.loc = d.loc || S.loc; S.plants = d.plants || []; S.prefs = d.prefs || S.prefs; S.seeded = !!d.seeded; S.chat = d.chat || []; }
    if (w.exists) { const d = w.data(); S.wx = d.wx || S.wx; S.wxlog = Object.assign({}, d.wxlog || {}, S.wxlog); }
    const need = S.plants.filter(p => !thumbs[p.id] && p.hasThumb).map(p => p.id);
    await Promise.all(need.map(async id => { try { const t = await DB.doc("garden/thumb-" + id).get(); if (t.exists) thumbs[id] = t.data().d; } catch (e) { } }));
    lsSet(); render();
  } catch (e) { console.warn("db load", e && e.code); }
}

/* ================== Tiempo ================== */
const ACCU = "AccuWeather®";
let wxBusy = false, wxErr = null;
function ra(latDeg, iso) { // radiación extraterrestre FAO-56, MJ/m²/día
  const d = new Date(iso + "T12:00:00"), J = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const phi = latDeg * Math.PI / 180, dr = 1 + .033 * Math.cos(2 * Math.PI * J / 365), dl = .409 * Math.sin(2 * Math.PI * J / 365 - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(dl), -1, 1));
  return 24 * 60 / Math.PI * .082 * dr * (ws * Math.sin(phi) * Math.sin(dl) + Math.cos(phi) * Math.cos(dl) * Math.sin(ws));
}
function hargreaves(lat, iso, tmax, tmin) { if (tmax == null || tmin == null) return null; const tm = (tmax + tmin) / 2; return Math.max(0, .0023 * .408 * ra(lat, iso) * (tm + 17.8) * Math.sqrt(Math.max(0, tmax - tmin))); }
function wxKind(code, text) {
  const t = norm(text);
  if (code != null) { if (code >= 95) return "storm"; if (code >= 71 && code <= 86 && !(code >= 80 && code <= 82)) return "snow"; if (code >= 51) return "rain"; if (code >= 45) return "fog"; if (code === 3) return "cloud"; if (code >= 1) return "partly"; return "sun"; }
  if (/torment|thunder|storm/.test(t)) return "storm"; if (/niev|snow|flurr|sleet|hielo/.test(t)) return "snow";
  if (/lluv|rain|shower|chubas|drizz|lloviz/.test(t)) return "rain"; if (/niebl|fog|haze|brum|bruma/.test(t)) return "fog";
  if (/(partly|interval|parcial|some|intermittent|mostly sunny|hazy sun|poco nub|algunas nub)/.test(t)) return "partly";
  if (/nub|cloud|cubier|overcast|dreary/.test(t)) return "cloud"; return "sun";
}
function esTxt(text, kind) { if (!text) return KIND_TXT[kind] || ""; return /\b(sunny|cloudy|clear|rain|showers?|fog|snow|storms?|thunder|overcast|haze|hazy|drizzle|flurries|sleet|mostly|partly|intermittent|dreary|windy)\b/i.test(text) ? (KIND_TXT[kind] || "") : text; }
const KIND_TXT = { sun: "Despejado", partly: "Intervalos nubosos", cloud: "Nublado", fog: "Niebla", rain: "Lluvia", snow: "Nieve", storm: "Tormenta" };
const WMO_TXT = { 0: "Despejado", 1: "Casi despejado", 2: "Intervalos nubosos", 3: "Nublado", 45: "Niebla", 48: "Niebla", 51: "Llovizna débil", 53: "Llovizna", 55: "Llovizna intensa", 61: "Lluvia débil", 63: "Lluvia", 65: "Lluvia fuerte", 71: "Nieve débil", 73: "Nieve", 75: "Nevada", 80: "Chubascos", 81: "Chubascos", 82: "Chubascos fuertes", 95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta con granizo" };

async function fetchJSON(url, ms = 6000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); } }
async function wxOpenMeteo(loc) {
  const j = await fetchJSON("https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
    "&daily=et0_fao_evapotranspiration,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,weather_code,wind_speed_10m_max,relative_humidity_2m_mean" +
    "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&past_days=30&forecast_days=8&timezone=auto");
  const d = j.daily, today = isoDate(new Date());
  const days = d.time.map((t, i) => ({ date: t, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], precip: d.precipitation_sum[i], prob: d.precipitation_probability_max[i], et0: d.et0_fao_evapotranspiration[i], kind: wxKind(d.weather_code[i]), text: WMO_TXT[d.weather_code[i]] || "", wind: d.wind_speed_10m_max[i], rh: d.relative_humidity_2m_mean[i], src: t < today ? "obs" : "fc" }));
  const c = j.current || {};
  return { source: "Open‑Meteo", et0src: "FAO Penman‑Monteith", current: { temp: c.temperature_2m, rh: c.relative_humidity_2m, wind: c.wind_speed_10m, kind: wxKind(c.weather_code), text: WMO_TXT[c.weather_code] || "" }, days };
}

/* --- AccuWeather a través del conector del usuario --- */
function flat(o, pre = "", out = {}, depth = 0) {
  if (o == null || depth > 5) return out;
  if (Array.isArray(o)) { o.slice(0, 3).forEach((v, i) => flat(v, pre + "[" + i + "]", out, depth + 1)); return out; }
  if (typeof o === "object") { for (const k in o) flat(o[k], pre ? pre + "." + k : k, out, depth + 1); return out; }
  out[pre] = o; return out;
}
function findArrays(o, acc = [], depth = 0) { if (!o || depth > 6) return acc; if (Array.isArray(o)) { if (o.length && typeof o[0] === "object") acc.push(o); o.forEach(v => findArrays(v, acc, depth + 1)); } else if (typeof o === "object") for (const k in o) findArrays(o[k], acc, depth + 1); return acc; }
function pick(f, inc, exc) { for (const k in f) { if (typeof f[k] !== "number") continue; if (inc.every(r => r.test(k)) && !(exc || []).some(r => r.test(k))) return { k, v: f[k] }; } return null; }
function toC(f, hit) { if (!hit) return null; const u = f[hit.k.replace(/Value$/i, "Unit")] || f[hit.k.replace(/\.?value$/i, ".unit")]; return /^F/i.test(String(u || "")) ? (hit.v - 32) * 5 / 9 : hit.v; }
function dateOf(item) {
  const f = flat(item);
  for (const k in f) { if (/(^|\.)(date|datetime|localobservationdatetime|day|time|validdate|forecastdate)$/i.test(k) && typeof f[k] === "string" && /^\d{4}-\d{2}-\d{2}/.test(f[k])) return f[k].slice(0, 10); }
  for (const k in f) { if (/epoch/i.test(k) && typeof f[k] === "number") return isoDate(new Date(f[k] * (f[k] < 1e12 ? 1000 : 1))); }
  for (const k in f) { if (typeof f[k] === "string" && /^\d{4}-\d{2}-\d{2}/.test(f[k])) return f[k].slice(0, 10); }
  return null;
}
function parseDailyHeuristic(payload) {
  const arrs = findArrays(payload);
  for (const arr of arrs) {
    const out = [];
    for (const it of arr) {
      const f = flat(it), date = dateOf(it); if (!date) continue;
      const tmax = toC(f, pick(f, [/(max|high|maximum)/i, /temp/i], [/realfeel|feel|shade|apparent|wetbulb|dew/i]) || pick(f, [/^(high|max|tmax|temperaturemax|maxtemp|temp_max)$/i]));
      const tmin = toC(f, pick(f, [/(min|low|minimum)/i, /temp/i], [/realfeel|feel|shade|apparent|wetbulb|dew/i]) || pick(f, [/^(low|min|tmin|temperaturemin|mintemp|temp_min)$/i]));
      if (tmax == null || tmin == null) continue;
      let precip = null; const liq = Object.keys(f).filter(k => typeof f[k] === "number" && /(totalliquid|rain|precip)/i.test(k) && /value|mm|amount|total|sum/i.test(k) && !/prob|chance|hours|percent/i.test(k));
      if (liq.length) { const pref = liq.filter(k => /totalliquid/i.test(k)); const use = pref.length ? pref : liq.filter(k => /rain/i.test(k)).length ? liq.filter(k => /rain/i.test(k)) : liq; precip = use.reduce((a, k) => a + (/(in|inch)$/i.test(String(f[k.replace(/Value$/i, "Unit")] || "")) ? f[k] * 25.4 : f[k]), 0); }
      const probs = Object.keys(f).filter(k => typeof f[k] === "number" && /(prob|chance)/i.test(k) && /(precip|rain)/i.test(k)).map(k => f[k]);
      const prob = probs.length ? Math.max(...probs) : null;
      const wk = Object.keys(f).filter(k => typeof f[k] === "number" && /wind/i.test(k) && /speed.*value|speed$/i.test(k) && !/gust/i.test(k)).map(k => f[k]);
      const txtK = Object.keys(f).find(k => typeof f[k] === "string" && /(iconphrase|phrase|summary|condition|text|description|shortphrase)$/i.test(k) && !/link|url/i.test(k));
      const text = txtK ? f[txtK] : "";
      out.push({ date, tmax, tmin, precip, prob, wind: wk.length ? Math.max(...wk) : null, text, kind: wxKind(null, text) });
    }
    if (out.length >= 3) return out;
  }
  return null;
}
function parseCurrentHeuristic(payload) {
  const f = flat(payload);
  const t = pick(f, [/temp/i, /(metric\.value|value|celsius|current|^temperature$)/i], [/realfeel|feel|shade|apparent|dew|wetbulb|max|min|past|summary|departure/i]) || pick(f, [/temp/i], [/realfeel|feel|max|min|past|dew/i]);
  if (!t) return null;
  const rh = pick(f, [/humid/i], [/indoor/i]); const w = pick(f, [/wind/i, /speed/i], [/gust|imperial/i]);
  const txtK = Object.keys(f).find(k => typeof f[k] === "string" && /(weathertext|phrase|condition|text|summary)$/i.test(k) && !/link|url/i.test(k));
  return { temp: /imperial/i.test(t.k) ? (t.v - 32) * 5 / 9 : t.v, rh: rh ? rh.v : null, wind: w ? w.v : null, text: txtK ? f[txtK] : "", kind: wxKind(null, txtK ? f[txtK] : "") };
}
function buildInput(schema, ctx) {
  const props = (schema && schema.properties) || {}, req = (schema && schema.required) || [], out = {};
  for (const [name, def] of Object.entries(props)) {
    const n = norm(name).replace(/[_\-\s]/g, ""), type = def.type, en = def.enum;
    let v;
    if (/^(lat|latitude)$/.test(n)) v = ctx.lat;
    else if (/^(lon|lng|long|longitude)$/.test(n)) v = ctx.lon;
    else if (/(locationkey|^key$|locationid|cityid|placeid)/.test(n)) v = ctx.key;
    else if (/^(q|query|location|city|search|text|name|place|address|locationquery|locationname|cityname)$/.test(n)) {
      if (type === "object" && def.properties) v = buildInput(def, ctx); else v = ctx.query;
    }
    else if (/(days|ndays|forecastdays|numdays|count|limit|period)/.test(n)) { let d = 10; if (def.maximum) d = Math.min(d, def.maximum); if (en) d = en.map(Number).filter(x => !isNaN(x)).sort((a, b) => b - a).find(x => x <= 15) ?? en[0]; v = (type === "string") ? String(d) : d; }
    else if (/(metric|units?|unitsystem)/.test(n)) { v = type === "boolean" ? true : en ? (en.find(e => /metric|celsius|^c$|si/i.test(e)) ?? en[0]) : "metric"; }
    else if (/(language|lang|locale)/.test(n)) { v = en ? (en.find(e => /^es/i.test(e)) ?? undefined) : "es-es"; }
    else if (/^(details|detailed|includedetails)$/.test(n)) v = true;
    else if (/(hours|hourcount)/.test(n)) v = def.maximum ? Math.min(24, def.maximum) : 24;
    else if (type === "object" && def.properties) { const sub = buildInput(def, ctx); if (Object.keys(sub).length) v = sub; }
    if (v !== undefined && v !== null) out[name] = v;
    else if (req.includes(name)) { if (en) out[name] = en[0]; else if (def.default !== undefined) out[name] = def.default; }
  }
  return out;
}
function needsKey(schema) { const req = (schema && schema.required) || []; return req.some(n => /(locationkey|^key$|locationid|cityid)/.test(norm(n).replace(/[_\-\s]/g, ""))); }
function findKey(payload) { const f = flat(payload); for (const k in f) { if (/(^|\.)(key|locationkey|location_key|id)$/i.test(k.split("[0]").join("")) && (typeof f[k] === "string" || typeof f[k] === "number") && String(f[k]).length >= 3) return String(f[k]); } return null; }
let ACCU_TOOLS = null;
async function accuTools(mcp) {
  if (ACCU_TOOLS) return ACCU_TOOLS;
  const lt = await mcp.listTools(ACCU); const srv = (lt.servers || []).find(s => s.server === ACCU);
  if (!srv) throw { code: "server_not_connected" };
  const names = (srv.tools || []).map(t => t.name);
  const find = re => names.find(n => re.test(n));
  ACCU_TOOLS = { daily: find(/daily/i), current: find(/current/i), hist: find(/histor/i), search: find(/search/i), hourly: find(/hourly/i) };
  return ACCU_TOOLS;
}
async function describe(mcp, tool) { try { return (await mcp.describeTool(ACCU, tool)).inputSchema || null; } catch (e) { return null; } }
async function callAccu(mcp, tool, ctx) {
  let schema = await describe(mcp, tool);
  if (!schema) { // aún sin permiso: la primera llamada lo pide
    try { const r = await mcp.callTool(ACCU, tool, { query: ctx.query, latitude: ctx.lat, longitude: ctx.lon }); return r.payload ?? r; }
    catch (e) { if (e && e.code !== "tool_error" && e.code !== "bad_request") throw e; }
    schema = await describe(mcp, tool);
  }
  if (schema && needsKey(schema) && !ctx.key && ACCU_TOOLS.search && tool !== ACCU_TOOLS.search) {
    const ss = await describe(mcp, ACCU_TOOLS.search);
    try { const r = await mcp.callTool(ACCU, ACCU_TOOLS.search, buildInput(ss, ctx)); ctx.key = findKey(r.payload ?? r); if (ctx.key && S.loc) { S.loc.key = ctx.key; } } catch (e) { }
  }
  const input = buildInput(schema, ctx);
  const r = await mcp.callTool(ACCU, tool, input, { cache: { staleTime: 30 * 6e4, gcTime: 6 * 36e5 } });
  return r.payload ?? r;
}
async function aiNormalize(raw, kind) {
  const sample = await claudeUse("sample"); if (!sample) return null;
  const txt = JSON.stringify(raw).slice(0, 30000);
  const schema = kind === "current" ? '{"temp":number,"rh":number|null,"wind":number|null,"text":"string en español"}'
    : '{"days":[{"date":"YYYY-MM-DD","tmax":number,"tmin":number,"precip":number|null,"prob":number|null,"wind":number|null,"text":"string en español"}]}';
  const prompt = "Convierte esta respuesta de una API meteorológica a JSON con exactamente este esquema: " + schema +
    ". Temperaturas en °C, lluvia en mm (suma día y noche; null si no aparece), probabilidad 0-100, viento en km/h. " +
    (kind === "hist" ? "Son observaciones pasadas: agrégalas por día local (máxima, mínima y lluvia total por fecha). " : "") +
    "No inventes valores: usa null si falta un dato. Responde SOLO con el JSON.\n\nDATOS:\n" + txt;
  try { return await sample.json(prompt, { modelTier: "quick" }); } catch (e) { return null; }
}
/* Formato real del conector AccuWeather (widgets-*-claude) */
function accuKind(ic) {
  if (ic == null) return null;
  if ([1, 2, 5, 33, 34].includes(ic)) return "sun"; if ([3, 4, 35, 36].includes(ic)) return "partly";
  if ([6, 7, 8, 37, 38].includes(ic)) return "cloud"; if (ic === 11) return "fog";
  if ([15, 16, 17, 41, 42].includes(ic)) return "storm"; if ((ic >= 19 && ic <= 25) || ic === 29 || ic === 43 || ic === 44) return "snow";
  if ([12, 13, 14, 18, 26, 39, 40].includes(ic)) return "rain"; return null;
}
const numIn = s => { const m = String(s ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
function parseAccuDaily(p) {
  if (!p || !Array.isArray(p.dailyForecast) || !p.dailyForecast.length) return null;
  const out = p.dailyForecast.map(it => {
    const d = it.day || {}, n = it.night || {}, de = d.extended || {}, ne = n.extended || {};
    const rain = (de.rainValue ?? 0) + (ne.rainValue ?? 0) + ((de.snowValue ?? 0) + (ne.snowValue ?? 0)) * 10;
    return { date: String(it.date || "").slice(0, 10), tmax: d.temperature ?? null, tmin: n.temperature ?? null, precip: (de.rainValue == null && ne.rainValue == null) ? null : +rain.toFixed(1),
      prob: Math.max(d.rainProbabilityValue ?? 0, n.rainProbabilityValue ?? 0), wind: Math.max(numIn(de.wind) ?? 0, numIn(ne.wind) ?? 0) || null,
      text: d.iconPhrase || d.phrase || "", kind: accuKind(d.icon) || wxKind(null, d.iconPhrase) };
  }).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.tmax != null && x.tmin != null);
  return out.length ? out : null;
}
function parseAccuCurrent(p) {
  const c = p && p.currentConditions; if (!c || c.temperatureValue == null) return null; const e = c.extended || {};
  return { temp: c.temperatureValue, rh: e.humidityValue ?? null, wind: e.windValue ?? numIn(e.wind), text: c.phrase || "", kind: accuKind(c.iconCode) || wxKind(null, c.phrase) };
}
async function accuDirect(mcp, tool, queryParams) { const r = await mcp.callTool(ACCU, tool, { queryParams }, { cache: { staleTime: 30 * 6e4, gcTime: 6 * 36e5 } }); return r.payload ?? r; }
async function accuKey(mcp, T, loc) {
  if (loc.key) return loc.key; if (!T.search) return null;
  for (const q of [[loc.name, (loc.region || "").split(",")[0]].filter(Boolean).join(", "), loc.name]) {
    try { const r = await accuDirect(mcp, T.search, { query: q }); const k = r && r.results && r.results[0] && r.results[0].locationKey; if (k) { loc.key = String(k); return loc.key; } } catch (e) { if (e && e.code && e.code !== "tool_error") throw e; }
  }
  return null;
}
async function wxAccu(loc) {
  const mcp = await claudeUse("mcp"); if (!mcp) throw { code: "no_mcp" };
  const T = await accuTools(mcp); if (!T.daily) throw { code: "no_tool" };
  const key = await accuKey(mcp, T, loc);
  if (key) {
    const qp = { locationKey: key, unit: "metric", lang: "es" };
    const daily = await accuDirect(mcp, T.daily, qp);
    let days = parseAccuDaily(daily) || parseDailyHeuristic(daily);
    if (days) {
      let current = null; if (T.current) { try { current = parseAccuCurrent(await accuDirect(mcp, T.current, qp)); } catch (e) { } }
      const today = isoDate(new Date()); days.forEach(d => { d.src = d.date < today ? "obs" : "fc"; });
      return { source: "AccuWeather", et0src: "Hargreaves‑Samani (FAO‑56)", current: current || {}, days };
    }
  }
  return wxAccuGeneric(loc);
}
async function wxAccuGeneric(loc) {
  const mcp = await claudeUse("mcp"); if (!mcp) throw { code: "no_mcp" };
  const T = await accuTools(mcp);
  const ctx = { lat: loc.lat, lon: loc.lon, key: loc.key, query: [loc.name, (loc.region || "").split(",").pop().trim()].filter(Boolean).join(", ") };
  if (!T.daily) throw { code: "no_tool" };
  const dailyRaw = await callAccu(mcp, T.daily, ctx);
  let days = parseDailyHeuristic(dailyRaw);
  if (!days) { const n = await aiNormalize(dailyRaw, "daily"); days = n && Array.isArray(n.days) ? n.days.map(d => Object.assign(d, { kind: wxKind(null, d.text) })) : null; }
  if (!days || !days.length) throw { code: "parse" };
  let current = null;
  if (T.current) { try { const c = await callAccu(mcp, T.current, ctx); current = parseCurrentHeuristic(c); if (!current) { const n = await aiNormalize(c, "current"); if (n && n.temp != null) current = Object.assign(n, { kind: wxKind(null, n.text) }); } } catch (e) { } }
  // Observaciones de ayer (una vez al día)
  const today = isoDate(new Date());
  if (false && T.hist && S.wxHistAt !== today) {
    try {
      const h = await callAccu(mcp, T.hist, ctx);
      let obs = parseDailyHeuristic(h);
      if (!obs) { const n = await aiNormalize(h, "hist"); obs = n && Array.isArray(n.days) ? n.days : null; }
      if (obs) { obs.filter(o => o.date < today).forEach(o => mergeDay(Object.assign({}, o, { src: "obs" }), loc.lat)); S.wxHistAt = today; }
    } catch (e) { }
  }
  days.forEach(d => { d.src = d.date < today ? "obs" : "fc"; });
  return { source: "AccuWeather", et0src: "Hargreaves‑Samani (FAO‑56)", current: current || {}, days };
}
function mergeDay(d, lat) {
  if (!d || !d.date) return;
  const prev = S.wxlog[d.date];
  if (prev && prev.src === "obs" && d.src !== "obs") return;
  const et0 = d.et0 != null ? d.et0 : hargreaves(lat, d.date, d.tmax, d.tmin);
  S.wxlog[d.date] = { tmax: d.tmax, tmin: d.tmin, precip: d.precip ?? (prev ? prev.precip : null), prob: d.prob ?? null, et0: et0 != null ? +et0.toFixed(2) : null, kind: d.kind, text: d.text || "", wind: d.wind ?? null, rh: d.rh ?? null, src: d.src || "fc" };
}
async function refreshWeather(force) {
  if (!S.loc || wxBusy) return;
  if (!force && S.wx && S.wx.fetchedAt && Date.now() - S.wx.fetchedAt < 60 * 6e4 && S.wx.lat === S.loc.lat) { render(); return; }
  wxBusy = true; wxErr = null; renderWxStatus();
  let res = null;
  try { res = await wxOpenMeteo(S.loc); }
  catch (e) { try { res = await wxAccu(S.loc); } catch (e2) { wxErr = (e2 && e2.code) || "error"; } }
  if (res) {
    res.days.forEach(d => mergeDay(d, S.loc.lat));
    S.wx = { source: res.source, et0src: res.et0src, current: res.current, fetchedAt: Date.now(), lat: S.loc.lat };
    save();
  }
  wxBusy = false; render();
}
function wxDay(date) { return S.wxlog[date] || null; }
function wxAvgEt0() { const v = Object.values(S.wxlog).map(d => d.et0).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1.6; }

/* ================== Modelo de balance hídrico (FAO‑56) ================== */
function dayForce(date, p, P) {
  const w = wxDay(date); const et0 = w && w.et0 != null ? w.et0 : wxAvgEt0();
  let ref = et0, rain = 0;
  if (p.place === "in") {
    const tm = w && w.tmax != null ? (w.tmax + w.tmin) / 2 : 15;
    const heat = p.heat === "on" || (p.heat !== "off" && tm < 14);
    ref = (.28 * et0 + .45) * (heat ? 1.3 : 1);
  } else if (w && w.precip != null) rain = Math.max(0, w.precip - (p.cont === "pot" ? .8 : 1.5)) * RAIN_EXPO[p.place || "out"];
  return { ref, rain, w };
}
const ksF = (Dr, taw, raw) => Dr <= raw ? 1 : Math.max(.05, (taw - Dr) / (taw - raw));
function simulate(p, now = new Date()) {
  const P = params(p), today = isoDate(now), hNow = hourOf(now);
  const evs = [...new Set([...(p.log || []).map(e => e.t), p.last])].filter(Boolean).map(t => new Date(t)).filter(d => d <= now).sort((a, b) => a - b);
  const lastEv = evs.length ? evs[evs.length - 1] : now;
  let start = evs.length ? isoDate(evs[0]) : today;
  const minStart = addDays(today, -45); let Dr = 0;
  if (start < minStart) { start = minStart; Dr = P.taw * .5; }
  const series = []; let DrNow = null, etcToday = 0;
  for (let d = start; d <= addDays(today, 7); d = addDays(d, 1)) {
    const f = dayForce(d, p, P);
    const dayEvs = evs.filter(e => isoDate(e) === d).map(hourOf);
    const cuts = [...dayEvs.map(h => ({ h, t: "w" }))]; if (d === today) cuts.push({ h: hNow, t: "now" });
    cuts.sort((a, b) => a.h - b.h);
    let F0 = 0, watered = false;
    for (const c of cuts) {
      const etc = f.ref * P.k * ksF(Dr, P.taw, P.raw);
      Dr = Math.min(P.taw, Dr + etc * (etFrac(c.h) - F0)); F0 = etFrac(c.h);
      if (c.t === "w") { Dr = 0; watered = true; }
      else { DrNow = clamp(Dr - (isoDate(lastEv) === d && hourOf(lastEv) <= hNow ? 0 : f.rain * clamp(hNow / 24, 0, 1)), 0, P.taw); }
    }
    const etc = f.ref * P.k * ksF(Dr, P.taw, P.raw);
    if (d === today) etcToday = f.ref * P.k;
    Dr = Math.min(P.taw, Dr + etc * (1 - F0));
    Dr = clamp(Dr - f.rain, 0, P.taw);
    series.push({ date: d, Dr, rain: f.rain, watered, fc: !f.w || f.w.src !== "obs" });
  }
  if (DrNow == null) DrNow = 0;
  let due = null, extrap = false;
  if (DrNow >= P.raw) due = today;
  else {
    const hit = series.find(s => s.date >= today && s.Dr >= P.raw); if (hit) due = hit.date;
    if (!due) {
      const fut = series.filter(s => s.date > today), last = series[series.length - 1];
      const avg = Math.max(.05, (fut.length ? fut.map(s => dayForce(s.date, p, P).ref * P.k).reduce((a, b) => a + b, 0) / fut.length : .8));
      due = addDays(last.date, Math.max(1, Math.ceil((P.raw - last.Dr) / avg))); extrap = true;
    }
  }
  const dd = diffDays(today, due);
  const DrDue = dd <= 0 ? DrNow : (series.find(s => s.date === due) || { Dr: P.raw }).Dr;
  const liters = Math.max(DrDue, dd <= 0 ? DrNow : P.raw) * P.area * P.drain;
  let waitRain = null;
  if (p.place !== "in" && dd <= 1 && DrNow < .85 * P.taw) {
    for (let k = 1; k <= 2; k++) {
      const w = wxDay(addDays(today, k)); if (!w) continue;
      const eff = w.precip != null ? Math.max(0, w.precip - 1) * RAIN_EXPO[p.place] : null;
      if ((w.prob ?? 0) >= 60 && eff != null && eff >= .8 * Math.max(DrNow, P.raw)) { waitRain = { date: addDays(today, k), mm: w.precip, prob: w.prob }; break; }
    }
  }
  const moist = 1 - DrNow / P.taw;
  let status = "ok";
  if (dd <= 0) status = DrNow >= .85 * P.taw ? "crit" : "due"; else if (dd === 1) status = "soon";
  if (waitRain) status = "rain";
  const conf = extrap || dd > 6 ? "estimación" : dd > 3 ? "precisión media" : "precisión alta";
  return { P, DrNow, due, dd, liters, waitRain, moist, status, conf, series, today, etcToday, extrap };
}
function buildSchedule() { try { return S.plants.map(p => { const s = simulate(p); return { id: p.id, name: p.name, due: s.due, liters: +s.liters.toFixed(3), status: s.status, waitRain: s.waitRain ? s.waitRain.date : null }; }); } catch (e) { return []; } }

/* ================== Ejemplos iniciales ================== */
function seed() {
  if (!IN_CLAUDE || S.seeded || S.plants.length) return;
  const h = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(9, 0, 0, 0); return d.toISOString(); };
  S.plants = [
    mkPlant("tomate_semillero", { name: "Semillero de tomate rosa", last: h(1), example: true }),
    mkPlant("potos", { name: "Potos del salón", last: h(5), example: true }),
    mkPlant("romero", { name: "Romero de la terraza", last: h(9), example: true, place: "out" }),
    mkPlant("geranio", { name: "Geranios del balcón", last: h(3), example: true }),
  ];
  S.loc = S.loc || DEFAULT_LOC; S.seeded = true;
}
function mkPlant(type, o = {}) {
  const c = CAT_BY_ID[type] || {};
  const ground = c.sub === "soil" || c.cat === "cesped";
  const p = {
    id: uid(), type, name: c.n || "Planta", place: c.place || "out", sun: c.sun || "full", cont: ground ? "ground" : "pot", size: c.size || "1.5",
    diam: c.d || 20, depth: Math.max(5, Math.round((c.d || 20) * .9)), mat: c.sub === "cactus" ? "terracotta" : (type === "tomate_semillero" || type === "microgreens") ? "tray" : "plastic", sub: c.sub === "soil" ? "universal" : (c.sub || "universal"),
    area: c.cat === "cesped" ? 10 : c.cat === "huerto" ? .5 : 1, root: ROOT_DEF[c.cat] || 40, soil: "franco", om: 2, gravel: 0, heat: "auto", last: new Date().toISOString(), log: [], cal: 1
  };
  if (type === "tomate_semillero") { p.diam = 5; p.depth = 5; }
  return Object.assign(p, o);
}

/* ================== Render ================== */
let VIEW = "today";
function setView(v) { VIEW = v; $$(".tab[data-view]").forEach(t => t.classList.toggle("on", t.dataset.view === v)); $$("[data-pane]").forEach(p => p.classList.toggle("hidden", p.dataset.pane !== v)); render(); window.scrollTo({ top: 0 }); }
function render() {
  $("#tabAI").classList.toggle("hidden", !AI_MODE); $("#tabSet").classList.toggle("hidden", !!AI_MODE);
  $("#locName").textContent = S.loc ? S.loc.name : "Elegir ciudad";
  if (VIEW === "today") renderToday(); else if (VIEW === "plants") renderPlants(); else if (VIEW === "weather") renderWeather(); else if (VIEW === "ai") renderAI();
}
/* Fotos de referencia de cada especie: Wikipedia (Wikimedia Commons), con caché local */
const PH_KEY = "rocio.photos"; let PHOTOS = {}; try { PHOTOS = JSON.parse(localStorage.getItem(PH_KEY) || "{}"); } catch (e) { }
const PHOTO_OK = !IN_CLAUDE;
function spKey(sp) { return sp.id && sp.id !== "x" ? sp.id : "c:" + norm(sp.sci || sp.n); }
function wikiTitle(sp) {
  let t = String(sp.sci || "").replace(/'[^']*'/g, "").replace(/\b(spp?|var|subsp|f)\..*$/i, "").split("/")[0].replace(/\s+/g, " ").trim();
  if (!t || /^varias$/i.test(t)) t = ""; return t;
}
function bigWiki(u) { return String(u).replace(/\/(\d+)px-([^/]+)$/, "/1280px-$2"); }
function photoOf(sp) { const e = PHOTOS[spKey(sp)]; return e && e.u ? e : null; }
function savePhotos() { try { localStorage.setItem(PH_KEY, JSON.stringify(PHOTOS)); } catch (e) { } }
let phQueue = new Map(), phTimer = null, phBusy = false;
function wantPhoto(sp) { if (!PHOTO_OK) return; const k = spKey(sp); const e = PHOTOS[k]; if (e && (e.u || Date.now() - (e.t || 0) < 7 * 864e5)) return; phQueue.set(k, sp); clearTimeout(phTimer); phTimer = setTimeout(flushPhotos, 120); }
async function wikiBatch(lang, titles) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=thumbnail&pithumbsize=360&redirects=1&titles=` + encodeURIComponent(titles.join("|"));
  const j = await fetchJSON(u, 9000); const q = j.query || {}, map = {};
  const alias = {}; (q.normalized || []).forEach(n => alias[n.to] = n.from); (q.redirects || []).forEach(r => alias[r.to] = alias[r.from] || r.from);
  for (const id in (q.pages || {})) { const pg = q.pages[id]; if (pg.thumbnail && pg.thumbnail.source) { let orig = pg.title; while (alias[orig] && !titles.includes(orig)) orig = alias[orig]; map[orig] = { u: pg.thumbnail.source, w: lang + ":" + pg.title }; } }
  return map;
}
async function wikiSearch(lang, q) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(q)}&prop=pageimages&piprop=thumbnail&pithumbsize=360`;
  const j = await fetchJSON(u, 9000); const pages = (j.query && j.query.pages) || {}; for (const id in pages) { const pg = pages[id]; if (pg.thumbnail) return { u: pg.thumbnail.source, w: lang + ":" + pg.title }; } return null;
}
async function flushPhotos() {
  if (phBusy || !phQueue.size) return; phBusy = true;
  const items = [...phQueue.entries()].slice(0, 40); items.forEach(([k]) => phQueue.delete(k));
  const found = {};
  try {
    for (const lang of ["es", "en"]) {
      const pend = items.filter(([k]) => !found[k]).map(([k, sp]) => [k, wikiTitle(sp)]).filter(([, t]) => t);
      for (let i = 0; i < pend.length; i += 20) {
        const chunk = pend.slice(i, i + 20); const m = await wikiBatch(lang, [...new Set(chunk.map(c => c[1]))]);
        chunk.forEach(([k, t]) => { if (m[t]) found[k] = m[t]; });
      }
    }
    for (const [k, sp] of items) { if (found[k]) continue; try { const r = await wikiSearch("es", (sp.n || "").replace(/\(.*?\)/g, "") + " planta"); if (r) found[k] = r; } catch (e) { } }
    for (const [k] of items) PHOTOS[k] = found[k] ? Object.assign({ t: Date.now() }, found[k]) : { u: "", t: Date.now() };
    savePhotos(); paintPhotos();
  } catch (e) { items.forEach(([k, sp]) => phQueue.set(k, sp)); }
  phBusy = false; if (phQueue.size) setTimeout(flushPhotos, 300);
}
function paintPhotos() {
  $$(".av[data-sp]").forEach(el => { if (el.querySelector("img")) return; const e = PHOTOS[el.dataset.sp]; if (e && e.u) { el.innerHTML = `<img src="${esc(e.u)}" alt="" loading="lazy">`; el.classList.add("ph"); } });
  $$("[data-hero-sp]").forEach(el => { const e = PHOTOS[el.dataset.heroSp]; if (e && e.u && !el.querySelector("img")) { const ph = el.querySelector(".hero-ph"); if (ph) ph.remove(); el.insertAdjacentHTML("afterbegin", `<img src="${esc(e.u)}" alt="" data-full="${esc(bigWiki(e.u))}" data-small="${esc(e.u)}"><button class="hero-zoom" data-act="zoom" aria-label="Ver foto a pantalla completa">${svg("expand")}</button>`); el.classList.remove("empty"); } });
}
function avatar(p, lg) {
  const sp = spec(p), c = sp.cat, t = thumbs[p.id], k = spKey(sp), ph = !t && photoOf(sp);
  if (!t && !ph) wantPhoto(sp);
  return `<div class="av${lg ? " lg" : ""}${t || ph ? " ph" : ""}" data-sp="${esc(k)}" style="color:${CAT_TINT[c] || "var(--leaf)"};background:color-mix(in srgb, ${CAT_TINT[c] || "#2c6a4c"} 14%, var(--surface))">${t ? `<img src="${t}" alt="">` : ph ? `<img src="${esc(ph.u)}" alt="" loading="lazy">` : glyph(c)}</div>`;
}
function avatarSp(sp) {
  const k = spKey(sp), ph = photoOf(sp);
  return `<div class="av${ph ? " ph" : ""}" data-sp="${esc(k)}" data-lazy="${esc(sp.id)}" style="color:${CAT_TINT[sp.cat]};background:color-mix(in srgb, ${CAT_TINT[sp.cat]} 14%, var(--surface))">${ph ? `<img src="${esc(ph.u)}" alt="" loading="lazy">` : glyph(sp.cat)}</div>`;
}
function ring(m, status, big) {
  const r = big ? 52 : 23, sz = big ? 120 : 56, sw = big ? 10 : 6, C = 2 * Math.PI * r;
  const col = { ok: "var(--water)", soon: "var(--warn)", due: "var(--water)", crit: "var(--crit)", rain: "var(--water)" }[status] || "var(--water)";
  return `<svg viewBox="0 0 ${sz} ${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${sw}"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(C * clamp(m, 0, 1)).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
}
function statusPill(s) {
  if (s.status === "crit") return '<span class="pill crit">Urgente</span>';
  if (s.status === "due") return '<span class="pill water">Toca hoy</span>';
  if (s.status === "rain") return '<span class="pill water">Lluvia prevista</span>';
  if (s.status === "soon") return '<span class="pill warn">Mañana</span>';
  return `<span class="pill">En ${s.dd} días</span>`;
}
function whenText(s) {
  if (s.status === "rain") return "Espera a la lluvia de " + niceDay(s.waitRain.date, s.today);
  if (s.dd <= 0) return s.status === "crit" ? "Regar ya" : "Regar hoy";
  return "Regar " + niceDay(s.due, s.today);
}
function sims() { return S.plants.map(p => ({ p, s: simulate(p) })).sort((a, b) => a.s.dd - b.s.dd || a.s.moist - b.s.moist); }

function renderToday() {
  const el = $("#paneToday"); const today = isoDate(new Date());
  const L = sims(); const due = L.filter(x => x.s.dd <= 0); const total = due.filter(x => x.s.status !== "rain").reduce((a, x) => a + x.s.liters, 0);
  const dateTxt = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  let title, sub;
  if (!S.plants.length) { title = "Empieza tu jardín"; sub = "Añade tus plantas y te diré cuándo y cuánto regarlas según el tiempo."; }
  else if (!due.length) { title = "Hoy no toca regar"; const nx = L[0]; sub = nx ? "Próximo riego: " + esc(nx.p.name) + ", " + niceDay(nx.s.due, today) + "." : ""; }
  else { title = due.length === 1 ? "1 planta necesita agua" : due.length + " plantas necesitan agua"; sub = due.some(x => x.s.status === "crit") ? "Alguna está ya en estrés hídrico: empieza por las urgentes." : "Mejor a primera hora o al atardecer."; }
  const w = S.wx && S.wx.current; const wt = wxDay(today);
  let h = `<section class="card hero"><canvas id="heroArt" width="380" height="380" aria-hidden="true"></canvas>
    <div class="date">${dateTxt}</div><h1>${title}</h1><div class="sub">${sub}</div>
    <div class="hero-stats num"><div><b>${due.length}</b><span>riegos hoy</span></div><div><b>${total ? fmtL(total) : "0 L"}</b><span>agua total</span></div><div><b>${wt && wt.et0 != null ? nf1.format(wt.et0) : "—"}</b><span>ET₀ mm hoy</span></div>${w && w.temp != null ? `<div><b>${Math.round(w.temp)}°</b><span>ahora</span></div>` : ""}</div></section>`;
  h += installBanner();
  if (S.plants.some(p => p.example)) h += `<div class="banner" style="margin-top:12px">${svg("info")}<div style="flex:1">Son plantas de ejemplo para que veas cómo funciona. Bórralas cuando añadas las tuyas.</div><button class="btn sm" data-act="clearExamples">Quitar ejemplos</button></div>`;
  h += alertsHTML();
  if (due.length) {
    h += `<div class="sec-h"><h2>Para regar hoy</h2><span class="aside">${due.length}</span></div><div class="card">`;
    h += due.map(({ p, s }) => `<div class="task">${avatar(p)}<div class="t-main" data-act="detail" data-id="${p.id}" role="button" tabindex="0"><div class="t-name">${esc(p.name)}</div><div class="t-meta">${s.status === "rain" ? "Se esperan " + nf1.format(s.waitRain.mm) + " mm " + niceDay(s.waitRain.date, today) : s.status === "crit" ? "Sustrato casi seco · " + Math.round(s.moist * 100) + " % de agua útil" : Math.round(s.moist * 100) + " % de agua útil"}</div></div><div class="t-amt num">${fmtL(s.liters)}</div><button class="icon-btn water big" data-act="quick" data-id="${p.id}" aria-label="Marcar ${esc(p.name)} como regada">${svg("check")}</button></div>`).join("");
    h += `</div>`;
  }
  // Planificador
  if (S.plants.length) {
    h += `<div class="sec-h"><h2>Próximos 7 días</h2><span class="aside">gotas = riegos</span></div><div class="card"><div class="planner">`;
    for (let k = 0; k < 7; k++) {
      const d = addDays(today, k), dt = new Date(d + "T12:00:00"); const n = L.filter(x => (x.s.status === "rain" ? x.s.waitRain.date : (x.s.dd <= 0 ? today : x.s.due)) === d).length;
      const wd = wxDay(d); const rainy = wd && ((wd.precip || 0) >= 1 || (wd.prob || 0) >= 60);
      h += `<div class="pday${k === 0 ? " today" : ""}"><div class="dw">${k === 0 ? "hoy" : DOW[dt.getDay()]}</div><div class="dn num">${dt.getDate()}</div><div class="drops">${"<i></i>".repeat(Math.min(n, 6))}${rainy ? '<i class="rain" title="lluvia"></i>' : ""}</div><div class="cnt">${n ? "×" + n : "·"}</div></div>`;
    }
    h += `</div></div>`;
    const later = L.filter(x => x.s.dd > 0).slice(0, 4);
    if (later.length) {
      h += `<div class="sec-h"><h2>Después</h2></div><div class="card">` + later.map(({ p, s }) => `<div class="task" data-act="detail" data-id="${p.id}" role="button" tabindex="0">${avatar(p)}<div class="t-main"><div class="t-name">${esc(p.name)}</div><div class="t-meta">${whenText(s)} · ${s.conf}</div></div><div class="t-amt num" style="color:var(--ink-2)">${fmtL(s.liters)}</div></div>`).join("") + `</div>`;
    }
    if (AI_MODE) h += `<div class="sec-h"><h2>Asistente</h2></div><button class="card ai-tile" style="width:100%" data-act="insight">${svg("sparkle")}<b>Revisar mi jardín con IA</b><span>Analiza tus plantas, el tiempo de los próximos días y te da los consejos de esta semana.</span></button><div id="insightOut"></div>`;
  } else {
    h += `<div class="card empty" style="margin-top:14px">${glyph("interior")}<div>Aún no tienes plantas.</div><button class="btn primary" data-act="add">${svg("plus")} Añadir planta</button></div>`;
  }
  el.innerHTML = h;
  drawHeroArt();
}
function alertsHTML() {
  if (!S.wx) return wxStatusHTML();
  const today = isoDate(new Date()), out = S.plants.filter(p => p.place !== "in"); const al = [];
  let iMin = null; for (let k = 0; k < 4; k++) { const d = addDays(today, k), w = wxDay(d); if (w && w.tmin != null && (iMin == null || w.tmin < wxDay(iMin).tmin)) iMin = d; }
  if (iMin) { const tmin = wxDay(iMin).tmin; const hit = out.filter(p => tmin <= spec(p).minC); if (hit.length) al.push(["crit", "snow", `<b>${tmin <= 0 ? "Helada" : "Frío"} ${niceDay(iMin, today)} (mín. ${Math.round(tmin)} °C).</b> Protege o mete dentro: ${hit.map(p => esc(p.name)).join(", ")}.${tmin <= 1 ? " Evita regar por la tarde antes de la helada." : ""}`]); }
  let iMax = null; for (let k = 0; k < 4; k++) { const d = addDays(today, k), w = wxDay(d); if (w && w.tmax != null && (iMax == null || w.tmax > wxDay(iMax).tmax)) iMax = d; }
  if (iMax) { const tmax = wxDay(iMax).tmax; const hit = out.filter(p => tmax >= spec(p).maxC); if (hit.length) al.push(["warn", "thermo", `<b>Calor extremo ${niceDay(iMax, today)} (${Math.round(tmax)} °C).</b> Riega al amanecer y da sombra a ${hit.map(p => esc(p.name)).join(", ")}.`]); }
  const wt = wxDay(today); if (wt && (wt.wind || 0) >= 40 && out.length) al.push(["warn", "wind", `<b>Viento fuerte hoy (${Math.round(wt.wind)} km/h).</b> Seca las macetas más rápido y puede tumbarlas.`]);
  const s = wxStatusHTML();
  return (al.length ? `<div class="stack" style="margin-top:12px">` + al.map(a => `<div class="alert ${a[0]}">${svg(a[1])}<div>${a[2]}</div></div>`).join("") + `</div>` : "") + s;
}
function wxStatusHTML() {
  if (wxBusy && !S.wx) return `<div class="alert info" style="margin-top:12px"><span class="spin"></span><div>Consultando el tiempo de ${esc(S.loc ? S.loc.name : "tu ciudad")}…</div></div>`;
  if (!wxErr) return "";
  const msg = {
    server_not_connected: `Para el tiempo en vivo, conecta <b>AccuWeather</b> en los conectores de Claude (es gratis y sin cuenta) y vuelve a abrir la app.`,
    needs_reauth: `Vuelve a conectar AccuWeather en los ajustes de conectores de Claude.`,
    not_in_manifest: `Has denegado el acceso a AccuWeather para esta app. Pulsa reintentar y acéptalo.`,
    approval_required: `La app necesita tu permiso para consultar AccuWeather.`,
    no_mcp: `Esta vista no puede consultar el tiempo. Abre la app desde Claude.`,
  }[wxErr] || `No pude actualizar el tiempo. ${S.wx ? "Uso los últimos datos guardados." : ""}`;
  return `<div class="alert ${S.wx ? "info" : ""}" style="margin-top:12px">${svg("cloud")}<div style="flex:1">${msg}</div><button class="btn sm" data-act="wxRetry">Reintentar</button></div>`;
}
function renderWxStatus() { if (VIEW === "today" || VIEW === "weather") render(); }
function drawHeroArt() {
  const c = $("#heroArt"); if (!c) return; const x = c.getContext("2d"); x.clearRect(0, 0, 380, 380);
  x.strokeStyle = "#fff"; x.lineWidth = 2.2; x.lineCap = "round";
  // ondas concéntricas de una gota sobre el agua
  for (let i = 0; i < 6; i++) { x.globalAlpha = 1 - i * .14; x.beginPath(); x.ellipse(200, 250, 30 + i * 28, 10 + i * 9, 0, 0, Math.PI * 2); x.stroke(); }
  x.globalAlpha = 1; x.fillStyle = "#fff"; x.beginPath(); x.moveTo(200, 70); x.bezierCurveTo(240, 130, 262, 160, 262, 190); x.arc(200, 190, 62, 0, Math.PI, false); x.bezierCurveTo(138, 160, 160, 130, 200, 70); x.fill();
}

function renderPlants() {
  const el = $("#panePlants"); const L = sims();
  let h = `<div class="sec-h" style="margin-top:8px"><h2>Mis plantas</h2><span class="aside">${S.plants.length} en total</span></div>`;
  if (!L.length) { el.innerHTML = h + `<div class="card empty">${glyph("interior")}<div>Añade tu primera planta. Hay ${CATALOG.length} especies registradas y la IA reconoce cualquier otra.</div><button class="btn primary" data-act="add">${svg("plus")} Añadir planta</button></div>`; return; }
  const groups = { in: [], out: [], cov: [] }; L.forEach(x => groups[x.p.place || "out"].push(x));
  const name = { out: "Exterior", cov: "Exterior cubierto", in: "Interior" };
  for (const g of ["out", "cov", "in"]) {
    if (!groups[g].length) continue;
    h += `<div class="lbl" style="margin:16px 2px 8px">${name[g]}</div><div class="pgrid">`;
    h += groups[g].map(({ p, s }) => `<button class="pcard s-${s.status === "rain" ? "due" : s.status}" data-act="detail" data-id="${p.id}">
      <div class="row">${avatar(p)}<div style="min-width:0;flex:1"><div class="nm">${esc(p.name)}</div><div class="sp">${esc(spec(p).n)}</div></div></div>
      <div class="row"><div class="ring">${ring(s.moist, s.status)}<b>${Math.round(s.moist * 100)}%</b></div><div style="min-width:0"><div class="when">${whenText(s)}</div><div class="amt num">${fmtL(s.liters)} · ${s.conf}</div></div></div>
      ${statusPill(s)}</button>`).join("");
    h += `</div>`;
  }
  el.innerHTML = h;
}

function renderWeather() {
  const el = $("#paneWeather"); const today = isoDate(new Date());
  let h = `<div class="sec-h" style="margin-top:8px"><h2>El tiempo en ${esc(S.loc ? S.loc.name : "—")}</h2><button class="btn sm ghost" data-act="loc" style="margin-left:auto">Cambiar</button></div>`;
  if (!S.wx) { el.innerHTML = h + (wxStatusHTML() || `<div class="card empty"><span class="spin"></span><div>Cargando…</div></div>`); return; }
  const c = S.wx.current || {}, wt = wxDay(today) || {};
  const mins = Math.round((Date.now() - S.wx.fetchedAt) / 6e4);
  h += `<div class="card"><div class="wx-now">${svg(c.kind || wt.kind || "sun", "wi")}<div><div class="t num">${c.temp != null ? Math.round(c.temp) + "°" : wt.tmax != null ? Math.round(wt.tmax) + "°" : "—"}</div><div class="muted">${esc(esTxt(c.text || wt.text, c.kind || wt.kind))}</div></div></div>
    <div class="wx-meta num">${c.rh != null ? `<span>Humedad <b>${Math.round(c.rh)} %</b></span>` : ""}${c.wind != null ? `<span>Viento <b>${Math.round(c.wind)} km/h</b></span>` : ""}<span>ET₀ hoy <b>${wt.et0 != null ? nf1.format(wt.et0) + " mm" : "—"}</b></span></div>
    <div class="hint" style="margin-top:10px">Fuente: ${S.wx.source === "Open‑Meteo" ? '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Datos meteorológicos de Open‑Meteo.com</a> (CC BY 4.0)' : esc(S.wx.source)} · ET₀ por ${esc(S.wx.et0src)} · actualizado ${mins < 1 ? "ahora" : mins < 60 ? "hace " + mins + " min" : "hace " + Math.round(mins / 60) + " h"} <button class="btn sm ghost" data-act="wxRetry" style="padding:2px 6px">${svg("refresh")}</button></div></div>`;
  h += wxStatusHTML();
  // Días
  const days = []; for (let k = 0; k < 8; k++) { const d = addDays(today, k); if (wxDay(d)) days.push(d); }
  if (days.length) {
    const lo = Math.min(...days.map(d => wxDay(d).tmin)), hi = Math.max(...days.map(d => wxDay(d).tmax));
    h += `<div class="sec-h"><h2>Previsión</h2><span class="aside">máx/mín · ET₀ · lluvia</span></div><div class="card wx-days">`;
    h += days.map(d => { const w = wxDay(d), dt = new Date(d + "T12:00:00"); const a = (w.tmin - lo) / Math.max(1, hi - lo) * 100, b = (w.tmax - lo) / Math.max(1, hi - lo) * 100;
      return `<div class="wx-day num"><b>${d === today ? "Hoy" : DOW[dt.getDay()] + " " + dt.getDate()}</b>${svg(w.kind || "sun")}<div><div class="tbar"><i style="left:${a}%;right:${100 - b}%"></i></div><div class="faint small" style="margin-top:3px">${Math.round(w.tmin)}° / ${Math.round(w.tmax)}°</div></div><span class="et">${w.et0 != null ? nf1.format(w.et0) + " mm" : "—"}</span><span class="pr">${w.precip != null && w.precip >= .1 ? nf1.format(w.precip) + " mm" : w.prob != null ? Math.round(w.prob) + " %" : "—"}</span></div>`; }).join("");
    h += `</div>`;
  }
  // Gráfico balance: últimos 21 días + 7
  h += `<div class="sec-h"><h2>Evaporación frente a lluvia</h2><span class="aside">mm por día · 14 días</span></div><div class="card">${balanceChart(today)}<div class="legend"><span><i style="background:var(--warn)"></i>ET₀ (agua que pide el ambiente)</span><span><i style="background:var(--water)"></i>Lluvia</span><span><i style="background:var(--ink-3)"></i>Previsión</span></div></div>`;
  h += `<details class="card method" style="margin-top:14px"><summary>Cómo calcula Rocío cuándo regar</summary><ul>
    <li><b>Balance diario de agua en el sustrato</b> (método FAO‑56): cada día la planta consume ET₀ × Kc × ajustes y la lluvia efectiva repone.</li>
    <li><b>ET₀</b>: evapotranspiración de referencia de tu ciudad. Con Open‑Meteo se usa Penman‑Monteith; con AccuWeather se calcula con Hargreaves‑Samani a partir de las temperaturas y la radiación solar teórica de tu latitud.</li>
    <li><b>Kc</b> por especie y fase (225 especies registradas), corregido por sol, tamaño de copa, material de la maceta y, en interior, por calefacción.</li>
    <li><b>Agua útil</b> = profundidad × agua fácilmente disponible del sustrato. Se riega al agotar la fracción <i>p</i> propia de la especie.</li>
    <li>Por debajo de ese umbral la planta reduce su consumo (coeficiente de estrés Ks), como en la realidad.</li>
    <li><b>Calibración</b>: cada vez que riegas y dices cómo estaba la tierra, el modelo se ajusta a tu planta.</li></ul></details>`;
  el.innerHTML = h;
}
function balanceChart(today) {
  const W = 560, H = 170, pl = 28, pr = 6, pt = 10, pb = 22; const ds = []; for (let k = -7; k < 7; k++) ds.push(addDays(today, k));
  const vals = ds.map(d => wxDay(d) || {}); const mx = Math.max(4, ...vals.map(v => Math.max(v.et0 || 0, v.precip || 0))); const top = Math.ceil(mx / 2) * 2;
  const bw = (W - pl - pr) / ds.length, y = v => pt + (H - pt - pb) * (1 - v / top);
  let g = ""; for (let t = 0; t <= top; t += top / 4) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${nf0.format(t)}</text>`;
  let bars = "", line = "";
  ds.forEach((d, i) => { const v = vals[i], x0 = pl + i * bw; const fc = d >= today;
    if (v.precip) bars += `<rect x="${(x0 + bw * .18).toFixed(1)}" y="${y(Math.min(v.precip, top)).toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${(y(0) - y(Math.min(v.precip, top))).toFixed(1)}" rx="2" fill="var(--water)" opacity="${fc ? .45 : .85}"/>`;
  });
  const pts = ds.map((d, i) => vals[i].et0 != null ? [pl + i * bw + bw / 2, y(vals[i].et0)] : null).filter(Boolean);
  if (pts.length > 1) { line = `<path d="M${pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L")}" fill="none" stroke="var(--warn)" stroke-width="2.2" stroke-linejoin="round"/>`; const lp = pts[pts.length - 1]; line += `<circle cx="${lp[0]}" cy="${lp[1]}" r="3.5" fill="var(--warn)"/>`; }
  const xt = pl + 7 * bw; const lbl = ds.map((d, i) => i % 3 === 0 ? `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${new Date(d + "T12:00:00").getDate()} ${MON[new Date(d + "T12:00:00").getMonth()]}</text>` : "").join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ET0 y lluvia diaria en mm">${g}<rect x="${xt}" y="${pt}" width="${W - pr - xt}" height="${H - pt - pb}" fill="var(--surface-2)" opacity=".7"/>${bars}${line}<line x1="${xt}" x2="${xt}" y1="${pt}" y2="${H - pb}" stroke="var(--ink-3)" stroke-dasharray="3 3"/><text x="${xt + 4}" y="${pt + 10}" font-size="10" fill="var(--ink-3)">previsión</text>${lbl}</svg>`;
}

/* ================== IA ================== */
let SAMPLE = null, aiBusy = false, AI_MODE = CONFIG.aiEndpoint ? "proxy" : (IN_CLAUDE ? null : "link");
const AI_FULL = () => AI_MODE === "proxy" || AI_MODE === "claude";
/* Modo «puente»: sin clave de IA propia, las preguntas se abren en Claude con el contexto ya escrito */
function linkContext() {
  const today = isoDate(new Date());
  const pl = S.plants.slice(0, 12).map(p => { const s = simulate(p); return `- ${p.name} (${spec(p).n}; ${{ in: "interior", out: "exterior", cov: "exterior cubierto" }[p.place]}, ${p.cont === "pot" ? "maceta " + p.diam + " cm" : "en suelo"}): agua útil ${Math.round(s.moist * 100)} %, último riego ${niceDay(p.last.slice(0, 10), today)}, próximo ${niceDay(s.due, today)}`; }).join("\n");
  const wx = []; for (let k = 0; k < 5; k++) { const d = addDays(today, k), w = wxDay(d); if (w) wx.push(`${new Date(d + "T12:00:00").getDate()}/${new Date(d + "T12:00:00").getMonth() + 1}: ${Math.round(w.tmin)}–${Math.round(w.tmax)} °C, lluvia ${w.precip != null ? nf1.format(w.precip) + " mm" : (w.prob != null ? Math.round(w.prob) + " %" : "?")}`); }
  return `Contexto (app de riego Rocío). Hoy: ${today}. Ubicación: ${S.loc ? S.loc.name + (S.loc.region ? ", " + S.loc.region : "") : "?"}.\nMis plantas:\n${pl || "(ninguna aún)"}\nTiempo próximos días: ${wx.join("; ") || "sin datos"}.`;
}
function openClaude(question, withContext = true) {
  let q = (withContext ? "Eres una experta en botánica y riego. Responde en español de España, breve y práctico.\n\n" + linkContext() + "\n\n" : "") + question;
  if (q.length > 2400) q = q.slice(0, 2400);
  try { navigator.clipboard && navigator.clipboard.writeText(q).catch(() => { }); } catch (e) { }
  const url = "https://claude.ai/new?q=" + encodeURIComponent(q);
  haptic(); toast("Abriendo Claude… La pregunta también queda copiada por si hay que pegarla");
  setTimeout(() => { if (IS_NATIVE) location.href = url; else { const w = window.open(url, "_blank"); if (w) { try { w.opener = null; } catch (e) { } } else location.href = url; } }, 350);
}
async function getSample() { if (SAMPLE) return SAMPLE; SAMPLE = await claudeUse("sample"); if (SAMPLE) AI_MODE = "claude"; return SAMPLE; }
async function blobB64(b) { const u = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function proxyCall(messages, images) {
  const msgs = messages.map(m => ({ role: m.role, content: m.content }));
  if (images && images.length) { const last = msgs[msgs.length - 1], parts = []; for (const im of images) parts.push({ type: "image", source: { type: "base64", media_type: im.type || "image/jpeg", data: await blobB64(im) } }); parts.push({ type: "text", text: last.content }); last.content = parts; }
  const c = new AbortController(), t = setTimeout(() => c.abort(), 60000);
  try {
    const r = await fetch(CONFIG.aiEndpoint, { method: "POST", signal: c.signal, headers: { "content-type": "application/json", "x-app-key": CONFIG.aiKey || "" }, body: JSON.stringify({ messages: msgs }) });
    if (r.status === 429) throw { code: "rate_limited" }; if (!r.ok) throw { code: "ai_http" };
    return (await r.json()).text || "";
  } catch (e) { if (e && e.code) throw e; throw { code: navigator.onLine === false ? "offline" : "ai_http" }; } finally { clearTimeout(t); }
}
async function aiText(input, opts = {}) {
  const sm = await getSample();
  if (sm) { const r = await sm(input, Object.assign({ cache: false }, opts)); return r.text || ""; }
  if (AI_MODE !== "proxy") throw { code: "not_granted" };
  const t = await proxyCall(typeof input === "string" ? [{ role: "user", content: input }] : input, opts.images);
  opts.onText && opts.onText({ text: t }); return t;
}
async function aiJSON(prompt, opts = {}) {
  const sm = await getSample(); if (sm) return await sm.json(prompt, opts);
  const t = await aiText(prompt + "\n\nResponde únicamente con JSON válido, sin texto adicional.", { images: opts.images });
  const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b < a) throw { code: "parse" }; return JSON.parse(t.slice(a, b + 1));
}
function aiErr(e) {
  const c = e && e.code;
  if (c === "not_granted") return "La IA no está disponible en esta vista. Abre la app desde Claude.";
  if (c === "rate_limited") return "Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo.";
  if (c === "offline") return "Sin conexión. La IA necesita internet; el resto de la app funciona igual.";
  return "La IA no ha podido responder. Inténtalo de nuevo.";
}
function gardenContext() {
  const today = isoDate(new Date());
  const pl = S.plants.map(p => { const s = simulate(p), sp = spec(p); return `- ${p.name} (${sp.n}${sp.sci ? ", " + sp.sci : ""}); ${{ in: "interior", out: "exterior", cov: "exterior cubierto" }[p.place]}, ${{ full: "sol pleno", part: "semisombra", shade: "sombra" }[p.sun]}; ${p.cont === "pot" ? "maceta " + p.diam + " cm, " + (SUB_LABEL[p.sub] || p.sub) : "en suelo " + p.area + " m²"}; agua útil ${Math.round(s.moist * 100)} %; próximo riego ${s.due} (${fmtL(s.liters)}); último riego ${p.last.slice(0, 10)}${p.cal && Math.abs(p.cal - 1) > .04 ? "; calibración ×" + p.cal.toFixed(2) : ""}`; }).join("\n");
  const wx = []; for (let k = -3; k < 7; k++) { const d = addDays(today, k), w = wxDay(d); if (w) wx.push(`${d}: ${Math.round(w.tmin)}–${Math.round(w.tmax)} °C, lluvia ${w.precip != null ? nf1.format(w.precip) + " mm" : "?"}${w.prob != null ? " (" + Math.round(w.prob) + " %)" : ""}, ET0 ${w.et0 != null ? nf1.format(w.et0) : "?"} mm${w.text ? ", " + esTxt(w.text, w.kind) : ""}`); }
  return `Fecha: ${today}. Ubicación: ${S.loc ? S.loc.name + ", " + (S.loc.region || "") : "desconocida"}.\nPlantas del usuario:\n${pl || "(ninguna)"}\nTiempo (3 días pasados y previsión):\n${wx.join("\n") || "(sin datos)"}`;
}
const AI_SYS = "Eres Rocío, una botánica y técnica en riego experta que vive dentro de una app de riego. Responde en español de España, claro, cercano y práctico, con datos concretos (litros, días, temperaturas). Usa listas cortas y negritas para lo importante. Si algo no se puede saber sin ver la planta, dilo y explica qué comprobar. No inventes datos del usuario.";
async function aiStream(prompt, outEl, opts = {}) {
  outEl.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
  try {
    const t = await aiText(prompt, Object.assign({ onText: ({ text }) => { if (text && text !== "Thinking...") outEl.innerHTML = mdLite(text); } }, opts));
    outEl.innerHTML = mdLite(t); return t;
  } catch (e) { outEl.innerHTML = `<p>${aiErr(e)}</p>`; return null; }
}
async function aiInsight() {
  if (AI_MODE === "link") { openClaude("Revisa mi jardín y dame un parte breve para esta semana: qué regar y cuándo, riesgos por el tiempo (heladas, calor, viento, lluvia) y un consejo para cada planta que lo necesite."); return; }
  const out = $("#insightOut"); if (!out || aiBusy) return; aiBusy = true;
  out.innerHTML = `<div class="ai-out" style="margin-top:10px"></div>`;
  await aiStream(AI_SYS + "\n\n" + gardenContext() + "\n\nTAREA: Revisa el jardín y da un parte breve para esta semana: 1) qué regar y cuándo (coherente con las fechas calculadas), 2) riesgos por el tiempo (heladas, calor, viento, lluvia) y qué hacer, 3) un consejo de cuidado específico por planta que lo necesite. Máximo 180 palabras.", out.firstChild);
  aiBusy = false;
}
async function resizeImage(file, max = 1024, q = .85) {
  const url = URL.createObjectURL(file); const img = new Image();
  await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
  const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
  const t = document.createElement("canvas"), ts = 160 / Math.max(c.width, c.height); t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts); t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return { blob, dataUrl: c.toDataURL("image/jpeg", .8), thumb: t.toDataURL("image/jpeg", .7) };
}
const CAT_INDEX = () => CATALOG.map(c => c.id + "=" + c.n).join("; ");
const PARAM_SCHEMA = '{"name":"nombre común en español","scientific":"nombre científico","cat":"una de: huerto, aromaticas, frutales, interior, suculentas, flores, arbustos, trepadoras, arboles, cesped, orquideas, bonsai, carnivoras","kc":número 0.2-1.25 (coeficiente de cultivo FAO-56; suculentas 0.3, interior 0.6-0.9, hortícolas 1.0-1.15),"p":número 0.1-0.9 (fracción de agua útil agotable antes de regar),"minC":temperatura mínima tolerada °C,"maxC":temperatura máxima tolerada °C,"place":"in u out (ubicación habitual)","sun":"full, part o shade","sub":"universal, peat, cactus, bark o acid","d":diámetro de maceta típico en cm,"size":"1, 1.5 o 2.3 (copa respecto a la maceta)","note":"consejo de riego de una frase"}';
async function aiIdentify(img) {
  const prompt = "Identifica la planta de la foto. Catálogo disponible (id=nombre): " + CAT_INDEX() +
    '. Responde SOLO con JSON: {"match":"id del catálogo si coincide la especie (y fase si aplica) o null","confidence":0-1,"name":"nombre común en español","scientific":"nombre científico","health":"estado visible en una frase (hojas, color, plagas)","custom":' + PARAM_SCHEMA + " (rellena custom siempre)}";
  return await aiJSON(prompt, { images: [img], modelTier: "default" });
}
async function aiCustom(text) {
  return await aiJSON("El usuario quiere añadir esta planta a su app de riego: «" + text + "». Si es ambigua, elige la interpretación más común en España. Responde SOLO con JSON con este esquema: " + PARAM_SCHEMA, { modelTier: "default" });
}

/* Chat */
function renderAI() {
  const el = $("#paneAI");
  if (AI_MODE === "link") {
    el.innerHTML = `<div class="sec-h" style="margin-top:8px"><h2>Pregunta a la IA</h2></div>
      <div class="card ai-note">${svg("sparkle")}<div>Tus preguntas se abren en <b>Claude</b> (gratis con una cuenta), con tus plantas, su riego y el tiempo ya incluidos. Solo tienes que enviarlas.</div></div>
      <form class="composer" id="composer" style="position:static;margin-top:14px"><textarea id="chatIn" rows="2" placeholder="Escribe tu pregunta sobre tus plantas…" aria-label="Pregunta"></textarea><button class="icon-btn water" type="submit" aria-label="Preguntar">${svg("send")}</button></form>
      <div class="suggest" style="margin-top:12px">${["¿Qué riego este fin de semana?", "¿Cuándo siembro los tomates?", "¿Puedo dejar las plantas una semana sin regar?", "¿Qué plantas sufren con el frío de estos días?"].map(q => `<button class="chip" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <div class="ai-actions" style="margin-top:18px"><button class="ai-tile" data-act="diagnose">${svg("stethoscope")}<b>Diagnosticar</b><span>Hojas amarillas, manchas, plagas… con foto en Claude.</span></button><button class="ai-tile" data-act="identify">${svg("camera")}<b>Identificar planta</b><span>Adjunta una foto y te dice qué es y cómo regarla.</span></button></div>
      <button class="card ai-tile" style="width:100%;margin-top:10px" data-act="insight">${svg("leaf")}<b>Revisar mi jardín</b><span>Consejos para esta semana según el tiempo.</span></button>`;
    $("#composer").onsubmit = e => { e.preventDefault(); const v = $("#chatIn").value.trim(); if (v) { ask(v); $("#chatIn").value = ""; } };
    return;
  }
  let h = `<div class="sec-h" style="margin-top:8px"><h2>Rocío IA</h2><span class="aside">tu botánica de bolsillo</span></div>
    <div class="ai-actions"><button class="ai-tile" data-act="identify">${svg("camera")}<b>Identificar planta</b><span>Haz una foto y la añado con sus parámetros de riego.</span></button>
    <button class="ai-tile" data-act="diagnose">${svg("stethoscope")}<b>Diagnosticar</b><span>Hojas amarillas, manchas, plagas… con foto o descripción.</span></button></div>
    <div class="sec-h"><h2>Pregúntame</h2>${S.chat.length ? `<button class="btn sm ghost" data-act="clearChat" style="margin-left:auto">Borrar</button>` : ""}</div><div class="chat" id="chat">`;
  if (!S.chat.length) h += `<div class="msg a"><p>Hola. Conozco tus plantas, cuánta agua les queda y el tiempo de los próximos días. Pregúntame lo que quieras.</p></div>`;
  h += S.chat.map(m => `<div class="msg ${m.role === "user" ? "u" : "a"}">${m.role === "user" ? esc(m.content) : mdLite(m.content)}</div>`).join("");
  h += `</div>${!S.chat.length ? `<div class="suggest" style="margin-top:10px">${["¿Qué riego este fin de semana?", "¿Cuándo siembro los tomates rosas?", "¿Puedo dejar las plantas una semana sin regar?", "¿Qué plantas aguantan el frío de esta semana?"].map(q => `<button class="chip" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
    <form class="composer" id="composer"><textarea id="chatIn" rows="1" placeholder="Escribe tu pregunta…" aria-label="Pregunta"></textarea><button class="icon-btn water" type="submit" aria-label="Enviar">${svg("send")}</button></form>`;
  el.innerHTML = h;
  $("#composer").onsubmit = e => { e.preventDefault(); const v = $("#chatIn").value.trim(); if (v) ask(v); };
  $("#chatIn").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });
}
async function ask(q) {
  if (AI_MODE === "link") { openClaude("Mi pregunta: " + q); return; }
  if (aiBusy) return; aiBusy = true;
  S.chat.push({ role: "user", content: q }); renderAI();
  const box = $("#chat"); const a = document.createElement("div"); a.className = "msg a"; box.appendChild(a); a.scrollIntoView({ block: "end" });
  const hist = S.chat.slice(-12).map(m => ({ role: m.role, content: m.content }));
  hist[0] = { role: "user", content: AI_SYS + "\n\nCONTEXTO ACTUAL\n" + gardenContext() + "\n\n" + hist[0].content };
  if (hist[0].role !== "user") hist.shift();
  const t = await aiStream(hist, a);
  if (t) S.chat.push({ role: "assistant", content: t }); else S.chat.pop();
  aiBusy = false; save(); renderAI(); const last = $$("#chat .msg").pop(); last && last.scrollIntoView({ block: "end" });
}

/* ================== Hojas ================== */
function openSheet(html, onMount) {
  const sc = $("#scrim"), sh = $("#sheet"); sh.innerHTML = `<div class="grab"></div>` + html; sc.classList.add("open"); document.body.style.overflow = "hidden"; onMount && onMount(sh); sh.scrollTop = 0;
}
function closeSheet() { $("#scrim").classList.remove("open"); document.body.style.overflow = ""; }
$("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
const sheetHead = (t, extra = "") => `<div class="sheet-h"><h2>${t}</h2>${extra}<button class="icon-btn" data-act="close" aria-label="Cerrar">${svg("x")}</button></div>`;

/* Detalle de planta */
function openDetail(id) {
  const p = S.plants.find(x => x.id === id); if (!p) return; const s = simulate(p), sp = spec(p), today = s.today;
  const log = [...(p.log || [])].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 6);
  const fbTxt = { wet: "aún húmeda", ok: "en su punto", dry: "muy seca" };
  const own = thumbs[p.id], ph = photoOf(sp);
  if (!own && !ph) wantPhoto(sp);
  const heroImg = own ? `<img src="${own}" alt="Foto de ${esc(p.name)}" data-full="${own}">` : ph ? `<img src="${esc(ph.u)}" alt="${esc(sp.n)}" data-full="${esc(bigWiki(ph.u))}" data-small="${esc(ph.u)}">` : "";
  const hero = `<div class="pl-hero${heroImg ? "" : " empty"}" data-hero-sp="${esc(spKey(sp))}">${heroImg || `<div class="hero-ph" style="color:${CAT_TINT[sp.cat]}">${glyph(sp.cat)}</div>`}
    <div class="hero-acts"><label class="hero-btn" for="dPhoto">${svg("camera")} ${own ? "Cambiar foto" : "Poner foto de mi planta"}</label>${own ? `<button class="hero-btn" data-act="rmPhoto" data-id="${p.id}">Quitar</button>` : ""}</div>
    ${heroImg ? `<button class="hero-zoom" data-act="zoom" aria-label="Ver foto a pantalla completa">${svg("expand")}</button>` : ""}</div><input type="file" id="dPhoto" accept="image/*" class="hidden">`;
  const html = sheetHead(esc(p.name)) + hero + `
    <div class="detail-top"><div class="big-ring">${ring(s.moist, s.status, true)}<div class="c"><div><b class="num">${Math.round(s.moist * 100)}%</b><span>agua útil</span></div></div></div>
      <div style="display:grid;gap:6px;min-width:0">${statusPill(s)}<div style="font-family:var(--display);font-size:22px;font-weight:700;line-height:1.15">${whenText(s)}</div><div class="muted small">${fmtL(s.liters)}${p.cont === "pot" ? ", hasta que empiece a salir por el plato" : ""} · ${s.conf}</div></div></div>
    ${s.waitRain ? `<div class="alert info" style="margin-top:14px">${svg("rain")}<div>Se esperan <b>${nf1.format(s.waitRain.mm)} mm</b> ${niceDay(s.waitRain.date, today)} (${Math.round(s.waitRain.prob)} %). Si al final no llueve, riega ${fmtL(s.liters)}.</div></div>` : ""}
    <div style="display:flex;gap:8px;margin:16px 0"><button class="btn water" style="flex:1" data-act="water" data-id="${p.id}">${svg("drop")} Lo he regado</button>${AI_MODE ? `<button class="btn" data-act="diagnose" data-id="${p.id}">${svg("stethoscope")} Diagnóstico IA</button>` : ""}</div>
    <div class="card" style="padding:14px"><div class="lbl" style="margin-bottom:6px">Humedad del sustrato · 14 días y previsión</div>${moistChart(s)}</div>
    <div class="kv num" style="margin-top:12px"><div><span>Consumo hoy</span><b>${nf1.format(s.etcToday)} mm</b></div><div><span>Agua útil total</span><b>${fmtL(s.P.taw * s.P.area)}</b></div><div><span>Umbral de riego</span><b>${Math.round((1 - s.P.raw / s.P.taw) * 100)} %</b></div><div><span>Kc especie</span><b>${nf1.format(+sp.kc)}${p.cal && Math.abs(p.cal - 1) > .04 ? ` <span style="display:inline;font-size:12px;color:var(--ink-3)">×${p.cal.toFixed(2)}</span>` : ""}</b></div></div>
    ${plantReview(p, s)}
    ${sp.note ? `<div class="alert info" style="margin-top:12px">${svg("leaf")}<div>${esc(sp.note)}</div></div>` : ""}
    <div class="card" style="margin-top:12px;padding:14px"><div class="lbl" style="margin-bottom:4px">Historial de riegos</div><div class="hist num">${log.length ? log.map(e => `<div><span>${new Date(e.t).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} · ${new Date(e.t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span><span class="faint">${fbTxt[e.fb] || ""}</span></div>`).join("") : `<div><span>Último riego</span><span>${niceDay(p.last.slice(0, 10), today)}</span></div>`}</div></div>
    <div class="muted small" style="margin-top:12px">${esc(sp.n)}${sp.sci ? ` · <i>${esc(sp.sci)}</i>` : ""} · ${{ in: "Interior", out: "Exterior", cov: "Exterior cubierto" }[p.place]} · ${p.cont === "pot" ? "maceta " + p.diam + "×" + p.depth + " cm · " + esc(subInfo(p).label) : p.area + " m², raíces " + p.root + " cm · suelo " + esc(soilInfo(p).label)}</div>
    <div style="display:flex;gap:8px;margin-top:16px"><button class="btn" style="flex:1" data-act="edit" data-id="${p.id}">${svg("edit")} Editar</button><button class="btn ghost" data-act="del" data-id="${p.id}" style="color:var(--crit)">${svg("trash")} Eliminar</button></div>`;
  openSheet(html, sh => {
    const inp = $("#dPhoto", sh); if (inp) inp.onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const im = await resizeImage(f, 900, .8); p.hasThumb = true; await saveThumb(p.id, im.dataUrl); save(); toast("Foto guardada"); openDetail(p.id); render(); } catch (err) { toast("No pude leer esa foto"); } };
    const img = $(".pl-hero img", sh); if (img) img.onclick = () => openZoom(img);
  });
}
function openZoom(img) {
  if (!img) return; const z = document.createElement("div"); z.className = "zoom"; z.setAttribute("role", "dialog"); z.setAttribute("aria-label", "Foto a pantalla completa");
  const full = img.dataset.full || img.src, small = img.dataset.small || img.src;
  z.innerHTML = `<img src="${esc(full)}" alt="${esc(img.alt || "")}"><button class="icon-btn zoom-x" aria-label="Cerrar">${svg("x")}</button>`;
  const im = z.querySelector("img"); im.onerror = () => { if (im.src !== small) im.src = small; };
  const close = () => { z.classList.remove("on"); setTimeout(() => z.remove(), 200); document.removeEventListener("keydown", onKey); zoomOpen = null; };
  const onKey = e => { if (e.key === "Escape") close(); };
  z.onclick = e => { if (e.target === z || e.target.closest(".zoom-x")) close(); };
  document.addEventListener("keydown", onKey); document.body.appendChild(z); requestAnimationFrame(() => z.classList.add("on")); zoomOpen = close;
}
let zoomOpen = null;

/* Revisión sencilla: suelo, maceta, luz, ubicación y temperaturas */
function plantReview(p, s) {
  const sp = spec(p), P = s.P, items = []; const good = t => items.push(["ok", t]), bad = (t, why) => items.push(["warn", t, why]);
  const dry = sp.p >= .65, thirsty = sp.p <= .3, acid = sp.sub === "acid", bark = sp.sub === "bark", cactusLike = sp.sub === "cactus";
  // 1) Suelo o sustrato
  if (p.cont === "pot") {
    const aw = subInfo(p).aw, mine = p.sub === "mix" ? "tu mezcla" : (SUB_LABEL[p.sub] || "el sustrato").toLowerCase();
    if (acid && p.sub !== "acid") bad("Necesita un sustrato ácido", `Es una planta acidófila y ${mine} no lo es. Usa sustrato para plantas ácidas y riega con agua de lluvia o con poca cal.`);
    else if (bark && p.sub !== "bark" && (p.sub !== "mix" || !(p.mix && (p.mix.corteza || p.mix.musgo)))) bad("Mejor un sustrato de corteza", "Sus raíces necesitan aire. Con tierra normal se pudren con facilidad.");
    else if ((dry || cactusLike) && aw > .17) bad("El sustrato retiene demasiada agua", `Es una planta que prefiere secarse entre riegos. Mezcla ${mine} con un 30–50 % de perlita, arena gruesa o pómez.`);
    else if (thirsty && aw < .12) bad("El sustrato se seca demasiado rápido", "Esta planta quiere humedad constante. Añade turba, fibra de coco o humus a la mezcla.");
    else good(`El sustrato (${p.sub === "mix" ? "tu mezcla" : SUB_LABEL[p.sub] || "universal"}) le va bien`);
  } else {
    const si = soilInfo(p), t = TEXTURES[p.soil]; const clayish = p.soil === "custom" ? (+p.clay || 0) >= 40 : t ? t.C >= .4 : p.soil === "clay";
    if (si.aw < .07 && !dry) bad("El suelo retiene poca agua", "Es muy arenoso o pedregoso. Añade compost cada año y pon acolchado (paja, corteza) para que no se seque tan rápido.");
    else if (clayish && (dry || cactusLike)) bad("El suelo puede encharcarse", "Es pesado y a esta planta no le gusta el exceso de agua. Plántala en un pequeño montículo o mezcla arena gruesa en el hoyo.");
    else if (clayish) items.push(["ok", "Suelo arcilloso: guarda bien el agua", "Riega despacio para que lo absorba sin encharcarse."]);
    else good(`El tipo de suelo (${si.label.toLowerCase()}) es adecuado`);
    if (p.om != null && +p.om < 1.5 && p.soil !== "custom") bad("Le falta materia orgánica", "Echa compost o estiércol bien hecho en otoño: mejora el suelo y guarda más agua.");
  }
  // 2) Tamaño de la maceta y frecuencia de riego
  const perDay = Math.max(.05, (s.etcToday || .5)), every = P.raw / perDay;
  if (p.cont === "pot") {
    if (p.size === "2.3" && p.diam < 25) bad("La maceta se le ha quedado pequeña", `Mide ${p.diam} cm y la planta es grande. Trasplántala a una de al menos 30 cm cuando acabe el frío.`);
    else if (every < 1.5 && !thirsty) bad("Necesitará agua casi a diario", "Con este tiempo la maceta se seca muy rápido. Una maceta más grande o un plato con grava húmeda ayuda.");
    else good(`Con este tiempo, regarás aproximadamente cada ${every < 10 ? Math.max(1, Math.round(every)) : Math.round(every)} día${Math.round(every) === 1 ? "" : "s"}`);
    if (p.mat === "terracotta" && thirsty) bad("La maceta de barro le quita humedad", "El barro transpira y seca antes el sustrato. Para esta planta va mejor plástico o cerámica esmaltada.");
  } else good(`Con este tiempo, regarás aproximadamente cada ${Math.max(1, Math.round(every))} días`);
  // 3) Luz
  const lightRank = { shade: 0, part: 1, full: 2 };
  if (lightRank[sp.sun] - lightRank[p.sun] >= 2 || (sp.sun === "full" && p.sun === "part" && p.place === "in")) bad("Le falta luz", sp.place === "in" ? "Acércala a una ventana luminosa." : "Busca un sitio donde le dé el sol al menos 5–6 horas.");
  else if (sp.sun === "shade" && p.sun === "full" && p.place !== "in") bad("Demasiado sol directo", "Sus hojas pueden quemarse. Mejor semisombra o sol solo por la mañana.");
  else good("La luz que recibe es adecuada");
  // 4) Ubicación y temperaturas de los próximos días
  let tmin = null, tmax = null; for (let k = 0; k < 7; k++) { const w = wxDay(addDays(s.today, k)); if (w) { tmin = tmin == null ? w.tmin : Math.min(tmin, w.tmin); tmax = tmax == null ? w.tmax : Math.max(tmax, w.tmax); } }
  if (p.place !== "in" && tmin != null && tmin <= sp.minC) bad(`Pasará frío esta semana (mínima de ${Math.round(tmin)} °C)`, `Aguanta hasta unos ${sp.minC} °C. ${p.cont === "pot" ? "Métela dentro o pégala a una pared resguardada" : "Protégela con manta térmica"} las noches más frías.`);
  else if (p.place !== "in" && tmax != null && tmax >= sp.maxC) bad(`Calor fuerte esta semana (${Math.round(tmax)} °C)`, "Riega al amanecer y dale sombra en las horas centrales.");
  else if (p.place === "in" && sp.place === "out" && sp.minC < 0) items.push(["ok", "Es una planta de exterior", "Puede vivir dentro, pero estará más fuerte en un balcón o terraza luminosos."]);
  else if (tmin != null) good("Las temperaturas de esta semana le van bien");
  // 5) Aprendizaje del modelo
  if (p.cal > 1.3) items.push(["warn", "Gasta más agua de lo normal", "Puede que la maceta sea pequeña o le dé mucho viento. Lo tengo en cuenta al calcular."]);
  else if (p.cal && p.cal < .75) items.push(["warn", "Gasta menos agua de lo normal", "Revisa que la maceta drene bien: el exceso de riego es la causa más común de problemas."]);
  const nWarn = items.filter(i => i[0] === "warn").length;
  return `<div class="card review" style="margin-top:12px"><div class="rv-h"><div class="rv-score ${nWarn ? (nWarn > 1 ? "w2" : "w1") : "ok"}">${svg(nWarn ? "warn" : "ok")}</div><div><b>${nWarn ? (nWarn === 1 ? "1 cosa que mejorar" : nWarn + " cosas que mejorar") : "Todo en orden"}</b><span>Revisión de tu planta</span></div></div>
    <ul class="rv">${items.map(([k, t, why]) => `<li class="${k}">${svg(k === "ok" ? "ok" : "warn")}<div><b>${esc(t)}</b>${why ? `<span>${esc(why)}</span>` : ""}</div></li>`).join("")}</ul></div>`;
}
function moistChart(s) {
  const W = 540, H = 150, pl = 30, pr = 6, pt = 8, pb = 20; const today = s.today;
  const pts = s.series.filter(x => diffDays(today, x.date) >= -14);
  if (pts.length < 2) return `<div class="faint small">Aún no hay historial suficiente.</div>`;
  const xs = i => pl + i * (W - pl - pr) / (pts.length - 1), y = v => pt + (H - pt - pb) * (1 - v);
  const m = pts.map(x => 1 - x.Dr / s.P.taw); const thr = 1 - s.P.raw / s.P.taw; const ti = pts.findIndex(x => x.date === today);
  const past = m.map((v, i) => [xs(i), y(v)]).slice(0, ti + 1), fut = m.map((v, i) => [xs(i), y(v)]).slice(Math.max(0, ti));
  const path = a => a.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  let g = ""; [0, .5, 1].forEach(v => g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${v * 100}%</text>`);
  const area = past.length > 1 ? `<path d="${path(past)} L${past[past.length - 1][0]} ${y(0)} L${past[0][0]} ${y(0)} Z" fill="var(--water)" opacity=".13"/>` : "";
  const ticks = pts.map((x, i) => x.watered ? `<circle cx="${xs(i)}" cy="${y(1)}" r="4" fill="var(--water)"/>` : x.rain > .5 ? `<circle cx="${xs(i)}" cy="${y(1)}" r="3.5" fill="none" stroke="var(--water)" stroke-width="1.5"/>` : "").join("");
  const lbl = pts.map((x, i) => (i % 7 === 0 || i === pts.length - 1) ? `<text x="${xs(i)}" y="${H - 5}" text-anchor="${i === pts.length - 1 ? "end" : i === 0 ? "start" : "middle"}" font-size="10" fill="var(--ink-3)">${i === ti ? "hoy" : new Date(x.date + "T12:00:00").getDate() + " " + MON[new Date(x.date + "T12:00:00").getMonth()]}</text>` : "").join("");
  const now = ti >= 0 ? `<line x1="${xs(ti)}" x2="${xs(ti)}" y1="${pt}" y2="${H - pb}" stroke="var(--ink-3)" stroke-dasharray="3 3"/><circle cx="${xs(ti)}" cy="${y(s.moist)}" r="5" fill="var(--water)" stroke="var(--surface)" stroke-width="2"/>` : "";
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Agua útil en el sustrato">${g}<rect x="${pl}" y="${y(thr)}" width="${W - pl - pr}" height="${y(0) - y(thr)}" fill="var(--warn-soft)"/><line x1="${pl}" x2="${W - pr}" y1="${y(thr)}" y2="${y(thr)}" stroke="var(--warn)" stroke-dasharray="4 3"/><text x="${W - pr - 2}" y="${y(thr) - 4}" text-anchor="end" font-size="10" fill="var(--warn)">regar</text>${area}<path d="${path(past)}" fill="none" stroke="var(--water)" stroke-width="2.4" stroke-linejoin="round"/><path d="${path(fut)}" fill="none" stroke="var(--water)" stroke-width="2.2" stroke-dasharray="5 4" opacity=".7"/>${ticks}${now}${lbl}</svg>
    <div class="legend"><span><i style="background:var(--water)"></i>riego</span><span><i style="border:1.5px solid var(--water)"></i>lluvia</span><span>discontinua: previsión</span></div>`;
}

/* Añadir planta: catálogo + IA */
let catFilter = "all", catQ = "";
function openAdd() {
  const cats = ["all", ...Object.keys(CAT_LABEL).filter(c => CATALOG.some(x => x.cat === c))];
  openSheet(sheetHead("Añadir planta") + `
    ${AI_FULL() ? "" : "<!--"}<div class="ai-actions" style="margin-bottom:14px"><button class="ai-tile" data-act="identify">${svg("camera")}<b>Con una foto</b><span>La IA reconoce la especie.</span></button><button class="ai-tile" data-act="customAI">${svg("wand")}<b>Por su nombre</b><span>Cualquier planta del mundo, la IA la configura.</span></button></div>${AI_FULL() ? "" : "-->"}
    <div class="search">${svg("search")}<input class="input" id="catQ" placeholder="Buscar entre ${CATALOG.length} especies" autocomplete="off" value="${esc(catQ)}"></div>
    <div class="chips" style="margin-top:10px">${cats.map(c => `<button class="chip${c === catFilter ? " on" : ""}" data-act="catF" data-c="${c}">${c === "all" ? "Todas" : CAT_LABEL[c]}</button>`).join("")}</div>
    <div class="cat-list" id="catList"></div>`, sh => { const i = $("#catQ", sh); i.oninput = () => { catQ = i.value; drawCat(); }; drawCat(); });
}
let catIO = null;
function lazyCatPhotos() {
  if (!PHOTO_OK) return; if (catIO) catIO.disconnect();
  catIO = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { const sp = CAT_BY_ID[en.target.dataset.lazy]; if (sp) wantPhoto(sp); catIO.unobserve(en.target); } }), { root: $("#sheet"), rootMargin: "200px" }) : null;
  $$("#catList .av[data-lazy]").forEach(el => { if (el.querySelector("img")) return; if (catIO) catIO.observe(el); else wantPhoto(CAT_BY_ID[el.dataset.lazy]); });
}
function drawCat() {
  const q = norm(catQ); const L = CATALOG.filter(c => (catFilter === "all" || c.cat === catFilter) && (!q || norm(c.n + " " + c.sci).includes(q)));
  const el = $("#catList"); if (!el) return;
  el.innerHTML = L.slice(0, 160).map(c => `<button class="cat-item" data-act="pick" data-t="${c.id}">${avatarSp(c)}<div style="min-width:0"><b>${esc(c.n)}</b><i>${esc(c.sci)}</i></div><div class="tag">${CAT_LABEL[c.cat]}<br>${c.place === "in" ? "interior" : "exterior"}</div></button>`).join("") +
    (L.length > 160 ? `<div class="hint" style="padding:10px 8px">Mostrando 160 de ${L.length}. Escribe para afinar la búsqueda.</div>` : "") + (L.length ? "" : !AI_FULL() ? `<div class="empty"><div>No está en el catálogo. Elige «Otra planta» en la categoría más parecida y ajusta su maceta.</div></div>` : `<div class="empty"><div>No está en el catálogo.</div><button class="btn primary" data-act="customAI" data-q="${esc(catQ)}">${svg("wand")} Configurar «${esc(catQ)}» con IA</button></div>`);
  lazyCatPhotos();
}
/* Formulario */
function openForm(p, isNew) {
  const sp = spec(p); const seg = (name, val, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(val) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const html = sheetHead(isNew ? "Nueva planta" : "Editar planta") + `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px"><label for="fPhoto" class="ph-pick" title="Cambiar foto">${avatar(p, true)}<span class="ph-cam">${svg("camera")}</span></label><input type="file" id="fPhoto" accept="image/*" class="hidden"><div><b>${esc(sp.n)}</b><div class="faint small"><i>${esc(sp.sci || "")}</i></div>${p.custom ? '<span class="pill" style="margin-top:4px">Configurada por IA</span>' : ""}<div class="hint" style="margin-top:4px">Toca la imagen para poner una foto de tu planta</div></div></div>
    <form id="pf" class="stack">
      <div class="field"><label for="fName">Nombre</label><input class="input" id="fName" value="${esc(p.name)}" maxlength="60"></div>
      <div class="field"><span class="lbl">Dónde está</span>${seg("place", p.place, [["out", "Exterior"], ["cov", "Bajo techo"], ["in", "Interior"]])}</div>
      <div class="field"><span class="lbl">Luz</span>${seg("sun", p.sun, [["full", "Sol pleno"], ["part", "Semisombra"], ["shade", "Sombra"]])}</div>
      <div class="field"><span class="lbl">Cultivo</span>${seg("cont", p.cont, [["pot", "Maceta"], ["ground", "En suelo"]])}</div>
      <div id="potF" class="stack ${p.cont === "pot" ? "" : "hidden"}"><div class="row2"><div class="field"><label for="fDiam">Diámetro (cm)</label><input class="input num" id="fDiam" type="number" inputmode="numeric" min="3" max="150" value="${p.diam}"></div><div class="field"><label for="fDepth">Profundidad (cm)</label><input class="input num" id="fDepth" type="number" inputmode="numeric" min="3" max="120" value="${p.depth}"></div></div>
        <div class="row2"><div class="field"><label for="fMat">Maceta</label><select class="input" id="fMat">${[["plastic", "Plástico"], ["glazed", "Cerámica esmaltada"], ["terracotta", "Barro"], ["fabric", "Tela / geotextil"], ["tray", "Semillero / alvéolos"]].map(([v, l]) => `<option value="${v}"${p.mat === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="fSub">Sustrato</label><select class="input" id="fSub">${Object.entries(SUB_LABEL).map(([v, l]) => `<option value="${v}"${p.sub === v ? " selected" : ""}>${l}</option>`).join("")}<option value="mix"${p.sub === "mix" ? " selected" : ""}>Mi propia mezcla…</option></select></div></div>
        <div id="mixF" class="expert ${p.sub === "mix" ? "" : "hidden"}"><div class="lbl">Tu mezcla de sustrato (%)</div>
          <div class="mix-grid">${Object.entries(MIX).map(([k, m]) => `<label class="mix-row" for="mx_${k}"><span>${m.n}</span><input class="input num" type="number" inputmode="numeric" min="0" max="100" step="5" id="mx_${k}" data-mix="${k}" value="${(p.mix && p.mix[k]) || ""}" placeholder="0"></label>`).join("")}</div>
          <div class="mix-out" id="mixOut"></div></div></div>
      <div id="groundF" class="stack ${p.cont === "ground" ? "" : "hidden"}"><div class="row2"><div class="field"><label for="fArea">Superficie (m²)</label><input class="input num" id="fArea" type="number" step="0.05" min="0.05" value="${p.area}"></div><div class="field"><label for="fRoot">Raíces (cm)</label><input class="input num" id="fRoot" type="number" min="5" max="150" value="${p.root}"></div></div>
        <div class="field"><label for="fSoil">Tipo de suelo</label><select class="input" id="fSoil">${Object.entries(TEXTURES).map(([v, t]) => `<option value="${v}"${(p.soil === v || ({ sand: "franco_arenoso", loam: "franco", clay: "arcilla" })[p.soil] === v) ? " selected" : ""}>${t.n}</option>`).join("")}<option value="custom"${p.soil === "custom" ? " selected" : ""}>Tengo un análisis de suelo…</option></select><span class="hint" id="soilHint"></span></div>
        <details class="expert" id="soilX" ${p.soil === "custom" || p.gravel > 0 || p.awOverride > 0 || (p.om != null && +p.om !== 2) ? "open" : ""}><summary>Modo experto del suelo</summary>
          <div id="soilCustom" class="row3 ${p.soil === "custom" ? "" : "hidden"}"><div class="field"><label for="fSand">Arena %</label><input class="input num" id="fSand" type="number" min="0" max="100" value="${p.sand ?? 40}"></div><div class="field"><label for="fClay">Arcilla %</label><input class="input num" id="fClay" type="number" min="0" max="100" value="${p.clay ?? 20}"></div><div class="field"><label>Limo %</label><input class="input num" id="fSilt" disabled></div></div>
          <div class="row2"><div class="field"><label for="fOM">Materia orgánica %</label><input class="input num" id="fOM" type="number" min="0" max="8" step="0.5" value="${p.om ?? 2}"></div><div class="field"><label for="fGravel">Piedras / grava %</label><input class="input num" id="fGravel" type="number" min="0" max="80" step="5" value="${p.gravel || 0}"></div></div>
          <div class="field"><label for="fAWo">Agua útil medida (mm por metro, opcional)</label><input class="input num" id="fAWo" type="number" min="20" max="300" placeholder="Déjalo vacío para calcularla" value="${p.awOverride || ""}"><span class="hint">Si tienes un análisis con capacidad de campo y punto de marchitez, su diferencia en mm/m va aquí.</span></div>
          <div class="mix-out" id="soilOut"></div>
          <details class="howto"><summary>¿Cómo sé qué suelo tengo?</summary><p>Coge un puñado de tierra húmeda y apriétalo: si se deshace, es <b>arenoso</b>; si forma una bola que se rompe al tocarla, <b>franco arenoso</b>; si la bola aguanta y es suave, <b>franco</b>; si puedes hacer un churro que se dobla sin romperse y mancha brillante, <b>arcilloso</b>. Para afinar: llena un bote con tierra y agua, agita y déjalo 2 días; la arena se deposita abajo, encima el limo y arriba la arcilla. Mide cada capa para sacar los porcentajes.</p></details>
        </details></div>
      <div class="field"><span class="lbl">Tamaño de la planta</span>${seg("size", p.size, [["1", "Pequeña"], ["1.5", "Mediana"], ["2.3", "Grande"]])}<span class="hint">Una planta que desborda su maceta transpira más agua de la que cabe en ella.</span></div>
      <div class="field ${p.place === "in" ? "" : "hidden"}" id="heatF"><label for="fHeat">Calefacción</label><select class="input" id="fHeat">${[["auto", "Automático según la temperatura"], ["on", "Encendida"], ["off", "Apagada"]].map(([v, l]) => `<option value="${v}"${p.heat === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="fLast">Último riego</label><input class="input" id="fLast" type="datetime-local" value="${localInput(new Date(p.last))}" max="${localInput(new Date())}"><span class="hint">Si no lo recuerdas, pon un día aproximado. Se corrige solo cuando riegues.</span></div>
      <button class="btn primary block" type="submit">${isNew ? "Añadir planta" : "Guardar cambios"}</button>
    </form>`;
  openSheet(html, sh => {
    const soilUpd = () => {
      const tmp = { soil: $("#fSoil").value, sand: +$("#fSand").value, clay: +$("#fClay").value, om: $("#fOM").value, gravel: +$("#fGravel").value, awOverride: +$("#fAWo").value || 0 };
      $("#soilCustom").classList.toggle("hidden", tmp.soil !== "custom"); if (tmp.soil === "custom") $("#soilX").open = true;
      $("#fSilt").value = Math.max(0, 100 - tmp.sand - tmp.clay);
      const t = TEXTURES[tmp.soil]; $("#soilHint").textContent = t ? "Al tacto: " + t.t.toLowerCase() + "." : "";
      const i = soilInfo(tmp); $("#soilOut").innerHTML = (i.fc != null ? `Capacidad de campo <b>${Math.round(i.fc * 100)} %</b> · Punto de marchitez <b>${Math.round(i.wp * 100)} %</b><br>` : "") + `Agua útil <b>${Math.round(i.aw * 1000)} mm por metro</b> de suelo`;
    };
    ["#fSoil", "#fSand", "#fClay", "#fOM", "#fGravel", "#fAWo"].forEach(id => $(id, sh).addEventListener("input", soilUpd)); soilUpd();
    const mixUpd = () => {
      const m = {}; $$("[data-mix]", sh).forEach(i => { const v = +i.value; if (v > 0) m[i.dataset.mix] = v; }); const tot = Object.values(m).reduce((a, b) => a + b, 0);
      $("#mixOut").innerHTML = tot ? `Total <b class="${tot === 100 ? "" : "warn-t"}">${tot} %</b>${tot !== 100 ? " (se ajusta en proporción)" : ""} · Agua fácilmente disponible <b>${Math.round(mixAW(m) * 100)} %</b> del volumen` : "Pon el porcentaje de cada componente.";
      return m;
    };
    $("#fSub", sh).addEventListener("change", e => $("#mixF").classList.toggle("hidden", e.target.value !== "mix"));
    $$("[data-mix]", sh).forEach(i => i.addEventListener("input", mixUpd)); mixUpd();
    $("#fPhoto", sh).onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const im = await resizeImage(f, 900, .8); p._thumb = im.dataUrl; const av = $(".ph-pick .av", sh); av.innerHTML = `<img src="${im.dataUrl}" alt="">`; av.classList.add("ph"); } catch (err) { toast("No pude leer esa foto"); } };
    $$("[data-seg] button", sh).forEach(b => b.onclick = () => { $$("button", b.parentNode).forEach(x => x.classList.toggle("on", x === b)); const n = b.parentNode.dataset.seg;
      if (n === "cont") { $("#potF").classList.toggle("hidden", b.dataset.v !== "pot"); $("#groundF").classList.toggle("hidden", b.dataset.v !== "ground"); }
      if (n === "place") $("#heatF").classList.toggle("hidden", b.dataset.v !== "in"); });
    $("#pf").onsubmit = e => {
      e.preventDefault(); const v = n => { const b = $(`[data-seg="${n}"] .on`); return b ? b.dataset.v : null; };
      const last = new Date($("#fLast").value || Date.now()); if (last > new Date(Date.now() + 6e4)) { toast("El último riego no puede ser en el futuro"); return; }
      Object.assign(p, { name: $("#fName").value.trim() || sp.n, place: v("place"), sun: v("sun"), cont: v("cont"), size: v("size"), diam: +$("#fDiam").value, depth: +$("#fDepth").value, mat: $("#fMat").value, sub: $("#fSub").value, area: +$("#fArea").value, root: +$("#fRoot").value, soil: $("#fSoil").value, sand: +$("#fSand").value, clay: +$("#fClay").value, om: $("#fOM").value === "" ? 2 : +$("#fOM").value, gravel: +$("#fGravel").value || 0, awOverride: +$("#fAWo").value || 0, heat: $("#fHeat").value, last: last.toISOString() });
      if (p.sub === "mix") { const m = mixUpd(); if (!Object.keys(m).length) { toast("Indica los componentes de tu mezcla"); return; } p.mix = m; }
      if (p.soil === "custom" && p.sand + p.clay > 100) { toast("Arena + arcilla no pueden pasar del 100 %"); return; }
      if (p.cont === "pot" && !(p.diam > 0 && p.depth > 0)) { toast("Indica el diámetro y la profundidad de la maceta"); return; }
      if (p.cont === "ground" && !(p.area > 0 && p.root > 0)) { toast("Indica la superficie y la profundidad de las raíces"); return; }
      if (isNew) S.plants.push(p);
      if (p._thumb) { saveThumb(p.id, p._thumb); p.hasThumb = true; }
      delete p._thumb; save(); closeSheet(); render(); toast(isNew ? "Planta añadida" : "Cambios guardados");
    };
  });
}
/* Riego */
function openWater(id) {
  const p = S.plants.find(x => x.id === id); if (!p) return; const s = simulate(p);
  openSheet(sheetHead("Regar " + esc(p.name)) + `
    <div class="kv num"><div><span>Cantidad recomendada</span><b>${fmtL(Math.max(s.DrNow, .2 * s.P.raw) * s.P.area * s.P.drain)}</b></div><div><span>Agua útil ahora</span><b>${Math.round(s.moist * 100)} %</b></div></div>
    <div class="field" style="margin-top:16px"><span class="lbl">¿Cómo estaba la tierra al tocarla? (ajusta el modelo a tu planta)</span>
      <div class="seg" id="fb"><button type="button" data-v="wet">Aún húmeda</button><button type="button" data-v="ok">En su punto</button><button type="button" data-v="dry">Muy seca</button><button type="button" data-v="skip" class="on">No sé</button></div></div>
    <div class="field" style="margin-top:12px"><label for="wWhen">Cuándo</label><input class="input" id="wWhen" type="datetime-local" value="${localInput(new Date())}" max="${localInput(new Date())}"></div>
    <button class="btn water block" style="margin-top:16px" data-act="doWater" data-id="${p.id}">${svg("drop")} Registrar riego</button>`, sh => $$("#fb button", sh).forEach(b => b.onclick = () => $$("#fb button", sh).forEach(x => x.classList.toggle("on", x === b))));
}
function quickWater(id) {
  const p = S.plants.find(x => x.id === id); if (!p) return;
  const snap = JSON.stringify({ last: p.last, log: p.log || [] }); const when = new Date();
  p.log = p.log || []; if (!p.log.length && p.last) p.log.push({ t: p.last, fb: "skip" });
  p.log.push({ t: when.toISOString(), fb: "skip" }); p.log = p.log.slice(-40); p.last = when.toISOString();
  haptic("success"); save(); render();
  toast(p.name + " regada", { action: "Deshacer", onAction: () => { const o = JSON.parse(snap); p.last = o.last; p.log = o.log; save(); render(); haptic(); } });
}
function doWater(id) {
  const p = S.plants.find(x => x.id === id); if (!p) return;
  const fb = ($("#fb .on") || {}).dataset?.v || "skip"; const when = new Date($("#wWhen").value || Date.now());
  if (fb !== "skip") { const s = simulate(p), r = s.DrNow / s.P.raw; let f = 1;
    if (fb === "wet") f = r > .6 ? .85 : .93; if (fb === "dry") f = r < 1.2 ? 1.15 : 1.07; if (fb === "ok") f = r < .7 ? 1.08 : r > 1.3 ? .93 : 1;
    p.cal = clamp((p.cal || 1) * f, .4, 2.5); }
  p.log = p.log || []; if (!p.log.length && p.last) p.log.push({ t: p.last, fb: "skip" });
  p.log.push({ t: when.toISOString(), fb }); p.log = p.log.sort((a, b) => a.t.localeCompare(b.t)).slice(-40);
  if (when.toISOString() > p.last) p.last = when.toISOString();
  haptic("success"); save(); closeSheet(); render(); toast("Riego registrado");
}
/* Ubicación */
function openLoc() {
  openSheet(sheetHead("¿Dónde están tus plantas?") + `<button class="btn primary block" data-act="gps" style="margin-bottom:12px">${svg("pin")} Usar mi ubicación actual</button><form id="lf" class="stack"><div class="search">${svg("search")}<input class="input" id="lq" placeholder="Ciudad o pueblo, p. ej. Valparaíso, Cuenca" autocomplete="off"></div><button class="btn block" type="submit">Buscar</button></form><div id="lres" class="cat-list" style="margin-top:10px"></div><div class="hint" style="margin-top:10px">El cálculo usa la evaporación y la lluvia de este lugar. Si tienes plantas en dos sitios, cambia la ciudad cuando vayas.</div>`,
    sh => { $("#lf", sh).onsubmit = async e => { e.preventDefault(); const q = $("#lq").value.trim(); if (!q) return; const res = $("#lres"); res.innerHTML = `<div class="empty"><span class="spin"></span></div>`; const r = await geocode(q); res.innerHTML = r.length ? r.map((x, i) => `<button class="cat-item" data-act="setLoc" data-i="${i}"><div class="av">${svg("pin")}</div><div><b>${esc(x.name)}</b><i style="font-style:normal">${esc(x.region || "")}</i></div></button>`).join("") : `<div class="empty">No encontré ese lugar. Prueba con el nombre y la provincia.</div>`; window.__geo = r; }; });
}
async function geocode(q) {
  try { const j = await fetchJSON("https://geocoding-api.open-meteo.com/v1/search?count=6&language=es&format=json&name=" + encodeURIComponent(q), 5000); if (j.results && j.results.length) return j.results.map(x => ({ name: x.name, region: [x.admin2, x.admin1, x.country].filter(Boolean).join(", "), lat: +x.latitude.toFixed(4), lon: +x.longitude.toFixed(4) })); } catch (e) { }
  try { if (AI_MODE === "proxy" || await getSample()) { const r = await aiJSON('Devuelve SOLO JSON {"results":[{"name":"","region":"provincia, comunidad, país","lat":0,"lon":0}]} con hasta 4 localidades reales que coincidan con «' + q + '», priorizando España. Coordenadas con 4 decimales.', { modelTier: "quick" }); if (r && Array.isArray(r.results)) return r.results.filter(x => isFinite(x.lat) && isFinite(x.lon)); } } catch (e) { }
  return [];
}

/* Identificar / diagnosticar con foto */
function photoPicker(title, intro, withPlant, onGo) {
  openSheet(sheetHead(title) + `<p class="muted" style="margin-top:0">${intro}</p>
    <label class="photo-drop" for="ph" id="phBox">${svg("camera")}<b>Hacer o elegir foto</b><span class="small">Hoja y planta enteras, con buena luz</span></label><input type="file" id="ph" accept="image/*" capture="environment" class="hidden">
    ${withPlant ? `<div class="field" style="margin-top:12px"><label for="dPlant">Planta</label><select class="input" id="dPlant"><option value="">Otra / no está en mi lista</option>${S.plants.map(p => `<option value="${p.id}"${p.id === withPlant ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="field" style="margin-top:12px"><label for="dTxt">¿Qué le notas? (opcional si hay foto)</label><textarea class="input" id="dTxt" rows="3" placeholder="Hojas amarillas por abajo, puntas secas…"></textarea></div>` : ""}
    <button class="btn primary block" style="margin-top:14px" id="goAI">${svg("sparkle")} ${withPlant ? "Diagnosticar" : "Identificar"}</button><div id="aiRes" style="margin-top:14px"></div>`, sh => {
    let img = null; $("#ph", sh).onchange = async e => { const f = e.target.files[0]; if (!f) return; try { img = await resizeImage(f); $("#phBox").innerHTML = `<img src="${img.dataUrl}" alt="Foto elegida">`; } catch (err) { toast("No pude leer esa imagen"); } };
    $("#goAI", sh).onclick = () => onGo(img, sh);
  });
}
function startIdentify() {
  if (AI_MODE === "link") { openSheet(sheetHead("Identificar una planta") + `<ol class="steps"><li><b class="n"></b><div><div>Pulsa <b>Abrir Claude</b></div><span>Se abre un chat con la pregunta ya escrita.</span></div></li><li><b class="n"></b><div><div>Pulsa <b>+</b> y adjunta la foto de la planta</div></div></li><li><b class="n"></b><div><div>Envía. Luego búscala aquí en <b>Añadir</b></div><span>Claude te dirá qué especie elegir del catálogo.</span></div></li></ol><button class="btn primary block lg" style="margin-top:18px" data-act="openClaudeId">${svg("sparkle")} Abrir Claude</button>`); return; }
  photoPicker("Identificar con IA", "Haz una foto a tu planta y la reconoceré para configurar su riego automáticamente.", null, async (img, sh) => {
    if (!img) { toast("Primero elige una foto"); return; }
    const res = $("#aiRes", sh), btn = $("#goAI", sh); btn.disabled = true; res.innerHTML = `<div class="ai-out"><span class="typing"><i></i><i></i><i></i></span> Analizando la foto…</div>`;
    try {
      const r = await aiIdentify(img.blob); btn.disabled = false;
      if (!r || (!r.match && !r.custom)) { res.innerHTML = `<div class="ai-out">No he podido reconocerla. Prueba con otra foto más cercana.</div>`; return; }
      const m = r.match && CAT_BY_ID[r.match];
      res.innerHTML = `<div class="ai-out"><p><b>${esc(r.name || (m && m.n) || "Planta")}</b> <i class="faint">${esc(r.scientific || "")}</i> · ${Math.round((r.confidence || 0) * 100)} % de confianza</p>${r.health ? `<p class="muted">${esc(r.health)}</p>` : ""}<button class="btn primary block" id="useId">${svg("plus")} Añadir y configurar</button></div>`;
      $("#useId").onclick = () => { const p = m ? mkPlant(m.id) : customPlant(r.custom, r); p.name = r.name || p.name; p._thumb = img.thumb; openForm(p, true); };
    } catch (e) { btn.disabled = false; res.innerHTML = `<div class="ai-out">${aiErr(e)}</div>`; }
  });
}
function customPlant(c, r = {}) {
  const cats = Object.keys(CAT_LABEL); const cat = cats.includes(c && c.cat) ? c.cat : "otra";
  const cu = { n: (c && c.name) || r.name || "Planta", sci: (c && c.scientific) || r.scientific || "", cat, kc: clamp(+c.kc || .8, .15, 1.3), p: clamp(+c.p || .5, .1, .9), minC: isFinite(+c.minC) ? +c.minC : 2, maxC: isFinite(+c.maxC) ? +c.maxC : 36, note: (c && c.note) || "" };
  const p = mkPlant("x", { name: cu.n, custom: cu, place: c.place === "in" ? "in" : "out", sun: ["full", "part", "shade"].includes(c.sun) ? c.sun : "part", sub: SUB_LABEL[c.sub] ? c.sub : "universal", size: ["1", "1.5", "2.3"].includes(String(c.size)) ? String(c.size) : "1.5" });
  p.diam = clamp(+c.d || 20, 5, 120); p.depth = Math.round(p.diam * .9); p.mat = p.sub === "cactus" ? "terracotta" : "plastic"; p.cont = "pot";
  return p;
}
function startCustom(prefill) {
  openSheet(sheetHead("Cualquier planta, con IA") + `<p class="muted" style="margin-top:0">Escribe el nombre (común o científico) y la IA calculará sus parámetros de riego: coeficiente de cultivo, tolerancia a la sequía, temperaturas límite y sustrato.</p>
    <form id="cf" class="stack"><input class="input" id="cq" placeholder="p. ej. Ceropegia woodii, Pata de elefante…" value="${esc(prefill || "")}"><button class="btn primary block" type="submit">${svg("wand")} Configurar</button></form><div id="cres" style="margin-top:12px"></div>`, sh => {
    $("#cf", sh).onsubmit = async e => { e.preventDefault(); const q = $("#cq").value.trim(); if (!q) return; const res = $("#cres"); res.innerHTML = `<div class="ai-out"><span class="typing"><i></i><i></i><i></i></span> Consultando…</div>`;
      try { const c = await aiCustom(q); if (!c || !c.kc) throw {}; const p = customPlant(c); res.innerHTML = `<div class="ai-out"><p><b>${esc(c.name)}</b> <i class="faint">${esc(c.scientific || "")}</i></p><p class="muted small">Kc ${nf1.format(+c.kc)} · agota el ${Math.round(c.p * 100)} % antes de regar · ${c.minC}–${c.maxC} °C</p>${c.note ? `<p>${esc(c.note)}</p>` : ""}<button class="btn primary block" id="useC">${svg("plus")} Continuar</button></div>`; $("#useC").onclick = () => openForm(p, true); }
      catch (err) { res.innerHTML = `<div class="ai-out">${err && err.code ? aiErr(err) : "No he podido configurarla. Revisa el nombre e inténtalo de nuevo."}</div>`; } };
  });
}
function startDiagnose(pid) {
  if (AI_MODE === "link") {
    const cur = pid || (S.plants[0] && S.plants[0].id) || "";
    openSheet(sheetHead("Diagnóstico") + `<p class="muted" style="margin-top:0">Cuéntame qué le notas. Se abrirá Claude con tu planta, su riego reciente y el tiempo; allí puedes adjuntar una foto con el botón <b>+</b>.</p>
      <div class="field"><label for="dPlant">Planta</label><select class="input" id="dPlant"><option value="">Otra / no está en mi lista</option>${S.plants.map(p => `<option value="${p.id}"${p.id === cur ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field" style="margin-top:12px"><label for="dTxt">¿Qué le pasa?</label><textarea class="input" id="dTxt" rows="3" placeholder="Hojas amarillas por abajo, puntas secas…"></textarea></div>
      <button class="btn primary block lg" style="margin-top:16px" data-act="openClaudeDx">${svg("sparkle")} Abrir Claude</button>`);
    return;
  }
  photoPicker("Diagnóstico con IA", "Cuéntame qué le pasa o haz una foto. Tendré en cuenta su riego reciente y el tiempo.", pid || (S.plants[0] && S.plants[0].id) || "-", async (img, sh) => {
    const id = $("#dPlant").value, txt = $("#dTxt").value.trim(); if (!img && !txt) { toast("Añade una foto o describe el problema"); return; }
    const p = S.plants.find(x => x.id === id); let ctx = "";
    if (p) { const s = simulate(p); ctx = `Planta: ${p.name} (${spec(p).n}). Agua útil actual estimada ${Math.round(s.moist * 100)} %. Riegos recientes: ${(p.log || []).slice(-5).map(e => e.t.slice(0, 10) + (e.fb !== "skip" ? " (tierra " + e.fb + ")" : "")).join(", ") || p.last.slice(0, 10)}.`; }
    const out = $("#aiRes", sh); out.innerHTML = `<div class="ai-out"></div>`; $("#goAI", sh).disabled = true;
    await aiStream(AI_SYS + "\n\n" + gardenContext() + "\n\n" + ctx + "\nSíntomas descritos: " + (txt || "(ver foto)") + "\n\nTAREA: Diagnostica el problema más probable y alternativas, indica si tiene relación con el riego (exceso o falta, según los datos), y da un plan de acción concreto en pasos. Si la foto no basta, di qué comprobar. Máximo 220 palabras.", out.firstChild, img ? { images: [img.blob] } : {});
    $("#goAI", sh).disabled = false;
  });
}

/* ================== Eventos ================== */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act, id = b.dataset.id;
  if (a === "close") closeSheet();
  else if (a === "detail") openDetail(id);
  else if (a === "water") openWater(id);
  else if (a === "doWater") doWater(id);
  else if (a === "edit") { const p = S.plants.find(x => x.id === id); p && openForm(p, false); }
  else if (a === "del") { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.innerHTML = svg("trash") + " Pulsa otra vez para borrar"; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ""; b.innerHTML = svg("trash") + " Eliminar"; } }, 3500); return; }
    S.plants = S.plants.filter(x => x.id !== id); delete thumbs[id]; if (DB) DB.doc("garden/thumb-" + id).delete().catch(() => { }); save(); closeSheet(); render(); toast("Planta eliminada"); }
  else if (a === "add") openAdd();
  else if (a === "pick") { openForm(mkPlant(b.dataset.t), true); }
  else if (a === "catF") { catFilter = b.dataset.c; $$(".chip[data-act=catF]").forEach(c => c.classList.toggle("on", c === b)); drawCat(); }
  else if (a === "customAI") startCustom(b.dataset.q || "");
  else if (a === "identify") startIdentify();
  else if (a === "diagnose") startDiagnose(id);
  else if (a === "insight") aiInsight();
  else if (a === "ask") ask(b.dataset.q);
  else if (a === "clearChat") { S.chat = []; save(); renderAI(); }
  else if (a === "loc") openLoc();
  else if (a === "setLoc") { const x = (window.__geo || [])[+b.dataset.i]; if (x) { S.loc = x; S.wx = null; ACCU_TOOLS = ACCU_TOOLS; save(); closeSheet(); refreshWeather(true); toast("Ubicación: " + x.name); } }
  else if (a === "wxRetry") refreshWeather(true);
  else if (a === "quick") quickWater(id);
  else if (a === "gps") useGPSFlow(b);
  else if (a === "settings") openSettings();
  else if (a === "theme") { S.prefs.theme = b.dataset.v; applyTheme(); save(); openSettings(); }
  else if (a === "testNotif") testNotif();
  else if (a === "share") shareApp();
  else if (a === "zoom") openZoom(b.closest(".pl-hero").querySelector("img"));
  else if (a === "rmPhoto") { delete thumbs[id]; const p = S.plants.find(x => x.id === id); if (p) p.hasThumb = false; lsSet(); if (DB) DB.doc("garden/thumb-" + id).delete().catch(() => { }); save(); render(); openDetail(id); toast("Foto quitada"); }
  else if (a === "openClaudeId") { closeSheet(); openClaude("Te voy a adjuntar una foto de una planta. Identifica la especie, dime si se ve sana y cómo debo regarla según el tiempo de mi zona. Dime también qué tipo elegir en el catálogo de mi app (por ejemplo «Potos», «Romero», «Tomate (crecimiento)»)."); }
  else if (a === "openClaudeDx") { const p = S.plants.find(x => x.id === $("#dPlant").value); const t = $("#dTxt").value.trim(); let extra = ""; if (p) { const s = simulate(p); extra = `La planta es ${p.name} (${spec(p).n}). Riegos recientes: ${(p.log || []).slice(-5).map(e => e.t.slice(0, 10)).join(", ") || p.last.slice(0, 10)}. Agua útil estimada ahora: ${Math.round(s.moist * 100)} %. `; } closeSheet(); openClaude(extra + "Síntomas: " + (t || "te adjunto una foto") + ". Dime el problema más probable, si tiene que ver con el riego y qué hago paso a paso. Si te adjunto foto, úsala."); }
  else if (a === "install") installApp();
  else if (a === "hideInstall") { S.prefs.hideInstall = true; save(); render(); }
  else if (a === "ics") exportCalendar();
  else if (a === "clearExamples") { S.plants = S.plants.filter(p => !p.example); save(); render(); toast("Ejemplos eliminados"); }
});
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-act]")) { e.preventDefault(); e.target.click(); } });
$$(".tab[data-view]").forEach(t => t.onclick = () => setView(t.dataset.view));
$("#tabAdd").onclick = openAdd;
$("#locBtn").onclick = openLoc;
$("#setBtn").onclick = openSettings;
async function useGPSFlow(btn, after) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Localizando…';
  try { const loc = await getGPS(); S.loc = loc; S.wx = null; save(); if (after) after(loc); else { closeSheet(); toast("Ubicación: " + loc.name); } refreshWeather(true); }
  catch (e) { toast(e && e.code === "denied" ? "Permiso de ubicación denegado. Busca tu ciudad por su nombre." : "No pude obtener tu ubicación. Busca tu ciudad."); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}
async function shareApp() {
  const url = CONFIG.siteUrl || location.href.split("#")[0], text = "Mira Rocío: te dice cuándo y cuánto regar cada planta según el tiempo de tu ciudad. Es gratis:";
  try {
    if (IS_NATIVE && N.Share) { await N.Share.share({ title: "Rocío", text, url, dialogTitle: "Compartir Rocío" }); return; }
    if (navigator.share) { await navigator.share({ title: "Rocío", text, url }); return; }
  } catch (e) { if (e && (e.name === "AbortError" || /cancel/i.test(e.message || ""))) return; }
  try { await navigator.clipboard.writeText(text + " " + url); toast("Enlace copiado: pégalo en WhatsApp"); } catch (e) { openSheet(sheetHead("Compartir Rocío") + `<p class="muted">Copia este enlace y envíaselo a tus amigos:</p><input class="input" readonly value="${esc(url)}" onclick="this.select()">`); }
}
async function installApp() {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; if (r && r.outcome === "accepted") { S.prefs.installed = true; save(); } render(); return; }
  const steps = IS_IOS ? [["Abre esta página en <b>Safari</b>", "En otros navegadores de iPhone no aparece la opción."], ["Pulsa el botón <b>Compartir</b>", "El cuadrado con una flecha hacia arriba, abajo en la pantalla."], ["Elige <b>Añadir a pantalla de inicio</b>", "Desliza hacia abajo en el menú si no lo ves."], ["Pulsa <b>Añadir</b>", "Rocío aparecerá con su icono, como cualquier otra app."]]
    : [["Abre esta página en <b>Chrome</b>", ""], ["Pulsa el menú <b>⋮</b>", "Arriba a la derecha."], ["Elige <b>Instalar aplicación</b>", "O «Añadir a pantalla de inicio»."], ["Confirma con <b>Instalar</b>", "Rocío aparecerá con su icono, como cualquier otra app."]];
  openSheet(sheetHead("Instalar Rocío") + `<ol class="steps">${steps.map(([a, b]) => `<li><b class="n"></b><div><div>${a}</div>${b ? `<span>${b}</span>` : ""}</div></li>`).join("")}</ol>
    ${IS_ANDROID && CONFIG.apkUrl ? `<div class="alert info" style="margin-top:14px">${svg("bell")}<div>¿Quieres <b>avisos en el móvil</b> cuando toque regar? Instala la app de Android.<div style="margin-top:8px"><a class="btn sm water" href="${esc(CONFIG.apkUrl)}">Descargar app de Android</a></div></div></div>` : ""}`);
}
function reminderDays(n = 14) {
  const today = isoDate(new Date()), L = sims(), out = [];
  for (let k = 0; k < n; k++) { const d = addDays(today, k); const list = L.filter(x => x.s.status === "rain" ? x.s.waitRain.date < d : (x.s.dd <= 0 || x.s.due <= d)); if (list.length) out.push({ d, list }); }
  return out;
}
function exportCalendar() {
  const days = reminderDays(14); if (!days.length) { toast("No hay riegos previstos en las próximas dos semanas"); return; }
  const [hh, mm] = (S.prefs.hour || "09:00").split(":"); const pad = n => String(n).padStart(2, "0"); const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const escI = t => String(t).replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Rocio//Riego//ES\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Riegos (Rocío)\r\n";
  for (const { d, list } of days) {
    const dt = d.replace(/-/g, "") + "T" + pad(hh) + pad(mm) + "00";
    ics += "BEGIN:VEVENT\r\nUID:rocio-" + d + "@riego\r\nDTSTAMP:" + stamp + "\r\nDTSTART:" + dt + "\r\nDURATION:PT15M\r\nSUMMARY:" + escI("Regar: " + list.map(x => x.p.name).join(", ")) + "\r\nDESCRIPTION:" + escI(list.map(x => x.p.name + ": " + fmtL(x.s.liters)).join("\n") + "\nAbre Rocío antes de regar: la previsión puede haber cambiado.") + "\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Toca regar\r\nTRIGGER:PT0M\r\nEND:VALARM\r\nEND:VEVENT\r\n";
  }
  ics += "END:VCALENDAR\r\n";
  if (IS_IOS) { location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "riegos-rocio.ics"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Abre el archivo descargado para añadir los riegos a tu calendario");
}
function installBanner() {
  if (!IS_PWA || IS_STANDALONE() || S.prefs.hideInstall || S.prefs.installed) return "";
  return `<div class="install card">${svg("dropFill")}<div style="flex:1;min-width:0"><b>Instala Rocío en tu móvil</b><span>Ábrela desde su icono, sin navegador${IS_ANDROID && CONFIG.apkUrl ? ", o descarga la app con avisos" : ""}.</span></div><button class="btn sm primary" data-act="install">Instalar</button><button class="icon-btn ghost" data-act="hideInstall" aria-label="Ocultar">${svg("x")}</button></div>`;
}
/* Ajustes */
async function openSettings() {
  const perm = await notifPermission(); const th = S.prefs.theme || "auto";
  const html = sheetHead("Ajustes") + `
    <div class="set-group"><div class="set-row" data-act="loc" role="button" tabindex="0">${svg("pin")}<div><b>Ubicación</b><span>${esc(S.loc ? S.loc.name + (S.loc.region ? ", " + S.loc.region : "") : "Sin elegir")}</span></div><em>Cambiar</em></div></div>
    <div class="lbl set-lbl">Recordatorios</div>
    <div class="set-group">
      ${IS_NATIVE ? `<label class="set-row" for="sNotify">${svg("bell")}<div><b>Avisarme cuando toque regar</b><span>${perm === "granted" ? "Un aviso al día con las plantas que tocan" : perm === "denied" ? "Permiso denegado: actívalo en Ajustes de Android" : "Necesita tu permiso"}</span></div><input type="checkbox" class="switch" id="sNotify" ${S.prefs.notify !== false && perm === "granted" ? "checked" : ""}></label>` : ""}
      ${!IS_NATIVE && !IN_CLAUDE ? `<div class="set-row" data-act="ics" role="button" tabindex="0">${svg("bell")}<div><b>Añadir riegos a mi calendario</b><span>Tu calendario te avisará los próximos 14 días. Repítelo de vez en cuando.</span></div></div>` : ""}
      ${!IS_NATIVE && IS_ANDROID && CONFIG.apkUrl ? `<a class="set-row" href="${esc(CONFIG.apkUrl)}">${svg("check")}<div><b>App de Android con avisos</b><span>Descárgala para recibir notificaciones automáticas</span></div><em>Descargar</em></a>` : ""}
      <label class="set-row" for="sHour">${svg("sun")}<div><b>Hora del aviso</b><span>Mejor a primera hora</span></div><input type="time" id="sHour" class="input time" value="${S.prefs.hour || "09:00"}"></label>
      ${IS_NATIVE && perm === "granted" ? `<div class="set-row" data-act="testNotif" role="button" tabindex="0">${svg("check")}<div><b>Probar un aviso</b><span>Llega en 5 segundos</span></div></div>` : ""}
    </div>
    ${CONFIG.siteUrl || IS_PWA ? `<div class="lbl set-lbl">Compartir</div><div class="set-group">
      <div class="set-row" data-act="share" role="button" tabindex="0">${svg("send")}<div><b>Pasar Rocío a un amigo</b><span>Envíale el enlace por WhatsApp o donde quieras</span></div></div>
      ${IS_PWA && !IS_STANDALONE() ? `<div class="set-row" data-act="install" role="button" tabindex="0">${svg("plus")}<div><b>Instalar en este móvil</b><span>Tenla en la pantalla de inicio, como una app</span></div></div>` : ""}</div>` : ""}
    <div class="lbl set-lbl">Apariencia</div>
    <div class="seg">${[["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]].map(([v, l]) => `<button type="button" data-act="theme" data-v="${v}" class="${th === v ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="lbl set-lbl">Tus datos</div>
    <div class="set-group"><div class="set-row" data-act="exportData" role="button" tabindex="0">${svg("refresh")}<div><b>Copia de seguridad</b><span>Copia o restaura tus plantas y su historial</span></div></div></div>
    <div class="lbl set-lbl">Acerca de</div>
    <div class="about small muted">
      <p><b>Rocío ${esc(CONFIG.version)}</b>. Riego calculado con el método FAO‑56 a partir del tiempo de tu ubicación.</p>
      <p>${IN_CLAUDE ? "Tus plantas se guardan en tu cuenta de Claude." : "Tus plantas se guardan solo en este dispositivo. No hay cuentas, anuncios ni rastreo."}</p>
      <p><a href="https://open-meteo.com/" target="_blank" rel="noopener">Datos meteorológicos de Open‑Meteo.com</a> (CC BY 4.0).</p>
      ${PHOTO_OK ? `<p>Fotos de referencia de las especies: <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener">Wikimedia Commons</a>, con licencias libres de sus autores.</p>` : ""}
      ${CONFIG.privacyUrl ? `<p><a href="${esc(CONFIG.privacyUrl)}" target="_blank" rel="noopener">Política de privacidad</a></p>` : ""}
      ${CONFIG.contactEmail ? `<p>Contacto: ${esc(CONFIG.contactEmail)}</p>` : ""}
    </div>`;
  openSheet(html, sh => {
    $("#sHour", sh).onchange = e => { S.prefs.hour = e.target.value || "09:00"; save(); };
    const sw = $("#sNotify", sh); if (sw) sw.onchange = async () => { if (sw.checked) { const ok = await askNotif(); if (!ok) { sw.checked = false; toast("Activa las notificaciones de Rocío en los ajustes de Android"); } S.prefs.notify = ok; } else S.prefs.notify = false; save(); haptic(); };
  });
}
async function testNotif() { try { await N.LocalNotifications.schedule({ notifications: [{ id: 9, channelId: "riego", title: "Así te avisaré", body: "Cuando toque regar verás aquí tus plantas y cuánta agua echar.", schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }, smallIcon: "ic_stat_drop", iconColor: "#2c6a4c" }] }); toast("Aviso programado: llega en 5 s"); } catch (e) { toast("No se pudo programar el aviso"); } }
function openBackup() {
  openSheet(sheetHead("Copia de seguridad") + `<p class="muted" style="margin-top:0">Copia este texto y guárdalo (por ejemplo, envíatelo por correo). Para restaurar, pégalo aquí y pulsa Restaurar.</p>
    <textarea class="input" id="bk" rows="7" spellcheck="false" style="font:12px ui-monospace,monospace">${esc(JSON.stringify({ app: "rocio", v: 2, loc: S.loc, plants: S.plants, prefs: S.prefs }))}</textarea>
    <div class="row2" style="margin-top:12px"><button class="btn" id="bkCopy">Copiar</button><button class="btn primary" id="bkRestore">Restaurar</button></div>`, sh => {
    $("#bkCopy", sh).onclick = async () => { try { await navigator.clipboard.writeText($("#bk").value); toast("Copiado"); } catch (e) { $("#bk").select(); toast("Selecciona el texto y cópialo"); } };
    $("#bkRestore", sh).onclick = () => { try { const j = JSON.parse($("#bk").value); if (j.app !== "rocio" || !Array.isArray(j.plants)) throw 0; S.plants = j.plants; if (j.loc) S.loc = j.loc; if (j.prefs) S.prefs = Object.assign(S.prefs, j.prefs); S.wx = null; save(); closeSheet(); refreshWeather(true); toast("Datos restaurados"); } catch (e) { toast("Ese texto no es una copia válida de Rocío"); } };
  });
}
document.addEventListener("click", e => { if (e.target.closest("[data-act=exportData]")) openBackup(); });
/* Bienvenida (primera vez fuera de Claude) */
function onboarding(step = 0) {
  const o = $("#onb"); o.classList.remove("hidden"); document.body.style.overflow = "hidden";
  const dots = `<div class="onb-dots">${[0, 1, 2].map(i => `<i class="${i === step ? "on" : ""}"></i>`).join("")}</div>`;
  if (step === 0) o.innerHTML = `<div class="onb-in"><div class="onb-art">${svg("dropFill")}</div><h1>Riega justo cuando toca</h1><p class="lead">Rocío calcula cada día cuánta agua pierde cada planta según el tiempo de tu ciudad y te avisa cuando hay que regar.</p>
    <ul class="onb-list"><li>${svg("cloud")}<span><b>Tiempo real</b> de tu ubicación: sol, lluvia, calor y heladas</span></li><li>${svg("leaf")}<span><b>${CATALOG.length} especies</b> con sus necesidades de agua</span></li><li>${svg("bell")}<span><b>Avisos</b> con la cantidad exacta para cada planta</span></li></ul>
    <div class="onb-foot">${dots}<button class="btn primary block lg" id="onbNext">Empezar</button></div></div>`;
  if (step === 1) o.innerHTML = `<div class="onb-in"><div class="onb-art sm">${svg("pin")}</div><h1>¿Dónde están tus plantas?</h1><p class="lead">Lo uso solo para consultar el tiempo de ese lugar.</p>
    <button class="btn primary block lg" id="onbGps">${svg("pin")} Usar mi ubicación</button>
    <div class="onb-or">o busca tu ciudad</div><form id="onbF" class="search">${svg("search")}<input class="input" id="onbQ" placeholder="Ciudad o pueblo" autocomplete="off" enterkeyhint="search"></form><div id="onbR" class="cat-list"></div>
    <div class="onb-foot">${dots}</div></div>`;
  if (step === 2) o.innerHTML = `<div class="onb-in"><div class="onb-art sm">${svg("bell")}</div><h1>${IS_NATIVE ? "Te aviso cuando toque" : "¿A qué hora riegas?"}</h1><p class="lead">${IS_NATIVE ? "Un único aviso al día, solo si alguna planta necesita agua." : "La usaré para tus recordatorios. Podrás añadirlos a tu calendario desde Ajustes."}</p>
    <label class="set-row card" for="onbH" style="margin-top:8px">${svg("sun")}<div><b>Hora del aviso</b><span>Regar temprano reduce la evaporación</span></div><input type="time" id="onbH" class="input time" value="${S.prefs.hour || "09:00"}"></label>
    <div class="onb-foot">${dots}<button class="btn primary block lg" id="onbYes">${IS_NATIVE ? "Activar avisos" : "Continuar"}</button>${IS_NATIVE ? '<button class="btn ghost block" id="onbNo">Ahora no</button>' : ""}</div></div>`;
  const next = () => onboarding(step + 1);
  if (step === 0) $("#onbNext").onclick = () => { haptic(); next(); };
  if (step === 1) {
    $("#onbGps").onclick = e => useGPSFlow(e.currentTarget, () => next());
    $("#onbF").onsubmit = async e => { e.preventDefault(); const q = $("#onbQ").value.trim(); if (!q) return; $("#onbQ").blur(); const r = $("#onbR"); r.innerHTML = '<div class="empty"><span class="spin"></span></div>'; const res = await geocode(q);
      r.innerHTML = res.length ? res.map((x, i) => `<button class="cat-item" data-i="${i}"><div class="av">${svg("pin")}</div><div><b>${esc(x.name)}</b><i style="font-style:normal">${esc(x.region || "")}</i></div></button>`).join("") : '<div class="empty">No lo encuentro. Prueba con el nombre y la provincia.</div>';
      $$("button[data-i]", r).forEach(b => b.onclick = () => { S.loc = res[+b.dataset.i]; S.wx = null; save(); refreshWeather(true); next(); }); };
  }
  if (step === 2) {
    $("#onbH").onchange = e => { S.prefs.hour = e.target.value || "09:00"; };
    const done = () => { S.onboarded = true; save(); o.classList.add("hidden"); o.innerHTML = ""; document.body.style.overflow = ""; render(); setTimeout(openAdd, 250); };
    $("#onbYes").onclick = async () => { S.prefs.notify = IS_NATIVE ? await askNotif() : false; done(); };
    if ($("#onbNo")) $("#onbNo").onclick = () => { S.prefs.notify = false; done(); };
  }
}

/* ================== Arranque ================== */
if (IS_PWA && "serviceWorker" in navigator && location.protocol === "https:") window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
(function boot() {
  const ls = lsGet(); if (ls) S = Object.assign(S, ls);
  try { thumbs = JSON.parse(localStorage.getItem(LS + ".th") || "{}"); } catch (e) { }
  if (!S.loc && IN_CLAUDE) S.loc = DEFAULT_LOC;
  applyTheme(); seed(); render();
  if (!IN_CLAUDE && !S.onboarded) onboarding(0);
  if (IS_NATIVE) {
    try { N.SplashScreen.hide(); } catch (e) { }
    if (N.LocalNotifications) N.LocalNotifications.createChannel({ id: "riego", name: "Recordatorios de riego", description: "Aviso diario cuando una planta necesita agua", importance: 4, visibility: 1 }).catch(() => { });
    if (N.App) {
      N.App.addListener("backButton", () => { if (zoomOpen) zoomOpen(); else if ($("#scrim").classList.contains("open")) closeSheet(); else if (!$("#onb").classList.contains("hidden")) { } else if (VIEW !== "today") setView("today"); else N.App.minimizeApp(); });
      N.App.addListener("appStateChange", st => { if (st.isActive) { refreshWeather(false); render(); } else scheduleReminders(); });
    }
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
    scheduleRemindersSoon();
  }
  if (IN_CLAUDE) initDB().then(() => { seed(); refreshWeather(false); }); else refreshWeather(false);
  getSample().then(() => render());
  setTimeout(() => { if (!S.wx) refreshWeather(false); }, 1500);
  setInterval(() => refreshWeather(false), 20 * 6e4);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshWeather(false); });
})();
