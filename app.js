/* ============================================================================
 * RaceNext Results — vanilla JS client.
 *
 * Architecture:
 *   - Hash routing: #/, #/event/<id>, #/race/<id>
 *   - i18n: data is localized with [:lang]text[:other]other[:] markers; UI is
 *     translated via UI dictionaries below; user can switch language in the
 *     toolbar.
 *   - Transport chain (CORS-bypass): same-origin /api/ → direct → custom proxy
 *     from settings → public free proxies (allorigins / codetabs / thingproxy).
 *     The first transport that works is used; the last successful public proxy
 *     is remembered in localStorage so subsequent requests skip dead ones.
 *   - In-memory cache per session (cleared on page reload). No data ever
 *     persists in the repository.
 * ============================================================================ */

const API = "https://org-api.racenext.app";

// Free public CORS proxies tried as a last fallback. Used when the page is on
// GitHub Pages (or anywhere without a same-origin proxy) and the API itself
// does not advertise CORS. Pure pass-through; no API keys.
const PUBLIC_PROXIES = [
  { id: "allorigins", make: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { id: "codetabs",   make: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
  { id: "thingproxy", make: u => `https://thingproxy.freeboard.io/fetch/${u}` },
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const app = $("#app");
const settingsDlg = $("#settingsDlg");

// ---------- i18n: UI strings ----------

const SUPPORTED_LANGS = ["uk", "en"];
let currentLang = localStorage.getItem("rn_lang") || "uk";
if (!SUPPORTED_LANGS.includes(currentLang)) currentLang = "uk";

const UI = {
  uk: {
    brand: "RaceNext Results",
    home: "Усі івенти",
    refresh: "Оновити",
    settings: "Налаштування",
    searchEvents: "Пошук по назві / місту / даті…",
    searchResults: "Пошук: ім'я, номер, категорія…",
    eventsCount: n => `${n} ${plural(n, ["івент", "івенти", "івентів"])}`,
    eventsFiltered: (n, t) => `${n} з ${t}`,
    racesCount: n => `${n} ${plural(n, ["дистанція", "дистанції", "дистанцій"])}`,
    participantsCount: n => `${n} ${plural(n, ["учасник", "учасники", "учасників"])}`,
    noEvents: "Жодного публічного івенту не знайдено.",
    noRaces: "Цей івент не містить дистанцій.",
    noResults: race_id => `Для дистанції #${race_id} результатів не повернулось.`,
    noResultsYet: "Результатів ще немає",
    loading: "Завантаження…",
    loadingResults: "Завантаження результатів…",
    error: "Помилка",
    errorEventsFail: "Не вдалося завантажити список івентів.",
    errorEventFail: id => `Не вдалося завантажити івент #${id}.`,
    errorResultsFail: id => `Не вдалося завантажити результати дистанції #${id}.`,
    proxyAllFailed: "Схоже, усі публічні CORS-проксі недоступні. Відкрий ⚙︎ і додай свій (інструкція у README.md), або запусти локально через python3 server.py.",
    corsHintLocal: "Якщо відкрив index.html напряму через file:// — спробуй запустити python3 server.py у папці web/.",
    save: "Зберегти", clear: "Скинути",
    settingsTitle: "Налаштування", customProxy: "Свій CORS-проксі",
    customProxyHint: "Залиш порожнім — сайт спочатку спробує локальний server.py, потім ланцюжок безкоштовних публічних проксі. Можна вставити свій (наприклад, Cloudflare Worker — гайд у README).",
    forceProxy: "Завжди ходити через свій проксі",
    bearerToken: "Bearer-токен",
    tokenHint: "Потрібен лише для приватних запитів. Зберігається у localStorage браузера.",
    sortBy: "Сортувати:",
    filterAll: "Усі",
    filterGender: "Стать",
    filterCategory: "Категорія",
    filterMen: "Чоловіки", filterWomen: "Жінки",
    columnRank: "Місце", columnRankCat: "В категорії",
    columnBib: "№", columnName: "Учасник",
    columnGender: "Стать", columnCategory: "Категорія", columnClub: "Клуб / місто",
    columnTime: "Час", columnPace: "Темп",
    showSplits: "Розгорнути всі", hideSplits: "Згорнути всі",
    exportCsv: "Експорт у CSV",
    genderM: "Чоловіча", genderF: "Жіноча",
    openSite: "Перейти на сайт",
    rawData: "Усі дані (JSON)",
    placeOverall: "Загальне місце",
    placeGender: "Місце за статтю", placeCategory: "Місце в категорії",
    finishTime: "Фінішний час", chipTime: "Чистий час", gunTime: "Час від старту",
    netTime: "Чистий час",
    splits: "Спліти",
    description: "Про подію",
    footerDisclaimer: "Усі права на бренд RaceNext та дані подій належать їх власникам. Це неофіційний клієнт, створений виключно для зручнішого перегляду публічних результатів.",
    footerData: "Дані",
  },
  en: {
    brand: "RaceNext Results",
    home: "All events",
    refresh: "Refresh",
    settings: "Settings",
    searchEvents: "Search by name / city / date…",
    searchResults: "Search: name, bib, category…",
    eventsCount: n => `${n} event${n === 1 ? "" : "s"}`,
    eventsFiltered: (n, t) => `${n} of ${t}`,
    racesCount: n => `${n} race${n === 1 ? "" : "s"}`,
    participantsCount: n => `${n} participant${n === 1 ? "" : "s"}`,
    noEvents: "No public events found.",
    noRaces: "This event has no race distances.",
    noResults: race_id => `No results returned for race #${race_id}.`,
    noResultsYet: "No results yet",
    loading: "Loading…",
    loadingResults: "Loading results…",
    error: "Error",
    errorEventsFail: "Failed to load events list.",
    errorEventFail: id => `Failed to load event #${id}.`,
    errorResultsFail: id => `Failed to load results for race #${id}.`,
    proxyAllFailed: "Looks like all public CORS proxies are down. Open ⚙︎ and add your own (see README.md), or run python3 server.py locally.",
    corsHintLocal: "If you opened index.html directly via file:// — try running python3 server.py from the web/ folder.",
    save: "Save", clear: "Reset",
    settingsTitle: "Settings", customProxy: "Custom CORS proxy",
    customProxyHint: "Leave empty — the site will first try local server.py, then a chain of free public proxies. Or paste your own (e.g. Cloudflare Worker — see README).",
    forceProxy: "Always use my proxy",
    bearerToken: "Bearer token",
    tokenHint: "Only needed for private endpoints. Stored in browser localStorage.",
    sortBy: "Sort:",
    filterAll: "All",
    filterGender: "Gender",
    filterCategory: "Category",
    filterMen: "Men", filterWomen: "Women",
    columnRank: "Place", columnRankCat: "Category",
    columnBib: "Bib", columnName: "Participant",
    columnGender: "Gender", columnCategory: "Cat.", columnClub: "Club / city",
    columnTime: "Time", columnPace: "Pace",
    showSplits: "Expand all", hideSplits: "Collapse all",
    exportCsv: "Export CSV",
    genderM: "Male", genderF: "Female",
    openSite: "Open site",
    rawData: "All data (JSON)",
    placeOverall: "Overall place",
    placeGender: "Gender place", placeCategory: "Category place",
    finishTime: "Finish time", chipTime: "Chip time", gunTime: "Gun time",
    netTime: "Net time",
    splits: "Splits",
    description: "About the event",
    footerDisclaimer: "All rights to the RaceNext brand and event data belong to their respective owners. This is an unofficial client built solely for more convenient viewing of public results.",
    footerData: "Data",
  },
};

// Russian/Ukrainian-style plural picker: forms = [singular, "2-4", "5+"].
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function t(key, ...args) {
  const dict = UI[currentLang] || UI.uk;
  let v = dict[key];
  if (v == null) v = UI.uk[key];
  if (typeof v === "function") return v(...args);
  return v ?? key;
}

// ---------- i18n: data strings ----------

// Parses RaceNext's localized strings: "[:uk]Текст[:en]Text[:de]Deutsch[:]"
// Returns the translation in `lang`, falling back to English then any value.
function tr(s, lang = currentLang) {
  if (!s || typeof s !== "string") return s ?? "";
  if (!s.includes("[:")) return s;
  const map = {};
  const re = /\[:([a-zA-Z]{2,5})\]([^[]*)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const code = m[1].toLowerCase();
    if (code) map[code] = m[2].replace(/^\s+|\s+$/g, "");
  }
  return map[lang] || map.en || map.uk || Object.values(map).find(Boolean) || "";
}

// Translate any string-or-localized-string field.
const trAny = v => (typeof v === "string" ? tr(v) : v ?? "");

// ---------- HTML sanitizer for description fields ----------

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "span",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
]);

// Walk a parsed DOM tree, keep only allowed tags, drop styles/scripts/etc.
// Returns sanitized HTML as a string.
function sanitizeHtml(html) {
  if (!html || typeof html !== "string") return "";
  if (!/<[a-z][^>]*>/i.test(html)) {
    return escHtml(html).replace(/\n/g, "<br>");
  }
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  function walk(node) {
    if (node.nodeType === 3) return escHtml(node.textContent);
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    let inner = "";
    node.childNodes.forEach(c => inner += walk(c));
    if (!ALLOWED_TAGS.has(tag)) return inner;
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (!/^https?:|^mailto:/i.test(href)) return inner;
      return `<a href="${escHtml(href)}" target="_blank" rel="noopener">${inner}</a>`;
    }
    return `<${tag}>${inner}</${tag}>`;
  }
  let out = "";
  doc.body.firstChild?.childNodes.forEach(c => out += walk(c));
  return out;
}

