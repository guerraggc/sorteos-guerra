const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const CONFIG_FILE = path.join(ROOT, "sorteos-g.json");
const IS_HOSTED = Boolean(process.env.PORT || process.env.RENDER || process.env.RENDER_SERVICE_ID);
const ADMIN_KEY = String(process.env.ADMIN_KEY || (IS_HOSTED ? "" : "elyorch2026")).trim();
const HOLD_HOURS = 48;
const HOLD_MS = HOLD_HOURS * 60 * 60 * 1000;
const MAX_BODY_BYTES = 18 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_TICKETS_PER_RESERVATION = 30;
const DEFAULT_TICKET_START = Number.parseInt(process.env.TICKET_START || "1", 10);
const DEFAULT_TICKET_END = Number.parseInt(process.env.TICKET_END || "99", 10);
const DEFAULT_TICKET_PAD = Number.parseInt(process.env.TICKET_PAD || String(DEFAULT_TICKET_END).length, 10);

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_BUCKET = String(process.env.SUPABASE_BUCKET || "receipts").trim().replace(/[^\w.-]/g, "") || "receipts";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

const STATUS = new Set(["en_revision", "pendiente", "pagado", "cancelado", "expirado"]);
const PUBLIC_ROOT_FILES = new Set([
  "index.html",
  "sorteo.html",
  "boletos.html",
  "verificar.html",
  "preguntas.html",
  "pagos.html",
  "contacto.html",
  "admin.html",
  "sorteos-g.json",
  "styles.css",
  "script.js",
  "favicon.ico"
]);
const PUBLIC_IMAGE_DIRS = new Set(["imagenes"]);
const PUBLIC_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg"]);
const RATE_LIMITS = new Map();

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ meta: { nextBuyerNumber: 1 }, reservations: [] }, null, 2));
  }
}

function normalizeDb(db) {
  db.meta = db.meta || {};
  db.reservations = Array.isArray(db.reservations) ? db.reservations : [];

  let maxBuyerNumber = 0;
  db.reservations.forEach((record, index) => {
    if (!record.buyerNumber) record.buyerNumber = index + 1;
    maxBuyerNumber = Math.max(maxBuyerNumber, record.buyerNumber);
    if (!record.statusUpdatedAt) record.statusUpdatedAt = record.paidAt || record.createdAt || null;
    if ((record.status === "en_revision" || record.status === "pendiente") && !record.heldUntil) {
      record.heldUntil = new Date(new Date(record.createdAt || Date.now()).getTime() + HOLD_MS).toISOString();
    }
  });

  if (!db.meta.nextBuyerNumber || db.meta.nextBuyerNumber <= maxBuyerNumber) {
    db.meta.nextBuyerNumber = maxBuyerNumber + 1;
  }
  return db;
}

function isHoldExpired(record, now = Date.now()) {
  if (record.status !== "en_revision" && record.status !== "pendiente") return false;
  const heldUntil = new Date(record.heldUntil || record.createdAt || 0).getTime();
  return Number.isFinite(heldUntil) && heldUntil <= now;
}

function expireOldReservations(records) {
  const changed = [];
  const now = Date.now();
  records.forEach((record) => {
    let didChange = false;
    if (!record.heldUntil && (record.status === "en_revision" || record.status === "pendiente")) {
      record.heldUntil = new Date(new Date(record.createdAt || Date.now()).getTime() + HOLD_MS).toISOString();
      didChange = true;
    }
    if (isHoldExpired(record, now)) {
      record.status = "expirado";
      record.statusUpdatedAt = new Date(now).toISOString();
      record.paidAt = null;
      didChange = true;
    }
    if (didChange) changed.push(record);
  });
  return changed;
}

function locksTicket(record) {
  if (record.status === "pagado") return true;
  if (record.status === "en_revision" || record.status === "pendiente") return !isHoldExpired(record);
  return false;
}

