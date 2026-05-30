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

const renderTicketButtons = () => {
  if (!numberGrid) return;
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
};

renderTicketButtons();

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
  const selected = selectedTickets().length;
  ticketCount.textContent = `${selected} seleccionado${selected === 1 ? "" : "s"}`;
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
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
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

// Seleccion de boletos. Los numeros se cambian en boletos.html, dentro de .number-grid.
ticketButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    button.classList.toggle("is-selected");
    updateTicketCount();
  });
});

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
      <td class="ticket-cell">${row.ticket}</td>
      <td>${row.ticketNumbers.join(", ")}</td>
      <td>${row.name}</td>
      <td>${row.lastName}</td>
      <td>${row.state}</td>
      <td>${formatDate(row.sentAt)}</td>
      <td>${formatDate(row.createdAt)}</td>
      <td class="status-cell status-${row.status}">${statusLabel(row.status)}</td>
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
    verifyRows.innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
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

  adminRows.innerHTML = records.map((record, index) => `
    <article class="buyer-card status-border-${record.status}">
      <header class="buyer-card__header">
        <div>
          <span>Comprador ${record.buyerNumber || index + 1}</span>
          <strong>${record.name} ${record.lastName}</strong>
        </div>
        <em class="status-pill status-${record.status}">${statusLabel(record.status)}</em>
      </header>

      <div class="buyer-card__body">
        <div class="buyer-details">
          <p><strong>Boletos:</strong> ${record.ticketNumbers.join(", ")}</p>
          <p><strong>Celular:</strong> ${record.phone}</p>
          <p><strong>Estado:</strong> ${record.state}</p>
          <p><strong>Premio:</strong> ${record.prize}</p>
          <p><strong>Apartado:</strong> ${formatDate(record.createdAt)}</p>
          <p><strong>Actualizado:</strong> ${formatDate(record.statusUpdatedAt)}</p>
        </div>

        <a class="receipt-preview" href="${record.receiptUrl}" target="_blank" rel="noreferrer">
          <img src="${record.receiptUrl}" alt="Comprobante de pago del comprador ${record.buyerNumber || index + 1}">
          <span>Ver comprobante completo</span>
        </a>
      </div>

      <div class="buyer-actions">
        <button class="status-action status-action--paid" type="button" data-id="${record.id}" data-status="pagado">Pagado</button>
        <button class="status-action" type="button" data-id="${record.id}" data-status="en_revision">En revision</button>
        <button class="status-action" type="button" data-id="${record.id}" data-status="pendiente">Pendiente</button>
        <button class="status-action status-action--cancel" type="button" data-id="${record.id}" data-status="cancelado">Cancelar</button>
      </div>
    </article>
  `).join("");
};

const loadAdmin = async () => {
  const data = await api(`/api/admin/reservations?key=${encodeURIComponent(adminKey)}`);
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
    await api(`/api/admin/reservations/${id}/status?key=${encodeURIComponent(adminKey)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus })
    });
    await loadAdmin();
  } catch (error) {
    alert(error.message);
  }
});

const phoneFromUrl = new URLSearchParams(window.location.search).get("phone");
if (verifyPhone && phoneFromUrl) {
  verifyPhone.value = phoneFromUrl;
  loadVerification(phoneFromUrl).catch((error) => {
    verifyRows.innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
  });
}

loadTicketAvailability();

if (adminPanel && adminKey) {
  loadAdmin().catch(() => {
    adminPanel.hidden = true;
  });
}