// ---------- settings ----------

function loadSettings() {
  return {
    proxy: localStorage.getItem("rn_proxy") ?? "",
    forceProxy: localStorage.getItem("rn_force_proxy") === "1",
    token: localStorage.getItem("rn_token") ?? "",
  };
}
function saveSettings(s) {
  if (s.proxy) localStorage.setItem("rn_proxy", s.proxy);
  else localStorage.removeItem("rn_proxy");
  localStorage.setItem("rn_force_proxy", s.forceProxy ? "1" : "0");
  if (s.token) localStorage.setItem("rn_token", s.token);
  else localStorage.removeItem("rn_token");
}
function isLocalHost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

// ---------- API transport ----------

async function tryFetchJson(url, headers) {
  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const e = new Error(`HTTP ${r.status} ${r.statusText}`);
    e.status = r.status;
    e.body = text.slice(0, 1500);
    throw e;
  }
  // Some proxies set text/html for JSON responses — parse manually.
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    const e = new Error("Invalid JSON in response");
    e.body = text.slice(0, 1500);
    throw e;
  }
}

async function api(path, params) {
  const settings = loadSettings();
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const direct = API + path + qs;
  const headers = { Accept: "application/json" };
  if (settings.token) headers.Authorization = "Bearer " + settings.token;

  // Build candidate transports in priority order.
  // attempt.trusted=true means: a 4xx/5xx from this source is treated as a
  // real API error and propagated immediately (do not fall through to public
  // proxies, which could mask legitimate API errors).
  const attempts = [];

  if (settings.forceProxy && settings.proxy) {
    attempts.push({ id: "custom", url: settings.proxy + encodeURIComponent(direct), trusted: true });
  } else {
    if (location.protocol !== "file:" && isLocalHost()) {
      attempts.push({ id: "local", url: location.origin + "/api" + path + qs, trusted: true });
    }
    if (location.protocol !== "file:") {
      attempts.push({ id: "direct", url: direct, trusted: true });
    }
    if (settings.proxy) {
      attempts.push({ id: "custom", url: settings.proxy + encodeURIComponent(direct), trusted: true });
    }
    const lastWinner = localStorage.getItem("rn_last_proxy");
    const sorted = PUBLIC_PROXIES.slice().sort((a, b) =>
      (b.id === lastWinner ? 1 : 0) - (a.id === lastWinner ? 1 : 0));
    for (const p of sorted) {
      attempts.push({ id: p.id, url: p.make(direct), trusted: false });
    }
  }

  let last;
  for (const a of attempts) {
    try {
      const data = await tryFetchJson(a.url, headers);
      if (PUBLIC_PROXIES.some(p => p.id === a.id)) {
        localStorage.setItem("rn_last_proxy", a.id);
      }
      return data;
    } catch (e) {
      last = e;
      if (a.trusted && e.status) throw e;
    }
  }
  throw last || new Error("All transports failed");
}

// In-memory cache; cleared on page reload.
const cache = new Map();
async function cached(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const v = await fn();
  cache.set(key, v);
  return v;
}

// Race id → { eventId, event, race } — populated when an event page renders,
// used by the race page to build proper breadcrumbs without an extra round-trip.
const raceToEvent = new Map();

// ---------- helpers / formatters ----------

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Try to convert various date formats into "DD.MM.YYYY".
function fmtDate(s) {
  if (!s) return "";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(s);
}

// Parse a date-ish string into a comparable timestamp. Falls back to extracting
// a year+month from the title so events can still be sorted chronologically.
function parseDateMs(s) {
  if (!s) return NaN;
  const direct = Date.parse(String(s));
  if (!isNaN(direct)) return direct;
  const m = String(s).match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (m) return Date.parse(`${m[3]}-${m[2]}-${m[1]}`);
  return NaN;
}

