const menuButton = document.querySelector(".nav-toggle");
const navMenu = document.querySelector("#navMenu");
const numberGrid = document.querySelector(".number-grid");
let ticketButtons = [];
const ticketCount = document.querySelector("#ticketCount");
const ticketForm = document.querySelector(".ticket-panel");
const randomTicketQuantity = document.querySelector("#randomTicketQuantity");
const randomTicketButton = document.querySelector("#randomTicketButton");
const clearTicketSelectionButton = document.querySelector("#clearTicketSelection");
const formNote = document.querySelector("#formNote");
const verifyForm = document.querySelector("#verifyForm");
const verifyPhone = document.querySelector("#verifyPhone");
const verifyRows = document.querySelector("#verifyRows");
const verifySummary = document.querySelector("#verifySummary");
const verifyReceiptArea = document.querySelector("#verifyReceiptArea");
const adminLogin = document.querySelector("#adminLogin");
const adminPanel = document.querySelector("#adminPanel");
const adminRows = document.querySelector("#adminRows");
const adminCount = document.querySelector("#adminCount");
const refreshAdmin = document.querySelector("#refreshAdmin");
const adminSearch = document.querySelector("#adminSearch");
const adminStats = document.querySelector("#adminStats");

let adminKey = sessionStorage.getItem("sorteosAdminKey") || "";
let adminRecords = [];
let siteConfig = {};
let adminReceiptObjectUrls = [];
let lastVerificationQuery = "";

const RECEIPT_MAX_BYTES = 12 * 1024 * 1024;
const RECEIPT_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const escapeHtml = (value) => {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
};

const safeStatus = (status) => {
  const allowed = ["pagado", "en_revision", "pendiente", "cancelado", "expirado"];
  return allowed.includes(status) ? status : "pendiente";
};