function readDb() {
  ensureStorage();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  const db = normalizeDb(JSON.parse(raw));
  const normalized = JSON.stringify(db, null, 2);
  if (normalized !== raw) {
    fs.writeFileSync(DB_FILE, normalized);
  }
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function setSecurityHeaders(res) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (IS_HOSTED) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function sendJson(res, statusCode, data) {
  setSecurityHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendBinary(res, statusCode, data, contentType) {
  setSecurityHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(statusCode, { "Content-Type": contentType || "application/octet-stream" });
  res.end(data);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > limit) {
        done = true;
        reject(new Error("El comprobante esta muy pesado. Usa una imagen menor a 12 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!done) reject(error);
    });
  });
}

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function cleanText(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanFileName(value, fallback) {
  const baseName = path.basename(String(value || ""));
  return baseName.replace(/[^\w.\- ]+/g, "").trim().slice(0, 120) || fallback;
}

function readSiteConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function cleanPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getTicketSettings() {
  const config = readSiteConfig();
  const tickets = config.boletos || {};
  const start = cleanPositiveInteger(tickets.inicio, DEFAULT_TICKET_START);
  const end = Math.max(start, cleanPositiveInteger(tickets.final, DEFAULT_TICKET_END));
  const pad = cleanPositiveInteger(tickets.digitos, DEFAULT_TICKET_PAD || String(end).length);
  const maxPerReservation = cleanPositiveInteger(tickets.maximosPorEnvio, DEFAULT_MAX_TICKETS_PER_RESERVATION);

  return { start, end, pad, maxPerReservation };
}

function normalizeTicket(value, settings = getTicketSettings()) {
  const ticket = String(value || "").trim();
  if (!/^\d+$/.test(ticket)) return "";
  const number = Number(ticket);
  if (!Number.isInteger(number) || number < settings.start || number > settings.end) return "";
  return String(number).padStart(settings.pad, "0");
}

function publicReservation(record, options = {}) {
  const reservation = {
    id: record.id,
    buyerNumber: record.buyerNumber,
    prize: record.prize,
    ticketNumbers: record.ticketNumbers,
    name: record.name,
    lastName: record.lastName,
    state: record.state,
    phone: record.phone,
    status: record.status,
    createdAt: record.createdAt,
    sentAt: record.receiptUrl ? record.sentAt : null,
    paidAt: record.paidAt || null,
    statusUpdatedAt: record.statusUpdatedAt || null,
    heldUntil: record.heldUntil || null
  };
  if (options.includeReceipt) {
    reservation.hasReceipt = Boolean(record.receiptUrl);
    reservation.receiptName = record.receiptName;
  }
  return reservation;
}

function requireAdmin(req, res, url) {
  const headerKey = Array.isArray(req.headers["x-admin-key"]) ? req.headers["x-admin-key"][0] : req.headers["x-admin-key"];
  const key = headerKey || (!IS_HOSTED ? url.searchParams.get("key") : "");

  if (!ADMIN_KEY) {
    sendJson(res, 503, { error: "Falta configurar ADMIN_KEY en el hosting." });
    return false;
  }

  const incoming = Buffer.from(String(key || ""));
  const expected = Buffer.from(ADMIN_KEY);
  const matches = incoming.length === expected.length && crypto.timingSafeEqual(incoming, expected);

  if (!matches) {
    sendJson(res, 401, { error: "Clave de administrador incorrecta." });
    return false;
  }
  return true;
}

function reservationToRow(record, includeBuyerNumber = false) {
  const row = {
    id: record.id,
    prize: record.prize,
    ticket_numbers: record.ticketNumbers,
    name: record.name,
    last_name: record.lastName,
    state: record.state,
    phone: record.phone,
    status: record.status,
    receipt_url: record.receiptUrl || "",
    receipt_name: record.receiptName,
    created_at: record.createdAt,
    sent_at: record.sentAt || record.createdAt,
    paid_at: record.paidAt || null,
    status_updated_at: record.statusUpdatedAt || null,
    held_until: record.heldUntil || null
  };
  if (includeBuyerNumber && record.buyerNumber) row.buyer_number = record.buyerNumber;
  return row;
}

function rowToReservation(row) {
  return {
    id: row.id,
    buyerNumber: row.buyer_number,
    prize: row.prize,
    ticketNumbers: Array.isArray(row.ticket_numbers) ? row.ticket_numbers.map(String) : [],
    name: row.name,
    lastName: row.last_name,
    state: row.state,
    phone: row.phone,
    status: row.status,
    receiptUrl: row.receipt_url,
    receiptName: row.receipt_name,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    paidAt: row.paid_at || null,
    statusUpdatedAt: row.status_updated_at || null,
    heldUntil: row.held_until || null
  };
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase respondio ${response.status}: ${text || response.statusText}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseBinaryRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`Supabase respondio ${response.status}: ${buffer.toString("utf8") || response.statusText}`);
  }
  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream"
  };
}