// Convert "00:32:14" / "32:14" / "1:42:09.5" into total seconds (NaN if bad).
function timeToSec(t) {
  if (t == null || t === "") return NaN;
  const m = String(t).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (!m) {
    const n = parseFloat(t);
    return isNaN(n) ? NaN : n;
  }
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

// Pretty-print a duration: drop leading "0:" and trailing ".0" noise.
function fmtTime(t) {
  if (t == null || t === "") return "";
  return String(t).replace(/^0(\d:)/, "$1").replace(/\.0+$/, "");
}

// Format a distance value flexibly. The API may return either kilometers
// ("21.0975") or meters ("21097.5"), and the value may be slightly off from
// the canonical race distance. Snap to known race distances when within 5%
// to avoid rendering "21.975 km" for a half marathon.
const KNOWN_DISTANCES_KM = [
  { km: 1, label: "1 км", labelEn: "1 km" },
  { km: 2, label: "2 км", labelEn: "2 km" },
  { km: 3, label: "3 км", labelEn: "3 km" },
  { km: 5, label: "5 км", labelEn: "5 km" },
  { km: 7, label: "7 км", labelEn: "7 km" },
  { km: 10, label: "10 км", labelEn: "10 km" },
  { km: 12, label: "12 км", labelEn: "12 km" },
  { km: 15, label: "15 км", labelEn: "15 km" },
  { km: 21.0975, label: "21,1 км", labelEn: "Half (21.1 km)" },
  { km: 25, label: "25 км", labelEn: "25 km" },
  { km: 30, label: "30 км", labelEn: "30 km" },
  { km: 42.195, label: "42,2 км", labelEn: "Marathon (42.2 km)" },
];
function fmtDistance(d) {
  if (d == null || d === "") return "";
  const n = parseFloat(String(d).replace(",", "."));
  if (isNaN(n)) return tr(String(d));
  const km = n < 100 ? n : n / 1000;
  for (const k of KNOWN_DISTANCES_KM) {
    if (Math.abs(km - k.km) / k.km < 0.05) {
      return currentLang === "en" ? k.labelEn : k.label;
    }
  }
  const dec = km < 10 ? 2 : 1;
  const formatted = km.toFixed(dec).replace(/\.?0+$/, "");
  return (currentLang === "en" ? formatted + " km" : formatted.replace(".", ",") + " км");
}

function distanceToKm(d) {
  if (d == null || d === "") return NaN;
  const n = parseFloat(String(d).replace(",", "."));
  if (isNaN(n)) return NaN;
  return n < 100 ? n : n / 1000;
}

// ---------- gender / place helpers ----------

// Determine a gender from a row using the most reliable source available.
// Categories may arrive as localized strings ("[:uk]Ж 30-39[:en]F 30-39[:]"),
// so we run them through tr() before checking the prefix. RaceNext also uses
// a numeric `gender` field with the convention 0 = male, 1 = female; we
// honour that as a final fallback.
function genderFromRow(row) {
  if (!row) return "";
  const catLocalized = tr(String(row.category ?? "")).trim();
  const first = catLocalized.charAt(0).toLowerCase();
  if (/[mмч]/.test(first)) return "M";
  if (/[fжw]/.test(first)) return "F";

  const g = row.gender ?? row.sex;
  if (typeof g === "string") {
    const v = g.trim().toLowerCase();
    if (["m", "male", "чол", "чоловіча", "ч", "man"].includes(v)) return "M";
    if (["f", "w", "female", "жін", "жіноча", "ж", "woman"].includes(v)) return "F";
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      if (n === 0) return "M";
      if (n === 1) return "F";
    }
  }
  if (typeof g === "number") {
    if (g === 0) return "M";
    if (g === 1) return "F";
  }
  return "";
}

function fmtGender(key) {
  if (key === "M") return t("genderM");
  if (key === "F") return t("genderF");
  return "";
}

function medal(rank) {
  const n = parseInt(rank, 10);
  if (n === 1) return "🥇";
  if (n === 2) return "🥈";
  if (n === 3) return "🥉";
  return "";
}

// ---------- field detection ----------

function pickId(d) {
  if (!d || typeof d !== "object") return null;
  for (const k of ["id", "race_id", "event_id", "raceId", "eventId", "_id"]) {
    if (d[k] != null) return d[k];
  }
  return null;
}
function pickTitle(d) {
  if (!d) return "";
  for (const k of ["title", "name", "event_name", "race_name", "label"]) {
    if (d[k]) return tr(String(d[k]));
  }
  return "";
}
function pickDate(d) {
  if (!d) return "";
  for (const k of ["date", "start_date", "start_at", "event_date", "starts_at", "start"]) {
    if (d[k]) return String(d[k]);
  }
  return "";
}
// Restricted to actual location-style fields. The previously-included "place"
// key clashed with breadcrumb/UI fields ("Результати"), so it was removed.
function pickPlace(d) {
  if (!d) return "";
  const candidates = [d.city, d.town, d.location_city, d.country];
  for (const c of candidates) {
    if (c) {
      const v = tr(String(c)).trim();
      if (v) return v;
    }
  }
  return "";
}
function pickDescription(d) {
  if (!d) return "";
  for (const k of ["description", "about", "info", "details", "long_description"]) {
    if (d[k]) return tr(String(d[k]));
  }
  return "";
}

// Find the largest array of objects anywhere inside a JSON value. Tolerant of
// various wrappers ({data: [...]}, {result: {...}}, ...).
function extractList(data) {
  if (Array.isArray(data) && data.every(x => x && typeof x === "object" && !Array.isArray(x))) {
    return data;
  }
  if (data && typeof data === "object") {
    for (const k of ["results", "data", "items", "rows", "list", "events", "races", "participants", "result"]) {
      const v = data[k];
      if (Array.isArray(v) && v.length && v.every(x => x && typeof x === "object")) return v;
    }
    let best = null;
    for (const v of Object.values(data)) {
      const cand = extractList(v);
      if (cand && (!best || cand.length > best.length)) best = cand;
    }
    return best;
  }
  return null;
}

// ---------- result row normalization ----------