const safeUrl = (value) => {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    if (url.origin === window.location.origin || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
};

const normalizeConfigPath = (value) => {
  return String(value || "").trim().replace(/\\/g, "/");
};

const cssImageValue = (value) => {
  const imagePath = normalizeConfigPath(value);
  if (!imagePath) return "";
  return `url("${imagePath.replace(/"/g, "%22")}")`;
};

const setText = (selector, value) => {
  if (value === undefined || value === null || value === "") return;
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
};

const setHrefText = (selector, href, text) => {
  document.querySelectorAll(selector).forEach((element) => {
    if (href) element.href = href;
    if (text) element.textContent = text;
  });
};

const parseMoneyAmount = (value) => {
  let cleaned = String(value || "").replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (hasComma) {
    const commaParts = cleaned.split(",");
    const lastPart = commaParts[commaParts.length - 1];
    cleaned = lastPart.length <= 2 && commaParts.length === 2
      ? cleaned.replace(",", ".")
      : cleaned.replace(/,/g, "");
  }

  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

const formatMoneyAmount = (amount) => {
  const decimals = amount % 1 === 0 ? 0 : 2;
  return `${new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2
  }).format(amount)} MXN`;
};

const currentTicketPrice = () => {
  return parseMoneyAmount(siteConfig?.sorteo?.precio) ?? 0;
};

const paymentSummary = (record) => {
  const tickets = Array.isArray(record.ticketNumbers) ? record.ticketNumbers : [];
  const price = currentTicketPrice();
  if (!tickets.length || !price) return "Por confirmar";
  return `${formatMoneyAmount(price * tickets.length)} (${tickets.length} x ${formatMoneyAmount(price)})`;
};

const clearAdminReceiptObjectUrls = () => {
  adminReceiptObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  adminReceiptObjectUrls = [];
};

const loadSiteConfig = async () => {
  if (window.location.protocol === "file:") return {};
  try {
    const response = await fetch(`sorteos-g.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
};

const applyImageConfig = (config) => {
  const images = config.imagenes || {};
  const imageEntries = [
    ["--imagen-1", images.imagen1, ".prize-slide--primary .image-number--hero"],
    ["--imagen-2", images.imagen2, ".prize-slide--secondary .image-number--hero"],
    ["--imagen-3", images.imagen3, ".placeholder-image--three"],
    ["--imagen-4", images.imagen4, ".image-number--about"]
  ];

  imageEntries.forEach(([variable, imagePath, markerSelector]) => {
    const cssValue = cssImageValue(imagePath);
    if (cssValue) {
      document.documentElement.style.setProperty(variable, cssValue);
      document.querySelectorAll(markerSelector).forEach((element) => {
        element.style.display = "none";
      });
    }
  });

  if (images.logo) {
    document.querySelectorAll(".brand-image, .mini-logo img").forEach((image) => {
      image.src = normalizeConfigPath(images.logo);
    });
  }
};

const applySiteConfig = (config = {}) => {
  const site = config.sitio || {};
  const raffle = config.sorteo || {};
  const tickets = config.boletos || {};
  const contact = config.contacto || {};
  const payment = config.pago || {};
  const home = config.inicio || {};

  const siteName = site.nombre || "Sorteos El Yorch";
  const currentTitle = document.title.split("|")[1]?.trim();
  document.title = currentTitle ? `${siteName} | ${currentTitle}` : siteName;

  document.querySelectorAll(".brand").forEach((brand) => {
    brand.setAttribute("aria-label", `${siteName} inicio`);
  });
  document.querySelectorAll(".brand-image, .mini-logo img").forEach((image) => {
    image.alt = siteName;
  });

  setText("#heroTitle", siteName);
  setText(".eyebrow", site.lema);
  setText(".about-overlay strong", site.frasePrincipal);
  setText(".site-footer span", site.textoFooter);
  setText(".social-preview strong", siteName);

  setText(".raffle-card__tag", raffle.estado);
  setText(".raffle-card__body h3", raffle.premio);
  setText(".raffle-card__body > p:not(.raffle-card__tag)", raffle.descripcion);
  setText(".raffle-meta strong", raffle.precio);
  setText(".raffle-meta span", raffle.textoPrecio);
  const soldPercent = Number(raffle.porcentajeVendido);
  if (Number.isFinite(soldPercent)) {
    document.querySelectorAll(".progress").forEach((element) => {
      element.setAttribute("aria-label", `${soldPercent} por ciento vendido`);
    });
    document.querySelectorAll(".progress span").forEach((element) => {
      element.style.width = `${Math.max(0, Math.min(100, soldPercent))}%`;
    });
  }

  document.querySelectorAll("#premio").forEach((select) => {
    const prizeName = raffle.premio || "Premio Principal";
    select.innerHTML = `<option>${escapeHtml(prizeName)}</option>`;
  });

  if (numberGrid) {
    if (tickets.inicio) numberGrid.dataset.ticketStart = tickets.inicio;
    if (tickets.final) numberGrid.dataset.ticketEnd = tickets.final;
    if (tickets.digitos) numberGrid.dataset.ticketPad = tickets.digitos;
  }

  if (randomTicketQuantity && tickets.maximosPorEnvio) {
    randomTicketQuantity.max = tickets.maximosPorEnvio;
  }

  const whatsappNumber = String(contact.whatsappNumero || "").replace(/\D/g, "");
  const whatsappText = contact.whatsappTexto || "";
  const whatsappHref = whatsappNumber ? `https://wa.me/${whatsappNumber}` : "";
  document.querySelectorAll(".site-footer a[href*='wa.me']").forEach((link) => {
    if (whatsappHref) link.href = whatsappHref;
    if (whatsappText) link.innerHTML = `PREGUNTAS AL WHATSAPP<br>${escapeHtml(whatsappText)}`;
  });
  setHrefText(".phone-link", whatsappHref, whatsappText ? `WHATSAPP: ${whatsappText}` : "");
  const socialLinks = document.querySelectorAll(".social-actions a");
  if (socialLinks[0] && whatsappHref) socialLinks[0].href = whatsappHref;
  if (socialLinks[1] && contact.facebookUrl) socialLinks[1].href = contact.facebookUrl;
  if (socialLinks[2] && contact.telefono) socialLinks[2].href = `tel:${contact.telefono}`;

  setText(".payment-grid article p:nth-of-type(1)", payment.banco ? `Banco: ${payment.banco}` : "");
  const paymentAccount = payment.tarjeta
    ? `Tarjeta: ${payment.tarjeta}`
    : payment.clabe
      ? `CLABE: ${payment.clabe}`
      : "";
  setText(".payment-grid article p:nth-of-type(2)", paymentAccount);
  setText(".payment-grid article p:nth-of-type(3)", payment.titular ? `Nombre: ${payment.titular}` : "");
  setText(".payment-grid article p:nth-of-type(4)", payment.nota);

  setText(".stamp-button[href='sorteo.html']", home.botonDisponibles);
  setText(".stamp-button[href='boletos.html']", home.botonComprar);
  const marqueeItems = document.querySelectorAll(".blue-marquee span");
  if (marqueeItems[0] && home.marquesina1) marqueeItems[0].textContent = home.marquesina1;
  if (marqueeItems[1] && home.marquesina2) marqueeItems[1].textContent = home.marquesina2;
  if (marqueeItems[2] && home.marquesina3) marqueeItems[2].textContent = home.marquesina3;

  applyImageConfig(config);
};

const renderTicketButtons = () => {
  if (!numberGrid) return;
  numberGrid.querySelectorAll("button").forEach((button) => button.remove());
  const start = Number(numberGrid.dataset.ticketStart || 1);
  const end = Number(numberGrid.dataset.ticketEnd || 99);
  const pad = Number(numberGrid.dataset.ticketPad || String(end).length);
  const buttons = [];

  for (let number = start; number <= end; number += 1) {
    const label = String(number).padStart(pad, "0");
    buttons.push(`<button type="button">${label}</button>`);
  }

  numberGrid.insertAdjacentHTML("beforeend", buttons.join(""));
  ticketButtons = [...numberGrid.querySelectorAll("button")];
  bindTicketButtons();
};

const showServerRequiredMessage = () => {
  if (window.location.protocol !== "file:") return false;

  const message = document.createElement("div");
  message.className = "server-warning";
  message.innerHTML = `
    <strong>Abre el panel con el servidor prendido</strong>
    <p>Esta pagina no funciona si la abres como archivo directo. Usa el acceso del Escritorio <b>Abrir Panel Sorteos El Yorch.bat</b> o entra a:</p>
    <a href="http://127.0.0.1:56684/admin.html">http://127.0.0.1:56684/admin.html</a>
  `;
  document.body.prepend(message);
  return true;
};

const serverRequired = showServerRequiredMessage();

// Esta parte convierte los iconos del sitio. No tienes que moverle para cambiar de sorteo.
if (window.lucide) {
  window.lucide.createIcons();
}

// Menu de celular.
menuButton?.addEventListener("click", () => {
  const isOpen = navMenu.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

navMenu?.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    navMenu.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }
});

const normalizePhone = (value) => value.replace(/\D/g, "");

const ticketSettingsForPage = () => {
  const tickets = siteConfig.boletos || {};
  const start = Number(tickets.inicio || 1);
  const end = Number(tickets.final || 99);
  const pad = Number(tickets.digitos || String(end).length);
  const maxPerReservation = Number(tickets.maximosPorEnvio || 30);
  return { start, end, pad, maxPerReservation };
};

const normalizeTicketForPage = (value) => {
  const ticket = String(value || "").trim().replace(/\D/g, "");
  if (!ticket) return "";
  const settings = ticketSettingsForPage();
  const number = Number(ticket);
  if (!Number.isInteger(number) || number < settings.start || number > settings.end) return "";
  return String(number).padStart(settings.pad, "0");
};

const selectedTickets = () => {
  return [...document.querySelectorAll(".number-grid button.is-selected")].map((button) => button.textContent.trim());
};

const updateTicketCount = () => {
  if (!ticketCount) return;
  const selected = selectedTickets().length;
  ticketCount.textContent = `${selected} seleccionado${selected === 1 ? "" : "s"}`;
};

const setSelectedTickets = (buttons) => {
  ticketButtons.forEach((button) => button.classList.remove("is-selected"));
  buttons.forEach((button) => {
    if (!button.disabled) button.classList.add("is-selected");
  });
  updateTicketCount();
};

const shuffleButtons = (buttons) => {
  const shuffled = [...buttons];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
};

const bindTicketButtons = () => {
  ticketButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      button.classList.toggle("is-selected");
      updateTicketCount();
    });
  });
};