async function ensureSupabaseReceiptBucket() {
  if (!USE_SUPABASE) return;

  const buckets = await supabaseRequest("/storage/v1/bucket");
  const exists = Array.isArray(buckets) && buckets.some((bucket) => {
    return bucket && (bucket.id === SUPABASE_BUCKET || bucket.name === SUPABASE_BUCKET);
  });
  if (exists) return;

  await supabaseRequest("/storage/v1/bucket", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: SUPABASE_BUCKET,
      name: SUPABASE_BUCKET,
      public: false,
      file_size_limit: MAX_RECEIPT_BYTES,
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp", "image/gif"]
    })
  });
}

async function loadStore() {
  if (USE_SUPABASE) {
    const rows = await supabaseRequest("/rest/v1/reservations?select=*&order=created_at.desc");
    return { db: null, reservations: rows.map(rowToReservation) };
  }
  const db = readDb();
  return { db, reservations: db.reservations };
}

async function persistExpiredReservations(store, changedRecords) {
  if (!changedRecords.length) return;
  if (USE_SUPABASE) {
    await Promise.all(changedRecords.map((record) => {
      return updateSupabaseReservation(record.id, {
        status: record.status,
        paidAt: record.paidAt || null,
        statusUpdatedAt: record.statusUpdatedAt || null,
        heldUntil: record.heldUntil || null
      });
    }));
    return;
  }
  writeDb(store.db);
}

async function createSupabaseReservation(record) {
  const rows = await supabaseRequest("/rest/v1/reservations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(reservationToRow(record, false))
  });
  return rowToReservation(rows[0]);
}

async function updateSupabaseReservation(id, patch) {
  const rowPatch = {};
  if ("status" in patch) rowPatch.status = patch.status;
  if ("paidAt" in patch) rowPatch.paid_at = patch.paidAt;
  if ("statusUpdatedAt" in patch) rowPatch.status_updated_at = patch.statusUpdatedAt;
  if ("heldUntil" in patch) rowPatch.held_until = patch.heldUntil;
  if ("sentAt" in patch) rowPatch.sent_at = patch.sentAt;
  if ("receiptUrl" in patch) rowPatch.receipt_url = patch.receiptUrl;
  if ("receiptName" in patch) rowPatch.receipt_name = patch.receiptName;

  const rows = await supabaseRequest(`/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(rowPatch)
  });
  return rows && rows[0] ? rowToReservation(rows[0]) : null;
}

async function deleteSupabaseReservation(id) {
  await supabaseRequest(`/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });
}

function supabaseReceiptObjectPath(record) {
  if (!record || !record.receiptUrl) return "";
  const storagePrefix = `storage://${SUPABASE_BUCKET}/`;
  if (String(record.receiptUrl).startsWith(storagePrefix)) {
    return String(record.receiptUrl).slice(storagePrefix.length);
  }

  const receiptUrl = new URL(record.receiptUrl);
  const parts = receiptUrl.pathname.split("/").filter(Boolean);
  const publicIndex = parts.indexOf("public");
  const bucket = publicIndex >= 0 ? parts[publicIndex + 1] : "";
  const objectPath = publicIndex >= 0 ? parts.slice(publicIndex + 2).map(decodeURIComponent).join("/") : "";
  return bucket === SUPABASE_BUCKET ? objectPath : "";
}

