const menuButton = document.querySelector(".nav-toggle");
const navMenu = document.querySelector("#navMenu");
const numberGrid = document.querySelector(".number-grid");
let ticketButtons = [];
const ticketCount = document.querySelector("#ticketCount");
const ticketForm = document.querySelector(".ticket-panel");
const formNote = document.querySelector("#formNote");
const verifyForm = document.querySelector("#verifyForm");
const verifyPhone = document.querySelector("#verifyPhone");
const verifyRows = document.querySelector("#verifyRows");
const verifySummary = document.querySelector("#verifySummary");
const adminLogin = document.querySelector("#adminLogin");
const adminPanel = document.querySelector("#adminPanel");
const adminRows = document.querySelector("#adminRows");
const adminCount = document.querySelector("#adminCount");
const refreshAdmin = document.querySelector("#refreshAdmin");
const adminSearch = document.querySelector("#adminSearch");
const adminStats = document.querySelector("#adminStats");

let adminKey = sessionStorage.getItem("sorteosAdminKey") || "";
let adminRecords = [];

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

  const siteName = site.nombre || "Sorteos Guerra";
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
  setText(".payment-grid article p:nth-of-type(2)", payment.clabe ? `CLABE: ${payment.clabe}` : "");
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
    <p>Esta pagina no funciona si la abres como archivo directo. Usa el acceso del Escritorio <b>Abrir Panel Sorteos Guerra.bat</b> o entra a:</p>
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

const selectedTickets = () => {
  return [...document.querySelectorAll(".number-grid button.is-selected")].map((button) => button.textContent.trim());
};

const updateTicketCount = () => {
  if (!ticketCount) return;
  const selected = selectedTickets().length;
  ticketCount.textContent = `${selected} seleccionado${selected === 1 ? "" : "s"}`;
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

const fileToDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el comprobante."));
    reader.readAsDataURL(file);
  });
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

const renderVerify = (records) => {
  const rows = records.flatMap((record) => {
    return record.ticketNumbers.map((ticket) => ({ ...record, ticket }));
  });

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
    verifyRows.innerHTML = `<tr><td colspan="8">No hay boletos registrados con ese celular.</td></tr>`;
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

const loadVerification = async (phone) => {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) {
    verifyRows.innerHTML = `<tr><td colspan="8">Escribe el celular registrado.</td></tr>`;
    return;
  }
  const data = await api(`/api/reservations?phone=${encodeURIComponent(cleanPhone)}`);
  renderVerify(data.reservations);
};

// Apartar boletos y guardar comprobante en la base de datos local.
ticketForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = selectedTickets();
  const form = new FormData(ticketForm);
  const receipt = form.get("comprobante");
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
  if (!receipt || !receipt.size) {
    formNote.textContent = "Sube una imagen del comprobante de pago.";
    return;
  }

  formNote.textContent = "Guardando apartado...";

  try {
    const receiptDataUrl = await fileToDataUrl(receipt);
    const data = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        prize: String(form.get("premio") || "Premio Principal"),
        ticketNumbers: selected,
        name,
        lastName,
        state,
        phone,
        receiptName: receipt.name,
        receiptDataUrl
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
  adminCount.textContent = `${records.length} comprador${records.length === 1 ? "" : "es"}`;
  if (!records.length) {
    adminRows.innerHTML = `<div class="empty-admin">Todavia no hay compradores registrados.</div>`;
    return;
  }

  adminRows.innerHTML = records.map((record, index) => {
    const status = safeStatus(record.status);
    const buyerNumber = escapeHtml(record.buyerNumber || index + 1);
    const tickets = (Array.isArray(record.ticketNumbers) ? record.ticketNumbers : []).map(escapeHtml).join(", ");
    const receiptUrl = safeUrl(record.receiptUrl);
    const receiptPreview = receiptUrl
      ? `<a class="receipt-preview" href="${escapeHtml(receiptUrl)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(receiptUrl)}" alt="Comprobante de pago del comprador ${buyerNumber}">
          <span>Ver comprobante completo</span>
        </a>`
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
      </div>
    </article>
  `;
  }).join("");
};

const loadAdmin = async () => {
  const data = await api("/api/admin/reservations", {
    headers: { "X-Admin-Key": adminKey }
  });
  adminPanel.hidden = false;
  adminRecords = data.reservations;
  renderAdminStats(adminRecords);
  renderAdmin(filterAdminRecords(adminRecords));
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
  renderAdmin(filterAdminRecords(adminRecords));
});

adminRows?.addEventListener("click", async (event) => {
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

const phoneFromUrl = new URLSearchParams(window.location.search).get("phone");

const initializePage = async () => {
  const config = await loadSiteConfig();
  applySiteConfig(config);
  renderTicketButtons();

  if (verifyPhone && phoneFromUrl) {
    verifyPhone.value = phoneFromUrl;
    loadVerification(phoneFromUrl).catch((error) => {
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