randomTicketButton?.addEventListener("click", () => {
  const configuredMax = Number(randomTicketQuantity?.max || ticketSettingsForPage().maxPerReservation || 30);
  const max = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 30;
  const requestedNumber = Number(randomTicketQuantity?.value || 1);
  const requested = Number.isFinite(requestedNumber) ? requestedNumber : 1;
  const quantity = Math.max(1, Math.min(max, Math.floor(requested)));
  const availableButtons = ticketButtons.filter((button) => !button.disabled);

  if (randomTicketQuantity) {
    randomTicketQuantity.value = String(quantity);
  }

  if (!availableButtons.length) {
    formNote.textContent = "No hay boletos disponibles para elegir al azar.";
    return;
  }

  if (quantity > availableButtons.length) {
    formNote.textContent = `Solo hay ${availableButtons.length} boleto${availableButtons.length === 1 ? "" : "s"} disponible${availableButtons.length === 1 ? "" : "s"}.`;
    return;
  }

  setSelectedTickets(shuffleButtons(availableButtons).slice(0, quantity));
  formNote.textContent = `${quantity} boleto${quantity === 1 ? "" : "s"} elegido${quantity === 1 ? "" : "s"} al azar.`;
});

clearTicketSelectionButton?.addEventListener("click", () => {
  setSelectedTickets([]);
  formNote.textContent = "Seleccion limpia.";
});

const fileToDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el comprobante."));
    reader.readAsDataURL(file);
  });
};

const canvasToBlob = (canvas, type, quality) => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo preparar la imagen del comprobante."));
    }, type, quality);
  });
};

const compressReceiptImage = async (file) => {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return file;
  if (file.size <= 1.5 * 1024 * 1024) return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("No se pudo abrir la imagen. Intenta con JPG o PNG."));
    });
    image.src = imageUrl;
    await loaded;

    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.82);
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

const receiptFileToDataUrl = async (file) => {
  if (!file || !file.size) {
    throw new Error("Selecciona la imagen del comprobante.");
  }
  if (!RECEIPT_ALLOWED_TYPES.has(file.type)) {
    throw new Error("Usa una imagen JPG, PNG, WEBP o GIF. Si tu celular guarda HEIC, conviertela a JPG.");
  }

  const preparedFile = await compressReceiptImage(file);
  if (preparedFile.size > RECEIPT_MAX_BYTES) {
    throw new Error("El comprobante esta muy pesado. Usa una imagen menor a 12 MB.");
  }

  return {
    dataUrl: await fileToDataUrl(preparedFile),
    name: preparedFile.name
  };
};

const formatDate = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

const statusLabel = (status) => {
  const labels = {
    pagado: "Pagado",
    en_revision: "En revision",
    pendiente: "Pendiente",
    cancelado: "Cancelado",
    expirado: "Expirado"
  };
  return labels[status] || status;
};

const api = async (url, options = {}) => {
  if (serverRequired) {
    throw new Error("Abre la pagina desde http://127.0.0.1:56684 para usar la base de datos.");
  }

  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "No se pudo completar la accion.");
  }
  return data;
};