function encodedStoragePath(objectPath) {
  return String(objectPath || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function localReceiptPath(record) {
  if (!record || !record.receiptUrl) return "";
  const receiptUrl = new URL(record.receiptUrl, "http://local.test");
  if (!receiptUrl.pathname.startsWith("/uploads/")) return "";
  return path.join(UPLOAD_DIR, path.basename(receiptUrl.pathname));
}

async function readReceipt(record) {
  if (!record || !record.receiptUrl) throw new Error("Comprobante no encontrado.");

  if (USE_SUPABASE) {
    const objectPath = supabaseReceiptObjectPath(record);
    if (!objectPath) throw new Error("Comprobante no encontrado.");
    return supabaseBinaryRequest(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodedStoragePath(objectPath)}`);
  }

  const target = localReceiptPath(record);
  if (!target) throw new Error("Comprobante no encontrado.");
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(UPLOAD_DIR)) throw new Error("Comprobante no encontrado.");
  const buffer = fs.readFileSync(resolvedTarget);
  return {
    buffer,
    contentType: detectImageMime(buffer) || MIME_TYPES[path.extname(resolvedTarget).toLowerCase()] || "application/octet-stream"
  };
}

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  return "";
}

function parseReceipt(dataUrl, originalName) {
  const match = String(dataUrl || "").match(/^data:(image\/png|image\/jpeg|image\/webp|image\/gif);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error("El comprobante debe ser una imagen PNG, JPG, WEBP o GIF.");
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_RECEIPT_BYTES) {
    throw new Error("El comprobante esta muy pesado. Usa una imagen menor a 12 MB.");
  }
  if (detectImageMime(buffer) !== mime) {
    throw new Error("El comprobante no parece ser una imagen valida.");
  }

  const ext = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[mime];
  const fileName = `comprobante-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  return {
    buffer,
    fileName,
    mime,
    receiptName: cleanFileName(originalName, fileName)
  };
}

async function saveReceipt(dataUrl, originalName) {
  const receipt = parseReceipt(dataUrl, originalName);
  if (USE_SUPABASE) {
    await ensureSupabaseReceiptBucket();
    await supabaseRequest(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(receipt.fileName)}`, {
      method: "POST",
      headers: {
        "Content-Type": receipt.mime,
        "x-upsert": "false"
      },
      body: receipt.buffer
    });
    return {
      receiptUrl: `storage://${SUPABASE_BUCKET}/${receipt.fileName}`,
      receiptName: receipt.receiptName
    };
  }

  const target = path.join(UPLOAD_DIR, receipt.fileName);
  fs.writeFileSync(target, receipt.buffer);
  return {
    receiptUrl: `/uploads/${receipt.fileName}`,
    receiptName: receipt.receiptName
  };
}

async function deleteReceipt(record) {
  if (!record || !record.receiptUrl) return;

  try {
    if (USE_SUPABASE) {
      const objectPath = supabaseReceiptObjectPath(record);

      if (objectPath) {
        await supabaseRequest(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodedStoragePath(objectPath)}`, {
          method: "DELETE"
        });
      }
      return;
    }

    const target = localReceiptPath(record);
    if (target) {
      const resolvedTarget = path.resolve(target);
      if (resolvedTarget.startsWith(UPLOAD_DIR)) fs.rmSync(resolvedTarget, { force: true });
    }
  } catch (error) {
    console.warn("No se pudo borrar el comprobante:", error.message);
  }
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateLimit(req, res, name, limit, windowMs) {
  const now = Date.now();
  const key = `${name}:${getClientIp(req)}`;
  const current = RATE_LIMITS.get(key);
  if (!current || current.resetAt <= now) {
    RATE_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  current.count += 1;
  if (current.count > limit) {
    res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    sendJson(res, 429, { error: "Demasiados intentos. Intenta otra vez en unos minutos." });
    return false;
  }
  return true;
}

function hasTrustedOrigin(req) {
  if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.headers.host;
  } catch {
    return false;
  }
}

async function handleApi(req, res, url) {
  if (!hasTrustedOrigin(req)) {
    sendJson(res, 403, { error: "Origen no permitido." });
    return true;
  }

  if (url.pathname.startsWith("/api/admin/") && !rateLimit(req, res, "admin", 240, 15 * 60 * 1000)) {
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/reservations" && !rateLimit(req, res, "reservations-create", 12, 60 * 60 * 1000)) {
    return true;
  }
  if (req.method === "POST" && /^\/api\/reservations\/[^/]+\/receipt$/.test(url.pathname) && !rateLimit(req, res, "receipt-upload", 24, 60 * 60 * 1000)) {
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/reservations" && !rateLimit(req, res, "reservations-check", 120, 15 * 60 * 1000)) {
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      storage: USE_SUPABASE ? "supabase" : "local",
      adminConfigured: Boolean(ADMIN_KEY),
      receiptBucket: USE_SUPABASE ? SUPABASE_BUCKET : "local"
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/tickets") {
    const ticketSettings = getTicketSettings();
    const store = await loadStore();
    const changed = expireOldReservations(store.reservations);
    await persistExpiredReservations(store, changed);
    const lockedReservations = store.reservations.filter(locksTicket);
    const unavailableTickets = lockedReservations.flatMap((record) => {
      return record.ticketNumbers.map((ticket) => ({
        ticket,
        status: record.status,
        buyerNumber: record.buyerNumber,
        heldUntil: record.heldUntil || null
      }));
    });
    sendJson(res, 200, { holdHours: HOLD_HOURS, tickets: ticketSettings, unavailableTickets });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/reservations") {
    const ticketSettings = getTicketSettings();
    const phone = cleanPhone(url.searchParams.get("phone"));
    const ticket = normalizeTicket(url.searchParams.get("ticket"), ticketSettings);
    const store = await loadStore();
    const changed = expireOldReservations(store.reservations);
    await persistExpiredReservations(store, changed);
    const reservations = store.reservations
      .filter((record) => {
        if (ticket) return record.ticketNumbers.includes(ticket);
        return phone && cleanPhone(record.phone) === phone;
      })
      .map((record) => publicReservation(record, { includeReceipt: true }));
    sendJson(res, 200, { reservations, query: { phone: phone || null, ticket: ticket || null } });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/reservations") {
    try {
      const body = JSON.parse(await readBody(req));
      const ticketSettings = getTicketSettings();
      const rawTicketNumbers = Array.isArray(body.ticketNumbers)
        ? body.ticketNumbers.map((ticket) => String(ticket).trim()).filter(Boolean)
        : [];
      const ticketNumbers = rawTicketNumbers.map((ticket) => normalizeTicket(ticket, ticketSettings)).filter(Boolean);
      const phone = cleanPhone(body.phone);
      const name = cleanText(body.name, 60);
      const lastName = cleanText(body.lastName, 60);
      const state = cleanText(body.state, 60);
      const prize = cleanText(body.prize || "Premio Principal", 80) || "Premio Principal";

      if (!ticketNumbers.length) throw new Error("Selecciona al menos un boleto.");
      if (ticketNumbers.length !== rawTicketNumbers.length) throw new Error("Hay boletos no validos en la seleccion.");
      if (new Set(ticketNumbers).size !== ticketNumbers.length) throw new Error("Hay boletos repetidos en la seleccion.");
      if (ticketNumbers.length > ticketSettings.maxPerReservation) throw new Error(`Solo puedes apartar hasta ${ticketSettings.maxPerReservation} boletos por envio.`);
      if (!name || !lastName || !state || !phone) {
        throw new Error("Faltan datos del cliente.");
      }
      if (phone.length < 10 || phone.length > 15) throw new Error("El celular debe tener entre 10 y 15 digitos.");

      const store = await loadStore();
      const changed = expireOldReservations(store.reservations);
      await persistExpiredReservations(store, changed);
      const activeReservations = store.reservations.filter(locksTicket);
      const taken = ticketNumbers.filter((ticket) => {
        return activeReservations.some((record) => record.ticketNumbers.includes(ticket));
      });
      if (taken.length) {
        throw new Error(`Estos boletos ya estan apartados: ${taken.join(", ")}`);
      }

      const now = new Date().toISOString();
      const reservation = {
        id: crypto.randomUUID(),
        buyerNumber: USE_SUPABASE ? null : store.db.meta.nextBuyerNumber,
        prize,
        ticketNumbers,
        name,
        lastName,
        state,
        phone,
        status: "pendiente",
        receiptUrl: "",
        receiptName: "",
        createdAt: now,
        sentAt: null,
        paidAt: null,
        statusUpdatedAt: now,
        heldUntil: new Date(Date.now() + HOLD_MS).toISOString()
      };

      const savedReservation = USE_SUPABASE ? await createSupabaseReservation(reservation) : reservation;
      if (!USE_SUPABASE) {
        store.db.meta.nextBuyerNumber += 1;
        store.db.reservations.unshift(reservation);
        writeDb(store.db);
      }
      sendJson(res, 201, { reservation: publicReservation(savedReservation) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const publicReceiptMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)\/receipt$/);
  if (req.method === "POST" && publicReceiptMatch) {
    try {
      const body = JSON.parse(await readBody(req));
      const phone = cleanPhone(body.phone);
      if (phone.length < 10 || phone.length > 15) {
        throw new Error("El celular debe tener entre 10 y 15 digitos.");
      }

      const store = await loadStore();
      const changed = expireOldReservations(store.reservations);
      await persistExpiredReservations(store, changed);

      const reservation = store.reservations.find((record) => record.id === publicReceiptMatch[1]);
      if (!reservation) throw new Error("Apartado no encontrado.");
      if (cleanPhone(reservation.phone) !== phone) {
        throw new Error("El celular no coincide con este apartado.");
      }
      if (reservation.status === "cancelado") throw new Error("Este apartado esta cancelado.");
      if (reservation.status === "expirado" || isHoldExpired(reservation)) {
        reservation.status = "expirado";
        reservation.statusUpdatedAt = new Date().toISOString();
        reservation.paidAt = null;
        if (!USE_SUPABASE) writeDb(store.db);
        else await updateSupabaseReservation(reservation.id, reservation);
        throw new Error("Este apartado ya expiro. Vuelve a apartar boletos disponibles.");
      }
      if (reservation.status === "pagado") throw new Error("Este apartado ya esta marcado como pagado.");

      const oldReceipt = { ...reservation };
      const receipt = await saveReceipt(body.receiptDataUrl, body.receiptName);
      const now = new Date().toISOString();
      reservation.status = "en_revision";
      reservation.receiptUrl = receipt.receiptUrl;
      reservation.receiptName = receipt.receiptName;
      reservation.sentAt = now;
      reservation.statusUpdatedAt = now;
      reservation.paidAt = null;
      reservation.heldUntil = new Date(Date.now() + HOLD_MS).toISOString();

      const savedReservation = USE_SUPABASE
        ? await updateSupabaseReservation(reservation.id, reservation)
        : reservation;
      if (!USE_SUPABASE) writeDb(store.db);
      if (oldReceipt.receiptUrl) await deleteReceipt(oldReceipt);

      sendJson(res, 200, { reservation: publicReservation(savedReservation || reservation, { includeReceipt: true }) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/reservations") {
    if (!requireAdmin(req, res, url)) return true;
    const store = await loadStore();
    const changed = expireOldReservations(store.reservations);
    await persistExpiredReservations(store, changed);
    sendJson(res, 200, { reservations: store.reservations.map((record) => publicReservation(record, { includeReceipt: true })) });
    return true;
  }

  const statusMatch = url.pathname.match(/^\/api\/admin\/reservations\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    if (!requireAdmin(req, res, url)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      if (!STATUS.has(body.status)) throw new Error("Estado no valido.");
      const store = await loadStore();
      const changed = expireOldReservations(store.reservations);
      await persistExpiredReservations(store, changed);
      const reservation = store.reservations.find((record) => record.id === statusMatch[1]);
      if (!reservation) throw new Error("Apartado no encontrado.");

      reservation.status = body.status;
      reservation.paidAt = body.status === "pagado" ? new Date().toISOString() : null;
      reservation.statusUpdatedAt = new Date().toISOString();
      if (body.status === "en_revision" || body.status === "pendiente") {
        reservation.heldUntil = new Date(Date.now() + HOLD_MS).toISOString();
      }

      const savedReservation = USE_SUPABASE
        ? await updateSupabaseReservation(reservation.id, reservation)
        : reservation;
      if (!USE_SUPABASE) writeDb(store.db);
      sendJson(res, 200, { reservation: publicReservation(savedReservation || reservation, { includeReceipt: true }) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const receiptMatch = url.pathname.match(/^\/api\/admin\/reservations\/([^/]+)\/receipt$/);
  if (req.method === "GET" && receiptMatch) {
    if (!requireAdmin(req, res, url)) return true;
    try {
      const store = await loadStore();
      const reservation = store.reservations.find((record) => record.id === receiptMatch[1]);
      if (!reservation) throw new Error("Apartado no encontrado.");
      const receipt = await readReceipt(reservation);
      sendBinary(res, 200, receipt.buffer, receipt.contentType);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return true;
  }

  const deleteMatch = url.pathname.match(/^\/api\/admin\/reservations\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    if (!requireAdmin(req, res, url)) return true;
    try {
      const store = await loadStore();
      const changed = expireOldReservations(store.reservations);
      await persistExpiredReservations(store, changed);
      const reservationIndex = store.reservations.findIndex((record) => record.id === deleteMatch[1]);
      if (reservationIndex === -1) throw new Error("Apartado no encontrado.");

      const [reservation] = store.reservations.splice(reservationIndex, 1);
      if (USE_SUPABASE) {
        await deleteSupabaseReservation(reservation.id);
      } else {
        writeDb(store.db);
      }
      await deleteReceipt(reservation);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  setSecurityHeaders(res);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    res.end("Metodo no permitido");
    return;
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Ruta no valida");
    return;
  }

  const target = path.resolve(ROOT, `.${requestedPath}`);
  const relative = path.relative(ROOT, target);
  const parts = relative.split(path.sep).filter(Boolean);
  const ext = path.extname(target).toLowerCase();
  const isRootFile = parts.length === 1 && PUBLIC_ROOT_FILES.has(parts[0]);
  const isPublicImage = parts.length >= 2 && PUBLIC_IMAGE_DIRS.has(parts[0]) && PUBLIC_IMAGE_EXTENSIONS.has(ext);
  const isInsideRoot = relative && !relative.startsWith("..") && !path.isAbsolute(relative);

  if (!isInsideRoot || (!isRootFile && !isPublicImage)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const cacheControl = ext === ".html" || ext === ".js" || ext === ".css" || ext === ".json"
      ? "no-store"
      : "public, max-age=86400";
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": cacheControl
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(data);
  });
}

function startServer(port = process.env.PORT || 56684) {
  ensureStorage();
  const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (!handled) sendJson(res, 404, { error: "Ruta no encontrada." });
        return;
      }
      serveStatic(req, res, url);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Error interno del servidor." });
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 20000;
  server.maxHeadersCount = 80;

  server.listen(port, host, () => {
    const address = server.address();
    console.log(`Sorteos El Yorch listo en http://127.0.0.1:${address.port}/`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };

