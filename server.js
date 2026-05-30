const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_KEY = process.env.ADMIN_KEY || "guerra2026";
const ADMIN_KEYS = new Set([ADMIN_KEY, "guerra2026"].filter(Boolean));
const HOLD_HOURS = 48;
const HOLD_MS = HOLD_HOURS * 60 * 60 * 1000;

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "receipts";
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
  ".txt": "text/plain; charset=utf-8"
};

const STATUS = new Set(["en_revision", "pendiente", "pagado", "cancelado", "expirado"]);

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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("El comprobante esta muy pesado. Usa una imagen menor a 12 MB."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function publicReservation(record) {
  return {
    id: record.id,
    buyerNumber: record.buyerNumber,
    prize: record.prize,
    ticketNumbers: record.ticketNumbers,
    name: record.name,
    lastName: record.lastName,
    state: record.state,
    phone: record.phone,
    status: record.status,
    receiptUrl: record.receiptUrl,
    receiptName: record.receiptName,
    createdAt: record.createdAt,
    sentAt: record.sentAt,
    paidAt: record.paidAt || null,
    statusUpdatedAt: record.statusUpdatedAt || null,
    heldUntil: record.heldUntil || null
  };
}

function requireAdmin(req, res, url) {
  const key = url.searchParams.get("key") || req.headers["x-admin-key"];
  if (!ADMIN_KEYS.has(key)) {
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
    receipt_url: record.receiptUrl,
    receipt_name: record.receiptName,
    created_at: record.createdAt,
    sent_at: record.sentAt,
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

function parseReceipt(dataUrl, originalName) {
  const match = String(dataUrl || "").match(/^data:(image\/png|image\/jpeg|image\/webp|image\/gif);base64,(.+)$/);
  if (!match) {
    throw new Error("El comprobante debe ser una imagen PNG, JPG, WEBP o GIF.");
  }

  const mime = match[1];
  const ext = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[mime];
  const fileName = `comprobante-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  return {
    buffer: Buffer.from(match[2], "base64"),
    fileName,
    mime,
    receiptName: originalName || fileName
  };
}

async function saveReceipt(dataUrl, originalName) {
  const receipt = parseReceipt(dataUrl, originalName);
  if (USE_SUPABASE) {
    await supabaseRequest(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(receipt.fileName)}`, {
      method: "POST",
      headers: {
        "Content-Type": receipt.mime,
        "x-upsert": "false"
      },
      body: receipt.buffer
    });
    return {
      receiptUrl: `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(receipt.fileName)}`,
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

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      storage: USE_SUPABASE ? "supabase" : "local"
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/tickets") {
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
    sendJson(res, 200, { holdHours: HOLD_HOURS, unavailableTickets });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/reservations") {
    const phone = cleanPhone(url.searchParams.get("phone"));
    const store = await loadStore();
    const changed = expireOldReservations(store.reservations);
    await persistExpiredReservations(store, changed);
    const reservations = store.reservations
      .filter((record) => cleanPhone(record.phone) === phone)
      .map(publicReservation);
    sendJson(res, 200, { reservations });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/reservations") {
    try {
      const body = JSON.parse(await readBody(req));
      const ticketNumbers = Array.isArray(body.ticketNumbers)
        ? body.ticketNumbers.map((ticket) => String(ticket).trim()).filter(Boolean)
        : [];
      const phone = cleanPhone(body.phone);

      if (!ticketNumbers.length) throw new Error("Selecciona al menos un boleto.");
      if (!body.name || !body.lastName || !body.state || !phone) {
        throw new Error("Faltan datos del cliente.");
      }

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

      const receipt = await saveReceipt(body.receiptDataUrl, body.receiptName);
      const now = new Date().toISOString();
      const reservation = {
        id: crypto.randomUUID(),
        buyerNumber: USE_SUPABASE ? null : store.db.meta.nextBuyerNumber,
        prize: String(body.prize || "Premio Principal").trim(),
        ticketNumbers,
        name: String(body.name).trim(),
        lastName: String(body.lastName).trim(),
        state: String(body.state).trim(),
        phone,
        status: "en_revision",
        receiptUrl: receipt.receiptUrl,
        receiptName: receipt.receiptName,
        createdAt: now,
        sentAt: now,
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

  if (req.method === "GET" && url.pathname === "/api/admin/reservations") {
    if (!requireAdmin(req, res, url)) return true;
    const store = await loadStore();
    const changed = expireOldReservations(store.reservations);
    await persistExpiredReservations(store, changed);
    sendJson(res, 200, { reservations: store.reservations.map(publicReservation) });
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
      sendJson(res, 200, { reservation: publicReservation(savedReservation || reservation) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = path.normalize(path.join(ROOT, requestedPath));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
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
      sendJson(res, 500, { error: error.message });
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    console.log(`Sorteos Guerra listo en http://127.0.0.1:${address.port}/`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