const loadTicketAvailability = async () => {
  if (!ticketForm) return;
  const availabilityLabel = document.querySelector("#ticketAvailability");
  try {
    const data = await api("/api/tickets");
    const unavailable = new Map(data.unavailableTickets.map((item) => [item.ticket, item]));
    if (randomTicketQuantity && data.tickets?.maxPerReservation) {
      randomTicketQuantity.max = data.tickets.maxPerReservation;
    }

    ticketButtons.forEach((button) => {
      const ticket = button.textContent.trim();
      const unavailableInfo = unavailable.get(ticket);
      button.disabled = Boolean(unavailableInfo);
      button.classList.toggle("is-unavailable", Boolean(unavailableInfo));
      button.classList.remove("is-selected");

      if (unavailableInfo) {
        const releaseText = unavailableInfo.heldUntil
          ? `Se libera ${formatDate(unavailableInfo.heldUntil)} si no se paga`
          : "No disponible";
        button.title = unavailableInfo.status === "pagado" ? "Boleto pagado" : releaseText;
        button.setAttribute("aria-label", `${ticket} ocupado`);
      } else {
        button.title = "Disponible";
        button.setAttribute("aria-label", `${ticket} disponible`);
      }
    });

    const availableCount = [...ticketButtons].filter((button) => !button.disabled).length;
    if (availabilityLabel) {
      availabilityLabel.textContent = `Disponibles: ${availableCount} de ${ticketButtons.length}. Los apartados no pagados se liberan en ${data.holdHours} horas.`;
    }
    updateTicketCount();
  } catch (error) {
    if (availabilityLabel) {
      availabilityLabel.textContent = "No se pudo cargar disponibilidad. Revisa que el servidor este prendido.";
    }
  }
};

const uniqueReservations = (records) => {
  const seen = new Set();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
};

const renderReceiptUpload = (records) => {
  if (!verifyReceiptArea) return;

  const reservations = uniqueReservations(records);
  if (!reservations.length) {
    verifyReceiptArea.innerHTML = "";
    return;
  }

  const cleanQueryPhone = normalizePhone(lastVerificationQuery);
  const prefillPhone = cleanQueryPhone.length >= 10 ? cleanQueryPhone : "";

  verifyReceiptArea.innerHTML = reservations.map((record) => {
    const status = safeStatus(record.status);
    const tickets = (Array.isArray(record.ticketNumbers) ? record.ticketNumbers : []).map(escapeHtml).join(", ");
    const buyer = escapeHtml(record.buyerNumber || "");
    const statusText = statusLabel(status);
    const amount = escapeHtml(paymentSummary(record));

    if (record.hasReceipt) {
      return `
        <article class="receipt-upload-card receipt-upload-card--received">
          <div>
            <span>Comprador ${buyer}</span>
            <strong>Comprobante recibido</strong>
            <p>Boletos: ${tickets}</p>
            <p>Estado: ${escapeHtml(statusText)}</p>
          </div>
        </article>
      `;
    }

    if (status === "cancelado" || status === "expirado" || status === "pagado") {
      return `
        <article class="receipt-upload-card">
          <div>
            <span>Comprador ${buyer}</span>
            <strong>No se puede subir comprobante</strong>
            <p>Boletos: ${tickets}</p>
            <p>Estado: ${escapeHtml(statusText)}</p>
          </div>
        </article>
      `;
    }

    return `
      <article class="receipt-upload-card">
        <div>
          <span>Comprador ${buyer}</span>
          <strong>Subir comprobante de transferencia</strong>
          <p>Boletos: ${tickets}</p>
          <p>Debe pagar: ${amount}</p>
        </div>
        <form class="receipt-upload-form" data-id="${escapeHtml(record.id)}">
          <label>
            Celular registrado
            <input name="phone" type="tel" inputmode="numeric" value="${escapeHtml(prefillPhone)}" placeholder="Celular">
          </label>
          <label>
            Imagen del comprobante
            <input name="receipt" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
          </label>
          <button class="solid-button solid-button--small" type="submit">Enviar comprobante</button>
          <p class="receipt-upload-note" role="status" aria-live="polite"></p>
        </form>
      </article>
    `;
  }).join("");
};

const renderVerify = (records, searchedTicket = "") => {
  renderReceiptUpload(records);
  let rows = records.flatMap((record) => {
    return record.ticketNumbers.map((ticket) => ({ ...record, ticket }));
  });
  if (searchedTicket) {
    rows = rows.filter((row) => row.ticket === searchedTicket);
  }

  const paid = rows.filter((row) => row.status === "pagado").length;
  const reviewing = rows.filter((row) => row.status === "en_revision").length;
  const unpaid = rows.filter((row) => row.status === "pendiente").length;
  const expired = rows.filter((row) => row.status === "expirado").length;

  verifySummary.innerHTML = `
    <span>Boletos Pagados: ${paid}</span>
    <span>En revision: ${reviewing}</span>
    <span>No pagados: ${unpaid}</span>
    <span>Expirados: ${expired}</span>
  `;

  if (!rows.length) {
    verifyRows.innerHTML = `<tr><td colspan="8">No hay boletos registrados con esa busqueda.</td></tr>`;
    return;
  }

  verifyRows.innerHTML = rows.map((row) => `
    <tr>
      <td class="ticket-cell">${escapeHtml(row.ticket)}</td>
      <td>${(Array.isArray(row.ticketNumbers) ? row.ticketNumbers : []).map(escapeHtml).join(", ")}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.lastName)}</td>
      <td>${escapeHtml(row.state)}</td>
      <td>${formatDate(row.sentAt)}</td>
      <td>${formatDate(row.createdAt)}</td>
      <td class="status-cell status-${safeStatus(row.status)}">${statusLabel(safeStatus(row.status))}</td>
    </tr>
  `).join("");
};

const loadVerification = async (value) => {
  const query = String(value || "").trim();
  lastVerificationQuery = query;
  const cleanPhone = normalizePhone(query);
  const searchedTicket = cleanPhone.length >= 10 ? "" : normalizeTicketForPage(query);

  if (!query) {
    renderReceiptUpload([]);
    verifyRows.innerHTML = `<tr><td colspan="8">Escribe el celular registrado o el numero de boleto.</td></tr>`;
    return;
  }
  if (!searchedTicket && cleanPhone.length < 10) {
    renderReceiptUpload([]);
    verifyRows.innerHTML = `<tr><td colspan="8">Escribe un boleto valido o un celular completo.</td></tr>`;
    return;
  }

  const params = new URLSearchParams();
  if (searchedTicket) {
    params.set("ticket", searchedTicket);
  } else {
    params.set("phone", cleanPhone);
  }

  const data = await api(`/api/reservations?${params.toString()}`);
  renderVerify(data.reservations, searchedTicket);
};

// Apartar boletos. El comprobante se sube despues desde Verificar.
ticketForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = selectedTickets();
  const form = new FormData(ticketForm);
  const name = String(form.get("nombre") || "").trim();
  const lastName = String(form.get("apellido") || "").trim();
  const state = String(form.get("estado") || "").trim();
  const phone = normalizePhone(String(form.get("whatsapp") || ""));

  if (!selected.length) {
    formNote.textContent = "Selecciona al menos un boleto disponible.";
    return;
  }
  if (!name || !lastName || !state || !phone) {
    formNote.textContent = "Completa nombre, apellido, estado y celular.";
    return;
  }
  formNote.textContent = "Guardando apartado...";

  try {
    const data = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        prize: String(form.get("premio") || "Premio Principal"),
        ticketNumbers: selected,
        name,
        lastName,
        state,
        phone
      })
    });

    formNote.textContent = `Listo. Apartado guardado con folio ${data.reservation.id.slice(0, 8)}.`;
    window.location.href = `verificar.html?phone=${encodeURIComponent(phone)}`;
  } catch (error) {
    formNote.textContent = error.message;
  }
});

verifyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await loadVerification(verifyPhone.value);
  } catch (error) {
    verifyRows.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
  }
});

verifyReceiptArea?.addEventListener("submit", async (event) => {
  if (!event.target.matches(".receipt-upload-form")) return;
  event.preventDefault();

  const form = event.target;
  const note = form.querySelector(".receipt-upload-note");
  const data = new FormData(form);
  const id = form.dataset.id;
  const phone = normalizePhone(String(data.get("phone") || ""));
  const receipt = data.get("receipt");

  if (!phone || phone.length < 10) {
    note.textContent = "Escribe el celular registrado en el apartado.";
    return;
  }

  note.textContent = "Preparando comprobante...";

  try {
    const preparedReceipt = await receiptFileToDataUrl(receipt);
    note.textContent = "Enviando comprobante...";
    await api(`/api/reservations/${encodeURIComponent(id)}/receipt`, {
      method: "POST",
      body: JSON.stringify({
        phone,
        receiptName: preparedReceipt.name,
        receiptDataUrl: preparedReceipt.dataUrl
      })
    });

    note.textContent = "Comprobante recibido. Tu pago quedo en revision.";
    if (verifyPhone && !verifyPhone.value.trim()) verifyPhone.value = phone;
    await loadVerification(verifyPhone?.value || phone);
  } catch (error) {
    note.textContent = error.message;
  }
});

const renderAdminStats = (records) => {
  if (!adminStats) return;
  const total = records.length;
  const paid = records.filter((record) => record.status === "pagado").length;
  const reviewing = records.filter((record) => record.status === "en_revision").length;
  const pending = records.filter((record) => record.status === "pendiente").length;
  const expired = records.filter((record) => record.status === "expirado").length;

  adminStats.innerHTML = `
    <span><strong>${total}</strong> Compradores</span>
    <span><strong>${reviewing}</strong> En revision</span>
    <span><strong>${paid}</strong> Pagados</span>
    <span><strong>${pending}</strong> Pendientes</span>
    <span><strong>${expired}</strong> Expirados</span>
  `;
};

const filterAdminRecords = (records) => {
  const query = (adminSearch?.value || "").trim().toLowerCase();
  if (!query) return records;

  return records.filter((record) => {
    return [
      `comprador ${record.buyerNumber}`,
      record.name,
      record.lastName,
      record.phone,
      record.state,
      record.prize,
      record.status,
      ...record.ticketNumbers
    ].join(" ").toLowerCase().includes(query);
  });
};

const renderAdmin = (records) => {
  clearAdminReceiptObjectUrls();
  adminCount.textContent = `${records.length} comprador${records.length === 1 ? "" : "es"}`;
  if (!records.length) {
    adminRows.innerHTML = `<div class="empty-admin">Todavia no hay compradores registrados.</div>`;
    return;
  }

  adminRows.innerHTML = records.map((record, index) => {
    const status = safeStatus(record.status);
    const buyerNumber = escapeHtml(record.buyerNumber || index + 1);
    const tickets = (Array.isArray(record.ticketNumbers) ? record.ticketNumbers : []).map(escapeHtml).join(", ");
    const receiptPreview = record.hasReceipt
      ? `<div class="receipt-preview receipt-preview--pending" id="receipt-${escapeHtml(record.id)}" data-receipt-id="${escapeHtml(record.id)}">
          <span>Cargando comprobante...</span>
        </div>`
      : `<div class="receipt-preview"><span>Sin comprobante disponible</span></div>`;

    return `
    <article class="buyer-card status-border-${status}">
      <header class="buyer-card__header">
        <div>
          <span>Comprador ${buyerNumber}</span>
          <strong>${escapeHtml(record.name)} ${escapeHtml(record.lastName)}</strong>
        </div>
        <em class="status-pill status-${status}">${statusLabel(status)}</em>
      </header>

      <div class="buyer-card__body">
        <div class="buyer-details">
          <p><strong>Boletos:</strong> ${tickets}</p>
          <p><strong>Celular:</strong> ${escapeHtml(record.phone)}</p>
          <p><strong>Estado:</strong> ${escapeHtml(record.state)}</p>
          <p><strong>Premio:</strong> ${escapeHtml(record.prize)}</p>
          <p class="buyer-payment"><strong>Debe pagar:</strong> ${escapeHtml(paymentSummary(record))}</p>
          <p><strong>Apartado:</strong> ${formatDate(record.createdAt)}</p>
          <p><strong>Actualizado:</strong> ${formatDate(record.statusUpdatedAt)}</p>
        </div>

        ${receiptPreview}
      </div>

      <div class="buyer-actions">
        <button class="status-action status-action--paid" type="button" data-id="${escapeHtml(record.id)}" data-status="pagado">Pagado</button>
        <button class="status-action" type="button" data-id="${escapeHtml(record.id)}" data-status="en_revision">En revision</button>
        <button class="status-action" type="button" data-id="${escapeHtml(record.id)}" data-status="pendiente">Pendiente</button>
        <button class="status-action status-action--cancel" type="button" data-id="${escapeHtml(record.id)}" data-status="cancelado">Cancelar</button>
        <button class="admin-delete-action" type="button" data-id="${escapeHtml(record.id)}" data-buyer="Comprador ${buyerNumber}">Borrar</button>
      </div>
    </article>
  `;
  }).join("");
};

const loadAdminReceiptPreviews = async (records) => {
  const recordsWithReceipt = records.filter((record) => record.hasReceipt);
  await Promise.all(recordsWithReceipt.map(async (record) => {
    const target = document.getElementById(`receipt-${record.id}`);
    if (!target) return;

    try {
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(record.id)}/receipt`, {
        headers: { "X-Admin-Key": adminKey }
      });
      if (!response.ok) throw new Error("No se pudo cargar el comprobante.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      adminReceiptObjectUrls.push(objectUrl);
      target.innerHTML = `
        <a class="receipt-preview__link" href="${objectUrl}" target="_blank" rel="noreferrer">
          <img src="${objectUrl}" alt="Comprobante de pago del comprador ${escapeHtml(record.buyerNumber || "")}">
          <span>Ver comprobante completo</span>
        </a>
      `;
    } catch {
      target.innerHTML = `<span>No se pudo cargar el comprobante.</span>`;
    }
  }));
};

const loadAdmin = async () => {
  if (!Object.keys(siteConfig).length) {
    siteConfig = await loadSiteConfig();
  }
  const data = await api("/api/admin/reservations", {
    headers: { "X-Admin-Key": adminKey }
  });
  adminPanel.hidden = false;
  adminRecords = data.reservations;
  renderAdminStats(adminRecords);
  const filteredRecords = filterAdminRecords(adminRecords);
  renderAdmin(filteredRecords);
  await loadAdminReceiptPreviews(filteredRecords);
};

adminLogin?.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminKey = document.querySelector("#adminKey").value.trim();
  sessionStorage.setItem("sorteosAdminKey", adminKey);
  try {
    await loadAdmin();
  } catch (error) {
    adminRows.innerHTML = "";
    adminPanel.hidden = true;
    alert(error.message);
  }
});

refreshAdmin?.addEventListener("click", () => {
  loadAdmin().catch((error) => alert(error.message));
});

adminSearch?.addEventListener("input", () => {
  const filteredRecords = filterAdminRecords(adminRecords);
  renderAdmin(filteredRecords);
  loadAdminReceiptPreviews(filteredRecords).catch(() => {});
});

adminRows?.addEventListener("click", async (event) => {
  if (event.target.matches(".admin-delete-action")) {
    const id = event.target.dataset.id;
    const buyer = event.target.dataset.buyer || "este comprador";
    const shouldDelete = confirm(`Borrar ${buyer}? Esta accion elimina el apartado y libera sus boletos.`);
    if (!shouldDelete) return;

    try {
      await api(`/api/admin/reservations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "X-Admin-Key": adminKey }
      });
      await loadAdmin();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  if (!event.target.matches(".status-action")) return;
  const id = event.target.dataset.id;
  const newStatus = event.target.dataset.status;
  try {
    await api(`/api/admin/reservations/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "X-Admin-Key": adminKey },
      body: JSON.stringify({ status: newStatus })
    });
    await loadAdmin();
  } catch (error) {
    alert(error.message);
  }
});

const verifyParams = new URLSearchParams(window.location.search);
const phoneFromUrl = verifyParams.get("phone");
const ticketFromUrl = verifyParams.get("ticket");

const initializePage = async () => {
  siteConfig = await loadSiteConfig();
  applySiteConfig(siteConfig);
  renderTicketButtons();

  if (verifyPhone && (phoneFromUrl || ticketFromUrl)) {
    const verifyValue = phoneFromUrl || ticketFromUrl;
    verifyPhone.value = verifyValue;
    loadVerification(verifyValue).catch((error) => {
      verifyRows.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
    });
  }

  loadTicketAvailability();

  if (adminPanel && adminKey) {
    loadAdmin().catch(() => {
      adminPanel.hidden = true;
    });
  }
};

initializePage();