// Pick the "main" finish time. Order of preference:
//   1. Explicit `total_time` / `chip_time` / `finish_time` / ... on the row
//      itself.
//   2. Same keys inside `row.time` if the API nests them there.
//   3. The largest time-like value inside the `time` object, since checkpoint
//      times grow monotonically and the last one is the finish.
const MAIN_TIME_KEYS = [
  "total_time", "chip_time", "finish_time", "official_time",
  "net_time", "gun_time", "result",
];
function extractMainTime(row) {
  for (const k of MAIN_TIME_KEYS) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  const t = row.time;
  if (typeof t === "string" || typeof t === "number") return String(t);
  if (t && typeof t === "object" && !Array.isArray(t)) {
    for (const k of MAIN_TIME_KEYS) {
      if (typeof t[k] === "string" && t[k]) return t[k];
      if (typeof t[k] === "number") return String(t[k]);
    }
    let best = "", bestSec = -1;
    for (const v of Object.values(t)) {
      if (typeof v !== "string" && typeof v !== "number") continue;
      const s = timeToSec(v);
      if (!isNaN(s) && s > bestSec) { bestSec = s; best = String(v); }
    }
    if (best) return best;
  }
  return "";
}
function extractMainPace(row) {
  const direct = row.pace || row.average_pace || row.avg_pace;
  if (typeof direct === "string" || typeof direct === "number") return String(direct);
  if (direct && typeof direct === "object") {
    for (const v of Object.values(direct)) {
      if (typeof v === "string" || typeof v === "number") return String(v);
    }
  }
  return "";
}

// Pull a list of checkpoint splits from anywhere they may be hiding, then
// sort them by parsed time ascending so the last entry is the finish.
const SPLIT_TIME_KEYS = new Set([
  "chip_time", "total_time", "finish_time", "official_time", "net_time",
  "gun_time", "result",
]);
function pickSplits(row) {
  if (!row || typeof row !== "object") return [];
  const out = [];
  const seen = new Set();
  const push = (label, time) => {
    const lab = String(label || "").trim();
    if (!lab || time == null || time === "" || typeof time === "object") return;
    if (seen.has(lab)) return;
    seen.add(lab);
    out.push({ label: tr(lab), time: String(time) });
  };

  // Arrays of {label, time}
  for (const k of ["splits", "checkpoints", "segments", "cp"]) {
    const v = row[k];
    if (Array.isArray(v)) {
      for (const it of v) {
        if (!it || typeof it !== "object") continue;
        const label = it.label || it.name || it.distance || it.km || it.point || it.title || "";
        const time = it.time || it.t || it.value || it.split_time || "";
        if (time) push(label, time);
      }
    } else if (v && typeof v === "object") {
      for (const [label, time] of Object.entries(v)) push(label, time);
    }
  }

  // The `time` field is sometimes an object: { total_time, chip_time, plus
  // per-checkpoint entries like "10 km", "20 km", "Finish" }. Treat the
  // checkpoint entries as splits.
  if (row.time && typeof row.time === "object" && !Array.isArray(row.time)) {
    for (const [label, time] of Object.entries(row.time)) {
      if (SPLIT_TIME_KEYS.has(label)) continue;
      push(label, time);
    }
  }

  // Flat keys like split_5km, t_5km, lap1, etc.
  const flatRe = /^(?:split|lap|t|cp|cp_|checkpoint_)[_-]?(\d+(?:\.\d+)?)(?:[_-]?(km|m|mi))?$/i;
  for (const [k, v] of Object.entries(row)) {
    if (v == null || v === "" || typeof v === "object") continue;
    const m = k.match(flatRe);
    if (m) push(m[1] + (m[2] || "km"), v);
  }

  // Sort ascending by parsed time so the last tile is the finish.
  out.sort((a, b) => {
    const sa = timeToSec(a.time);
    const sb = timeToSec(b.time);
    if (isNaN(sa) && isNaN(sb)) return 0;
    if (isNaN(sa)) return 1;
    if (isNaN(sb)) return -1;
    return sa - sb;
  });
  return out;
}

function normalizeRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && v !== "" && typeof v !== "object") return v;
    }
    return "";
  };
  const first = get("first_name", "firstName", "name_first");
  const last = get("last_name", "lastName", "name_last", "surname");
  const fullDirect = get("full_name", "fullName", "participant_name", "athlete", "name");
  let name = fullDirect || [first, last].filter(Boolean).join(" ").trim();
  name = tr(name);

  const club = tr(get("club", "team", "team_name", "club_name"));
  const city = tr(get("city", "town", "from_city"));
  const country = tr(get("country"));
  const placeStr = [club, city, country].filter(Boolean).join(", ");

  const genderKey = genderFromRow(row);

  const main = {
    // The API has a typo on the field name ("glace" instead of "place"), so
    // we accept both spellings.
    rank: get("place", "position", "rank", "rank_overall", "place_overall",
              "result_rank", "glace", "overall_glace", "rank_glace"),
    rank_gender: get("place_gender", "rank_gender", "gender_rank", "place_sex",
                     "gender_glace", "sex_glace"),
    rank_category: get("place_category", "rank_category", "category_rank",
                       "place_age", "place_age_group", "age_group_place",
                       "agClass", "cat_place", "rank_age",
                       "age_group_glace", "category_glace", "cat_glace"),
    bib: get("bib", "bib_number", "number", "start_number", "startNumber", "race_number"),
    name,
    first_name: tr(first),
    last_name: tr(last),
    gender: genderKey,
    category: tr(get("category", "age_group", "ageGroup", "age_category", "cat")),
    age: get("age"),
    club: club || city || country,
    location: placeStr,
    time: extractMainTime(row),
    pace: extractMainPace(row),
    status: get("status", "result_status"),
    splits: pickSplits(row),
    _all: row,
  };
  return main;
}

// ---------- breadcrumbs / loading / error ----------

// Render the sticky-topbar header. Two stacked rows:
//   crumbs:  parent navigation (no current page; cleaner, no duplication)
//   title :  current page title, optionally with a brand-accent suffix
//            (e.g. distance) and a muted meta line (e.g. count or date).
// Pass `crumbs: []` to hide the breadcrumbs row entirely.
function setHeader({ crumbs = [], title = "", titleSuffix = "", meta = "" }) {
  const cEl = document.getElementById("crumbs");
  if (cEl) {
    cEl.innerHTML = crumbs.map(c =>
      `<a href="${escHtml(c.href)}">${escHtml(c.label)}</a>`
    ).join('<span class="sep">›</span>');
  }
  const tEl = document.getElementById("pageTitle");
  if (tEl) {
    let html = `<span class="title-main">${escHtml(title)}</span>`;
    if (titleSuffix) html += `<span class="title-suffix">${escHtml(titleSuffix)}</span>`;
    if (meta) html += `<span class="title-meta">${escHtml(meta)}</span>`;
    tEl.innerHTML = html;
    tEl.title = title + (titleSuffix ? " · " + titleSuffix : "");
  }
}
function setLoading(text) {
  app.innerHTML = `<div class="loading"><div class="spinner"></div><div>${escHtml(text || t("loading"))}</div></div>`;
}
function showError(e, ctx) {
  console.error(ctx, e);
  const apiHttpError = !!e?.status;
  const onPages = !isLocalHost() && location.protocol !== "file:";
  let hint = "";
  if (!apiHttpError) {
    hint = onPages
      ? `<p>${escHtml(t("proxyAllFailed"))}</p>`
      : `<p>${escHtml(t("corsHintLocal"))}</p>`;
  }
  app.innerHTML = `
    <div class="error">
      <h3>${escHtml(t("error"))}</h3>
      <p>${escHtml(ctx)}</p>
      <pre>${escHtml(e?.message || String(e))}${e?.body ? "\n\n" + escHtml(e.body) : ""}</pre>
      ${hint}
    </div>`;
}

// ---------- view: events list ----------

async function viewEvents(opts = {}) {
  setHeader({ crumbs: [], title: t("home") });
  setLoading();
  let raw;
  try {
    if (opts.fresh) cache.delete("events");
    raw = await cached("events", () => api("/user-side/events", { visibility: "2" }));
  } catch (e) {
    return showError(e, t("errorEventsFail"));
  }
  let items = extractList(raw) ?? [];
  if (!items.length) {
    app.innerHTML = `<div class="empty">${escHtml(t("noEvents"))}</div>`;
    return;
  }

  // Cache event objects by id and update the race-to-event index when possible.
  for (const it of items) {
    const id = pickId(it);
    if (id != null) {
      cache.set(`event:${id}`, it);
      if (Array.isArray(it.races)) {
        for (const rc of it.races) {
          const rid = pickId(rc);
          if (rid != null) raceToEvent.set(String(rid), { eventId: id, event: it, race: rc });
        }
      }
    }
  }

  // Sort by date descending; if no date, parse year out of title as tiebreaker.
  items = items.slice().sort((a, b) => {
    const da = parseDateMs(pickDate(a)) || extractYearFromTitle(pickTitle(a)) * 365 * 86400000;
    const db = parseDateMs(pickDate(b)) || extractYearFromTitle(pickTitle(b)) * 365 * 86400000;
    return (db || 0) - (da || 0);
  });

  // Refresh title meta with the loaded count.
  setHeader({
    crumbs: [],
    title: t("home"),
    meta: t("eventsCount", items.length),
  });

  app.innerHTML = `
    <div class="toolbar">
      <input type="search" id="q" placeholder="${escHtml(t("searchEvents"))}" autofocus>
      <span class="count" id="cnt"></span>
    </div>
    <div class="cards" id="cards"></div>
  `;

  function render(filter = "") {
    const q = filter.trim().toLowerCase();
    const list = items.filter(it => {
      if (!q) return true;
      const hay = [pickTitle(it), pickPlace(it), fmtDate(pickDate(it))]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    $("#cnt").textContent = t("eventsFiltered", list.length, items.length);
    $("#cards").innerHTML = list.map(it => {
      const id = pickId(it);
      const title = pickTitle(it) || `#${id}`;
      const date = fmtDate(pickDate(it));
      const place = pickPlace(it);
      const racesCount = (Array.isArray(it.races) && it.races.length) || it.races_count || it.racesCount || 0;
      const participantsCount = it.participants_count || it.total_participants || it.participants;
      return `
        <a class="card" href="#/event/${encodeURIComponent(id)}">
          <div class="title">${escHtml(title)}</div>
          <div class="sub">
            ${date ? `<span>📅 ${escHtml(date)}</span>` : ""}
            ${place ? `<span>📍 ${escHtml(place)}</span>` : ""}
          </div>
          <div class="pills">
            ${racesCount ? `<span class="pill accent">${escHtml(t("racesCount", racesCount))}</span>` : ""}
            ${participantsCount ? `<span class="pill">${escHtml(t("participantsCount", participantsCount))}</span>` : ""}
          </div>
        </a>`;
    }).join("");
  }
  render();
  $("#q").addEventListener("input", e => render(e.target.value));
}

function extractYearFromTitle(s) {
  const m = String(s || "").match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : 0;
}

// ---------- view: event details (race list) ----------

async function viewEvent(id, opts = {}) {
  setHeader({
    crumbs: [{ label: t("home"), href: "#/" }],
    title: "…",
  });
  setLoading();
  let raw;
  try {
    if (opts.fresh) cache.delete(`event-full:${id}`);
    raw = await cached(`event-full:${id}`, () => api("/user-side/event", { showRaces: 1, id }));
  } catch (e) {
    return showError(e, t("errorEventFail", id));
  }

  const ev = (raw && typeof raw === "object" && raw.event && typeof raw.event === "object")
    ? raw.event : raw;
  let races = (Array.isArray(ev?.races) && ev.races)
    || (Array.isArray(raw?.races) && raw.races)
    || extractList(raw)
    || [];

  // Index race → event for breadcrumbs in viewRace.
  for (const rc of races) {
    const rid = pickId(rc);
    if (rid != null) raceToEvent.set(String(rid), { eventId: id, event: ev, race: rc });
  }

  // Sort races by descending distance.
  races = races.slice().sort((a, b) => (distanceToKm(b.distance) || 0) - (distanceToKm(a.distance) || 0));

  const title = pickTitle(ev) || pickTitle(raw) || `#${id}`;
  const date = fmtDate(pickDate(ev) || pickDate(raw));
  const place = pickPlace(ev);
  const url = ev?.url || ev?.website || raw?.url;
  const description = pickDescription(ev) || pickDescription(raw);
  const sanitized = sanitizeHtml(description);

  // The breadcrumbs now show only ancestors; the event title sits in the
  // page-title slot of the topbar. Date/place go into the muted meta line.
  const metaParts = [];
  if (date) metaParts.push("📅 " + date);
  if (place) metaParts.push("📍 " + place);
  setHeader({
    crumbs: [{ label: t("home"), href: "#/" }],
    title,
    meta: metaParts.join(" · "),
  });

  // Optional "open site" link goes inline above the description toggle.
  const externalLink = url
    ? `<a class="ext-link" href="${escHtml(url)}" target="_blank" rel="noopener">↗ ${escHtml(t("openSite"))}</a>`
    : "";

  app.innerHTML = `
    ${externalLink}
    ${sanitized ? `<details class="event-desc"><summary>${escHtml(t("description"))}</summary><div class="event-desc-body">${sanitized}</div></details>` : ""}
    <div class="races" id="races"></div>
  `;

  if (!races.length) {
    $("#races").innerHTML = `<div class="empty">${escHtml(t("noRaces"))}</div>`;
    return;
  }

  $("#races").innerHTML = races.map(rc => {
    const rid = pickId(rc);
    const rt = pickTitle(rc) || `#${rid}`;
    const dist = fmtDistance(rc.distance || rc.length || rc.distance_km || "");
    const rdate = fmtDate(pickDate(rc));
    const partCount = rc.participants_count || rc.participants || rc.total_participants
                      || rc.registered_count || rc.registered || 0;
    const has = rc.has_results;
    const disabled = has === false;
    const tag = disabled ? "div" : "a";
    const href = disabled ? "" : ` href="#/race/${encodeURIComponent(rid)}"`;
    return `
      <${tag} class="race-card${disabled ? " disabled" : ""}"${href}>
        <div class="race-title">${escHtml(rt)}</div>
        <div class="race-meta">
          ${dist ? `<span class="dist">${escHtml(dist)}</span>` : ""}
          ${rdate ? `<span>📅 ${escHtml(rdate)}</span>` : ""}
          ${partCount ? `<span>👥 ${escHtml(t("participantsCount", partCount))}</span>` : ""}
        </div>
        ${disabled ? `<div class="race-tag muted">${escHtml(t("noResultsYet"))}</div>` : ""}
      </${tag}>`;
  }).join("");
}

// ---------- view: race results ----------

// Tries to recover the (event, race) context for a deep-linked race page.
async function findRaceContext(rid) {
  const key = String(rid);
  if (raceToEvent.has(key)) return raceToEvent.get(key);

  let events;
  try {
    events = extractList(
      await cached("events", () => api("/user-side/events", { visibility: "2" }))
    ) || [];
  } catch { return null; }

  // Some shapes embed races directly in the events list.
  for (const ev of events) {
    const races = ev?.races;
    if (Array.isArray(races)) {
      const found = races.find(r => String(pickId(r)) === key);
      if (found) {
        const ctx = { eventId: pickId(ev), event: ev, race: found };
        raceToEvent.set(key, ctx);
        return ctx;
      }
    }
  }

  // Fall back to fetching each event detail (cached). Worst case: O(N) calls.
  for (const ev of events) {
    const eid = pickId(ev);
    if (!eid) continue;
    try {
      const data = await cached(`event-full:${eid}`,
        () => api("/user-side/event", { showRaces: 1, id: eid }));
      const evObj = (data?.event && typeof data.event === "object") ? data.event : data;
      const races = evObj?.races || data?.races || [];
      const found = races.find(r => String(pickId(r)) === key);
      if (found) {
        const ctx = { eventId: eid, event: evObj, race: found };
        raceToEvent.set(key, ctx);
        return ctx;
      }
    } catch { /* keep trying */ }
  }
  return null;
}

async function viewRace(rid, opts = {}) {
  setHeader({
    crumbs: [{ label: t("home"), href: "#/" }],
    title: "…",
  });
  setLoading(t("loadingResults"));

  // Fetch results and (in parallel) try to figure out the event context.
  const resultsP = (async () => {
    if (opts.fresh) cache.delete(`results:${rid}`);
    return cached(`results:${rid}`, () => api("/user-side/get-results", { race: rid }));
  })();
  const ctxP = findRaceContext(rid);

  let raw;
  try { raw = await resultsP; }
  catch (e) { return showError(e, t("errorResultsFail", rid)); }

  const rows = extractList(raw) ?? [];
  if (!rows.length) {
    app.innerHTML = `<div class="empty">${escHtml(t("noResults", rid))}</div>`;
    return;
  }
  // Normalize rows. RaceNext sometimes omits the rank/place field entirely,
  // and yet returns participants in finish order. We fall back to the row's
  // 1-based position in the API response so the "Місце" column is always
  // populated. The fallback is only applied if NO row has an explicit rank
  // (so we never overwrite real data).
  const normalized = rows.map(normalizeRow);
  const anyExplicitRank = normalized.some(r => r.rank !== "" && r.rank != null);
  if (!anyExplicitRank) {
    normalized.forEach((r, i) => { r.rank = i + 1; });
  } else {
    // Fill in the gaps for rows without a rank using array position too,
    // so the column never has empty cells.
    normalized.forEach((r, i) => { if (r.rank === "" || r.rank == null) r.rank = i + 1; });
  }

  // Resolve titles. Whatever we have at this moment goes into the initial
  // render; the rest is filled in once the context Promise resolves.
  let ctx = await Promise.race([ctxP, new Promise(r => setTimeout(() => r(null), 0))]);
  let raceTitle = pickTitle(raw?.race) || (ctx ? pickTitle(ctx.race) : "");
  let raceDist = fmtDistance(ctx?.race?.distance || raw?.race?.distance || "");
  let eventTitle = ctx ? pickTitle(ctx.event) : "";
  let eventId = ctx?.eventId;

  function rerenderHeader() {
    const ancestors = [{ label: t("home"), href: "#/" }];
    if (eventTitle && eventId != null) {
      ancestors.push({
        label: eventTitle,
        href: `#/event/${encodeURIComponent(eventId)}`,
      });
    }
    setHeader({
      crumbs: ancestors,
      title: raceTitle || `#${rid}`,
      titleSuffix: raceDist || "",
    });
  }

  // Build the page skeleton (will be patched once context resolves).
  buildRaceUi();
  rerenderHeader();

  // When the deeper context arrives, refresh header + breadcrumbs.
  ctxP.then(found => {
    if (!found) return;
    ctx = found;
    if (!raceTitle) raceTitle = pickTitle(found.race) || raceTitle;
    if (!raceDist) raceDist = fmtDistance(found.race?.distance || "");
    eventTitle = pickTitle(found.event) || eventTitle;
    eventId = found.eventId ?? eventId;
    rerenderHeader();
  });

  // ----- the rest of the function builds the UI for `normalized` -----

  function buildRaceUi() {
    const genders = new Set(normalized.map(r => r.gender).filter(Boolean));
    const categories = new Set(normalized.map(r => r.category).filter(Boolean));
    const hasSplits = normalized.some(r => r.splits.length);
    const hasCatPlace = normalized.some(r => r.rank_category);

    const state = {
      q: "",
      gender: "",
      category: "",
      sortKey: "rank",
      sortDir: 1,
      expanded: new Set(),
      splitsAllOpen: false,
    };

    const colsAll = [
      { key: "rank", label: t("columnRank"), num: true,
        sortGetter: r => parseFloat(r.rank) || Number.MAX_SAFE_INTEGER },
      { key: "rank_category", label: t("columnRankCat"), num: true,
        sortGetter: r => parseFloat(r.rank_category) || Number.MAX_SAFE_INTEGER,
        when: () => hasCatPlace },
      { key: "bib", label: t("columnBib"), num: true,
        sortGetter: r => parseFloat(r.bib) || Number.MAX_SAFE_INTEGER },
      { key: "name", label: t("columnName"),
        sortGetter: r => (r.name || "").toLowerCase() },
      { key: "gender", label: t("columnGender") },
      { key: "category", label: t("columnCategory") },
      { key: "club", label: t("columnClub") },
      { key: "time", label: t("columnTime"), num: true,
        sortGetter: r => { const s = timeToSec(r.time); return isNaN(s) ? Number.MAX_SAFE_INTEGER : s; } },
      { key: "pace", label: t("columnPace") },
    ];
    const cols = colsAll.filter(c => {
      if (c.when && !c.when()) return false;
      return normalized.some(r => r[c.key] !== "" && r[c.key] != null);
    });

    const genderChips = ["", ...Array.from(genders)].map(g => {
      const label = g === "" ? t("filterAll") : (g === "M" ? t("filterMen") : g === "F" ? t("filterWomen") : g);
      return `<button class="chip" data-gender="${escHtml(g)}">${escHtml(label)}</button>`;
    }).join("");

    const sortedCats = Array.from(categories).sort((a, b) => String(a).localeCompare(String(b)));
    const catOptions = `<option value="">${escHtml(t("filterAll"))}</option>` +
      sortedCats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("");

    app.innerHTML = `
      <div class="filters">
        <input type="search" id="q" placeholder="${escHtml(t("searchResults"))}">
        ${genders.size > 1 ? `
          <div class="chips" id="gender-chips" data-label="${escHtml(t("filterGender"))}:">
            ${genderChips}
          </div>` : ""}
        ${categories.size > 1 ? `
          <label class="select-wrap">
            <span class="select-label">${escHtml(t("filterCategory"))}</span>
            <select id="cat">${catOptions}</select>
          </label>` : ""}
        ${hasSplits ? `<button class="btn" id="toggleAllSplits">${escHtml(t("showSplits"))}</button>` : ""}
        <button class="btn primary" id="export-csv">⤓ ${escHtml(t("exportCsv"))}</button>
        <span class="count" id="cnt"></span>
      </div>

      <div class="table-wrap">
        <table class="results">
          <thead>
            <tr>
              ${hasSplits ? `<th class="splits-col" aria-hidden="true"></th>` : ""}
              ${cols.map(c => `<th data-key="${c.key}" class="${c.num ? "num" : ""}">${escHtml(c.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    `;

    function applyFilters(list) {
      const q = state.q.trim().toLowerCase();
      return list.filter(r => {
        if (state.gender && r.gender !== state.gender) return false;
        if (state.category && r.category !== state.category) return false;
        if (!q) return true;
        const hay = [r.name, r.bib, r.club, r.location, r.category,
                     fmtGender(r.gender), r.rank, r.time]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    function applySort(list) {
      const c = colsAll.find(x => x.key === state.sortKey);
      const get = c?.sortGetter || (r => (r[state.sortKey] ?? "").toString().toLowerCase());
      return list.slice().sort((a, b) => {
        const va = get(a), vb = get(b);
        if (va < vb) return -state.sortDir;
        if (va > vb) return state.sortDir;
        return 0;
      });
    }

    function cellRender(c, r) {
      if (c.key === "rank") {
        const m = medal(r.rank);
        return `<td class="num rank">${m ? `<span class="medal">${m}</span>` : ""}${escHtml(r.rank)}</td>`;
      }
      if (c.key === "rank_category") return `<td class="num">${escHtml(r.rank_category)}</td>`;
      if (c.key === "name") {
        const sub = r.location;
        return `<td class="name-cell">
          <div class="primary">${escHtml(r.name)}</div>
          ${sub ? `<div class="secondary">${escHtml(sub)}</div>` : ""}
        </td>`;
      }
      if (c.key === "gender") return `<td>${escHtml(fmtGender(r.gender))}</td>`;
      if (c.key === "time") return `<td class="num mono">${escHtml(fmtTime(r.time))}</td>`;
      if (c.key === "pace") return `<td class="num mono">${escHtml(r.pace)}</td>`;
      if (c.key === "club") return `<td>${escHtml(r.club)}</td>`;
      if (c.key === "category") return `<td>${escHtml(r.category)}</td>`;
      if (c.key === "bib") return `<td class="num">${escHtml(r.bib)}</td>`;
      return `<td>${escHtml(r[c.key])}</td>`;
    }

    function rowRender(r, idx) {
      const open = state.expanded.has(idx);
      const hasMore = r.splits.length || hasUsefulExtras(r);
      // Inline SVG chevron — symmetric around the centre of its 16×16
      // viewBox so it rotates cleanly on a 90deg pivot.
      const chevron = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 4 11 8 5 12"/></svg>`;
      const toggle = hasSplits
        ? `<td class="splits-col">${hasMore ? `<button class="row-toggle ${open ? "on" : ""}" aria-label="${escHtml(t("splits"))}" tabindex="-1">${chevron}</button>` : ""}</td>`
        : "";
      const cells = cols.map(c => cellRender(c, r)).join("");
      let detail = "";
      if (open) {
        detail = `<tr class="detail-row" data-detail-of="${idx}">
          <td colspan="${cols.length + (hasSplits ? 1 : 0)}">${renderDetail(r)}</td>
        </tr>`;
      }
      return `<tr data-idx="${idx}" class="${open ? "open" : ""} ${hasMore ? "expandable" : ""}">${toggle}${cells}</tr>${detail}`;
    }

    function renderDetail(r) {
      const out = [];

      // Note: place breakdown (overall / category) used to live here, but
      // those numbers are already shown as columns. The full row JSON
      // below still surfaces less-common ranks like gender_glace.

      // Splits as a small visual track. The last tile is highlighted as
      // the finish (since splits are sorted ascending).
      if (r.splits.length) {
        const lastIdx = r.splits.length - 1;
        out.push(`<div class="split-row">
          <div class="split-title">${escHtml(t("splits"))}</div>
          <div class="splits">${r.splits.map((s, i) => `
            <div class="split${i === lastIdx ? " split-total" : ""}">
              <div class="split-label">${escHtml(s.label)}</div>
              <div class="split-time mono">${escHtml(fmtTime(s.time))}</div>
            </div>`).join("")}
          </div>
        </div>`);
      }

      // Full raw row as formatted JSON for power users.
      out.push(`<details class="more"><summary>${escHtml(t("rawData"))}</summary>
        <pre class="raw-json">${escHtml(JSON.stringify(r._all, null, 2))}</pre>
      </details>`);
      return out.join("") || `<div class="muted">—</div>`;
    }

    function hasUsefulExtras(r) {
      // We always show the raw JSON, so every row is expandable.
      return true;
    }

    const updateChips = () => {
      $$("#gender-chips .chip", app).forEach(b => {
        b.classList.toggle("on", b.dataset.gender === state.gender);
      });
    };

    function renderRows() {
      let list = applyFilters(normalized);
      list = applySort(list);
      $("#cnt").textContent = t("eventsFiltered", list.length, normalized.length);
      const tbody = $("#tbody");
      tbody.innerHTML = list.map(r => rowRender(r, normalized.indexOf(r))).join("");

      $$("th[data-key]", app).forEach(th => {
        const k = th.dataset.key;
        th.removeAttribute("aria-sort");
        if (k === state.sortKey) {
          th.setAttribute("aria-sort", state.sortDir === 1 ? "ascending" : "descending");
        }
      });

      // Whole-row click toggles expansion (except clicks on links).
      tbody.querySelectorAll("tr.expandable").forEach(tr => {
        tr.addEventListener("click", e => {
          if (e.target.closest("a")) return;
          const idx = parseInt(tr.dataset.idx, 10);
          if (state.expanded.has(idx)) state.expanded.delete(idx);
          else state.expanded.add(idx);
          renderRows();
        });
      });
    }

    $("#q").addEventListener("input", e => { state.q = e.target.value; renderRows(); });
    if ($("#cat")) $("#cat").addEventListener("change", e => { state.category = e.target.value; renderRows(); });
    if ($("#gender-chips")) {
      $$("#gender-chips .chip", app).forEach(b => {
        b.addEventListener("click", () => {
          state.gender = b.dataset.gender;
          updateChips();
          renderRows();
        });
      });
    }
    $$("th[data-key]", app).forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.key;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = 1; }
        renderRows();
      });
    });
    if ($("#toggleAllSplits")) {
      $("#toggleAllSplits").addEventListener("click", () => {
        state.splitsAllOpen = !state.splitsAllOpen;
        if (state.splitsAllOpen) normalized.forEach((_, i) => state.expanded.add(i));
        else state.expanded.clear();
        $("#toggleAllSplits").textContent = state.splitsAllOpen ? t("hideSplits") : t("showSplits");
        renderRows();
      });
    }
    $("#export-csv").addEventListener("click", () => exportCsv(rid, normalized, cols));

    updateChips();
    renderRows();
    checkStickyState();
  }
}

// ---------- CSV export ----------

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(rid, rows, cols) {
  const headers = cols.map(c => c.label);
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(cols.map(c => {
      let v = r[c.key];
      if (c.key === "gender") v = fmtGender(v);
      if (c.key === "time") v = fmtTime(v);
      return csvEscape(v);
    }).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `race_${rid}_results.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- toolbar wiring ----------

function setupToolbar() {
  // Brand is a text wordmark; only the aria-label needs to be localized.
  const brandEl = $("#brandLabel");
  if (brandEl) brandEl.setAttribute("aria-label", t("brand"));
  $("#siteLink").title = t("openSite");
  $("#refreshBtn").title = t("refresh");
  $("#settingsBtn").title = t("settings");

  const langPicker = $("#langPicker");
  langPicker.innerHTML = SUPPORTED_LANGS.map(code => `
    <button class="lang ${code === currentLang ? "on" : ""}" data-lang="${code}">${code.toUpperCase()}</button>
  `).join("");
  langPicker.onclick = e => {
    const b = e.target.closest("button[data-lang]");
    if (!b) return;
    currentLang = b.dataset.lang;
    localStorage.setItem("rn_lang", currentLang);
    document.documentElement.lang = currentLang;
    setupToolbar();
    route();
  };

  $("#refreshBtn").onclick = () => {
    const h = location.hash || "#/";
    if (h.startsWith("#/event/")) {
      const id = decodeURIComponent(h.replace("#/event/", "").split("/")[0]);
      viewEvent(id, { fresh: true });
    } else if (h.startsWith("#/race/")) {
      const id = decodeURIComponent(h.replace("#/race/", "").split("/")[0]);
      viewRace(id, { fresh: true });
    } else {
      viewEvents({ fresh: true });
    }
  };

  $("#settingsBtn").onclick = () => {
    const s = loadSettings();
    $("#proxyInput").value = s.proxy;
    $("#forceProxy").checked = s.forceProxy;
    $("#tokenInput").value = s.token;
    $("#dlgTitle").textContent = t("settingsTitle");
    $("#proxyLabel").textContent = t("customProxy");
    $("#proxyHint").textContent = t("customProxyHint");
    $("#forceProxyLabel").textContent = t("forceProxy");
    $("#tokenLabel").textContent = t("bearerToken");
    $("#tokenHint").textContent = t("tokenHint");
    $("#settingsClear").textContent = t("clear");
    $("#settingsSave").textContent = t("save");
    settingsDlg.showModal();
  };
  $("#settingsClear").onclick = () => {
    $("#proxyInput").value = "";
    $("#forceProxy").checked = false;
    $("#tokenInput").value = "";
    localStorage.removeItem("rn_last_proxy");
  };
  $("#settingsSave").onclick = () => {
    saveSettings({
      proxy: $("#proxyInput").value.trim(),
      forceProxy: $("#forceProxy").checked,
      token: $("#tokenInput").value.trim(),
    });
    setTimeout(() => route({ fresh: true }), 50);
  };

  // Footer text is rendered from JS so it can be localized along with the UI.
  const footer = $("#footer");
  if (footer) {
    footer.innerHTML = `
      <div class="footer-disclaimer">${escHtml(t("footerDisclaimer"))}</div>
      <div class="footer-data">${escHtml(t("footerData"))}: <a href="https://racenext.app" target="_blank" rel="noopener">racenext.app</a></div>
    `;
  }
}

// ---------- router ----------

function route(opts = {}) {
  const h = location.hash || "#/";
  const m = h.match(/^#\/event\/([^/]+)/);
  const m2 = h.match(/^#\/race\/([^/]+)/);
  if (m) return viewEvent(decodeURIComponent(m[1]), opts);
  if (m2) return viewRace(decodeURIComponent(m2[1]), opts);
  return viewEvents(opts);
}

window.addEventListener("hashchange", () => route());
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.lang = currentLang;
  setupToolbar();
  setupStickyDetection();
  route();
});

// Toggle a class on the table wrapper when its sticky <th> rows have crossed
// the topbar (so CSS can flatten the header's rounded corners). A scroll
// listener is cheap; checkStickyState is throttled with rAF.
let stickyRaf = 0;
function checkStickyState() {
  const wrap = document.querySelector(".table-wrap");
  if (!wrap) return;
  const topbarH = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")
  ) || 56;
  const top = wrap.getBoundingClientRect().top;
  wrap.classList.toggle("is-stuck", top < topbarH);
}
function setupStickyDetection() {
  window.addEventListener("scroll", () => {
    if (stickyRaf) return;
    stickyRaf = requestAnimationFrame(() => {
      stickyRaf = 0;
      checkStickyState();
    });
  }, { passive: true });
}
