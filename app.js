"use strict";

const SUPABASE_URL = "https://bdryvigzpuyljjxlbuni.supabase.co";
const SUPABASE_KEY = "sb_publishable_BeTVsGr20R1qTWGNze_Rfg_HK4lyVS9";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const URGENT_WINDOW_DAYS = 3;
const TRAVEL_STATUS_LABELS = { wishlist: "Wishlist", planned: "Planned", booked: "Booked", been: "Been there" };

const CATEGORIES = [
  {
    id: "bills", label: "Bills", completeLabel: "Mark paid", completeStatus: "paid",
    hasAmount: true, amountLabel: "Amount",
    hasDueDate: true, dueDateLabel: "Due date", hasEndDate: false,
    hasNotes: false, notesLabel: "Notes", hasLinks: false,
    priorityStyle: "segmented", isTravel: false,
    recurrenceOptions: [{ value: "none", label: "One-time" }, { value: "monthly", label: "Monthly" }],
  },
  {
    id: "house", label: "House Projects", completeLabel: "Mark done", completeStatus: "done",
    hasAmount: false, amountLabel: "Amount",
    hasDueDate: true, dueDateLabel: "Target date", hasEndDate: false,
    hasNotes: true, notesLabel: "Notes", hasLinks: true,
    priorityStyle: "segmented", isTravel: false,
    recurrenceOptions: null,
  },
  {
    id: "tasks", label: "Personal Tasks", completeLabel: "Mark done", completeStatus: "done",
    hasAmount: false, amountLabel: "Amount",
    hasDueDate: true, dueDateLabel: "Due date", hasEndDate: false,
    hasNotes: true, notesLabel: "Notes", hasLinks: false,
    priorityStyle: "segmented", isTravel: false,
    recurrenceOptions: [{ value: "none", label: "One-time" }, { value: "daily", label: "Daily routine" }, { value: "weekly", label: "Weekly routine" }],
  },
  {
    id: "travel", label: "Travel Plans", completeLabel: "Mark done", completeStatus: "done",
    hasAmount: true, amountLabel: "Budget",
    hasDueDate: true, dueDateLabel: "Start date", hasEndDate: true,
    hasNotes: true, notesLabel: "Activities", hasLinks: true,
    priorityStyle: "stars", isTravel: true,
    recurrenceOptions: null,
  },
  {
    id: "thoughts", label: "Random Thoughts", completeLabel: null, completeStatus: null,
    hasAmount: false, amountLabel: "Amount",
    hasDueDate: false, dueDateLabel: "", hasEndDate: false,
    hasNotes: true, notesLabel: "Notes", hasLinks: false,
    priorityStyle: null, isTravel: false,
    recurrenceOptions: null,
  },
];

function categoryConfig(id) { return CATEGORIES.find(c => c.id === id); }
function isRoutine(item) { return item.category === "tasks" && (item.recurrence === "daily" || item.recurrence === "weekly"); }

let state = { items: [] };
let loading = true;
let bannerMsg = "";
let activeTab = CATEGORIES[0].id;
let modalState = null; // { mode: 'add'|'edit', draft: {...} }
let expandedLinks = new Set();
let expandedDoneTabs = new Set();
const DONE_RECENT_DAYS = 7;

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(n) {
  if (n == null || n === "") return "";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso, months) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function isUrgent(item) {
  if (item.status !== "active" || isRoutine(item)) return false;
  if (item.manual_urgent) return true;
  if (!item.due_date) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + URGENT_WINDOW_DAYS);
  return new Date(item.due_date + "T00:00:00") <= cutoff;
}

function priorityWord(p) { return p >= 5 ? "High" : p <= 1 ? "Low" : "Medium"; }

function daysSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function splitFinished(finished) {
  // Keep every completed item in the database -- just hide anything older
  // than a week behind "show more" so the Done list doesn't grow forever.
  return {
    recent: finished.filter(i => daysSince(i.completed_at) <= DONE_RECENT_DAYS),
    older: finished.filter(i => daysSince(i.completed_at) > DONE_RECENT_DAYS),
  };
}

function dateCompare(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortActive(items) {
  // Priority comes first everywhere: a High item sits above Medium/Low
  // regardless of due date. Due date only breaks ties within the same priority.
  return items.slice().sort((a, b) => (b.priority - a.priority) || dateCompare(a.due_date, b.due_date));
}

function showError(msg) {
  bannerMsg = msg;
  render();
}

async function loadAll() {
  loading = true;
  render();
  const { data, error } = await db.from("items").select("*").order("created_at", { ascending: true });
  loading = false;
  if (error) {
    showError("Couldn't load your data: " + error.message);
    return;
  }
  state.items = data || [];
  bannerMsg = "";
  render();
}

function itemsForTab(tabId) {
  const items = state.items.filter(i => i.category === tabId);
  if (tabId === "tasks") {
    const routines = sortActive(items.filter(i => isRoutine(i) && i.status === "active"));
    const nonRoutine = items.filter(i => !isRoutine(i));
    const active = sortActive(nonRoutine.filter(i => i.status === "active"));
    const finished = nonRoutine.filter(i => i.status !== "active").sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
    return { routines, active, ...splitFinished(finished) };
  }
  const active = sortActive(items.filter(i => i.status === "active"));
  const finished = items.filter(i => i.status !== "active").sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
  return { routines: [], active, ...splitFinished(finished) };
}

function completeLabelFor(item) {
  if (item.category === "tasks" && item.recurrence === "daily") return "Done for today";
  if (item.category === "tasks" && item.recurrence === "weekly") return "Done for the week";
  return categoryConfig(item.category).completeLabel;
}

async function handleComplete(item) {
  if (isRoutine(item)) {
    const days = item.recurrence === "daily" ? 1 : 7;
    const nextDue = addDays(item.due_date || todayISO(), days);
    const { error } = await db.from("items").update({ due_date: nextDue, completed_at: new Date().toISOString() }).eq("id", item.id);
    if (error) showError("Couldn't update that: " + error.message);
    await loadAll();
    return;
  }

  const cfg = categoryConfig(item.category);
  if (!cfg.completeStatus) return;
  const { error } = await db.from("items").update({ status: cfg.completeStatus, completed_at: new Date().toISOString() }).eq("id", item.id);
  if (error) { showError("Couldn't update that: " + error.message); return; }

  if (item.category === "bills" && item.recurrence === "monthly" && item.due_date) {
    const nextDue = addMonths(item.due_date, 1);
    const { error: insertErr } = await db.from("items").insert({
      category: "bills", title: item.title, amount: item.amount, priority: item.priority,
      due_date: nextDue, recurrence: "monthly", status: "active",
    });
    if (insertErr) showError("Marked paid, but couldn't create next month's bill: " + insertErr.message);
  }
  await loadAll();
}

async function handleReopen(item) {
  const { error } = await db.from("items").update({ status: "active", completed_at: null }).eq("id", item.id);
  if (error) { showError("Couldn't update that: " + error.message); return; }
  await loadAll();
}

async function handleDelete(item) {
  if (!confirm(`Delete "${item.title}"?`)) return;
  const { error } = await db.from("items").delete().eq("id", item.id);
  if (error) { showError("Couldn't delete that: " + error.message); return; }
  await loadAll();
}

async function toggleLetsDo(item) {
  const { error } = await db.from("items").update({ lets_do_this: !item.lets_do_this }).eq("id", item.id);
  if (error) { showError("Couldn't update that: " + error.message); return; }
  await loadAll();
}

function openAddModal() {
  modalState = {
    mode: "add",
    draft: {
      category: activeTab, title: "", notes: "", amount: "", due_date: "", end_date: "",
      recurrence: "none", priority: 3, links: [], region: "US", city: "",
      travel_status: "wishlist", lets_do_this: false, manual_urgent: false,
    },
  };
  render();
}

function openEditModal(item) {
  modalState = { mode: "edit", draft: { ...item, amount: item.amount == null ? "" : item.amount, due_date: item.due_date || "", end_date: item.end_date || "", links: [...(item.links || [])] } };
  render();
}

function closeModal() {
  modalState = null;
  render();
}

// Every modal input is uncontrolled (its value lives only in the DOM until
// read). Any button that re-renders the modal for a reason OTHER than
// saving (priority, region, stars, add/remove link) must capture whatever
// is currently typed into the plain fields first, or the rebuild wipes it.
function syncDraftFromDom() {
  const d = modalState.draft;
  const field = id => document.getElementById(id);

  const title = field("f-title"); if (title) d.title = title.value;
  const amount = field("f-amount"); if (amount) d.amount = amount.value;
  const due = field("f-due"); if (due) d.due_date = due.value;
  const end = field("f-end"); if (end) d.end_date = end.value;
  const recurrence = field("f-recurrence"); if (recurrence) d.recurrence = recurrence.value;
  const notes = field("f-notes"); if (notes) d.notes = notes.value;
  const city = field("f-city"); if (city) d.city = city.value;
  const travelStatus = field("f-travel-status"); if (travelStatus) d.travel_status = travelStatus.value;
  const letsdo = field("f-letsdo"); if (letsdo) d.lets_do_this = letsdo.checked;
  const manualUrgent = field("f-manual-urgent"); if (manualUrgent) d.manual_urgent = manualUrgent.checked;

  d.links = Array.from(document.querySelectorAll(".link-row")).map(row => ({
    label: row.querySelector(".link-label").value,
    url: row.querySelector(".link-url").value,
  })).filter(l => l.label || l.url);
}

function addLinkRow() {
  syncDraftFromDom();
  modalState.draft.links.push({ label: "", url: "" });
  render();
}
function removeLinkRow(idx) {
  syncDraftFromDom();
  modalState.draft.links.splice(idx, 1);
  render();
}

async function submitModal(formValues) {
  const draft = modalState.draft;
  const cfg = categoryConfig(draft.category);
  syncDraftFromDom();
  const payload = {
    category: draft.category,
    title: formValues.title.trim(),
    notes: cfg.hasNotes ? (formValues.notes || "").trim() : null,
    amount: cfg.hasAmount && formValues.amount !== "" ? Number(formValues.amount) : null,
    due_date: cfg.hasDueDate && formValues.due_date ? formValues.due_date : null,
    end_date: cfg.hasEndDate && formValues.end_date ? formValues.end_date : null,
    recurrence: cfg.recurrenceOptions ? formValues.recurrence : "none",
    priority: cfg.priorityStyle ? Number(formValues.priority) : 3,
    links: cfg.hasLinks ? modalState.draft.links.filter(l => l.label || l.url) : [],
    region: cfg.isTravel ? formValues.region : null,
    city: cfg.isTravel ? (formValues.city || "").trim() : null,
    travel_status: cfg.isTravel ? formValues.travel_status : null,
    lets_do_this: cfg.isTravel ? !!draft.lets_do_this : false,
    manual_urgent: cfg.priorityStyle === "segmented" ? !!draft.manual_urgent : false,
  };
  if (!payload.title) { showError("Give it a title first."); return; }

  if (modalState.mode === "add") {
    const { error } = await db.from("items").insert(payload);
    if (error) { showError("Couldn't save that: " + error.message); return; }
  } else {
    const { error } = await db.from("items").update(payload).eq("id", draft.id);
    if (error) { showError("Couldn't save that: " + error.message); return; }
  }
  closeModal();
  await loadAll();
}

// ---------- rendering ----------

function render() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">Calm Mind App</div>
      <button class="add-btn" id="addBtn">+ Add</button>
    </div>
    ${bannerMsg ? `<div class="banner">${escapeHtml(bannerMsg)}</div>` : ""}
    <div class="tabs">${CATEGORIES.map(c => `<button class="tab ${c.id === activeTab ? "active" : ""}" data-tab="${c.id}">${c.label}</button>`).join("")}</div>
    <div id="listWrap"></div>
    <button class="fab" id="fab">+</button>
    <footer class="credit">Dasha's Daily Organizer</footer>
    ${modalState ? renderModal() : ""}
  `;

  renderList();

  document.getElementById("addBtn").addEventListener("click", openAddModal);
  document.getElementById("fab").addEventListener("click", openAddModal);
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => { activeTab = btn.dataset.tab; render(); });
  });

  if (modalState) wireModal();
}

function renderList() {
  const wrap = document.getElementById("listWrap");
  if (loading) { wrap.innerHTML = `<div class="empty-state">loading…</div>`; return; }

  const { routines, active, recent, older } = itemsForTab(activeTab);
  if (routines.length === 0 && active.length === 0 && recent.length === 0 && older.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><h3>Nothing here yet</h3><p>Tap + Add to create your first one.</p></div>`;
    return;
  }

  const doneExpanded = expandedDoneTabs.has(activeTab);

  let html = "";
  if (routines.length) {
    html += `<div class="section-label">Routines</div><div class="list">${routines.map(renderCard).join("")}</div>`;
    html += `<div class="section-label">To-dos</div>`;
  }
  html += `<div class="list">${active.map(renderCard).join("")}</div>`;
  if (recent.length || older.length) {
    html += `<div class="section-label">Done</div><div class="list">${recent.map(renderCard).join("")}</div>`;
    if (older.length) {
      html += doneExpanded
        ? `<div class="list">${older.map(renderCard).join("")}</div><button class="show-more-btn" id="doneToggle">Show less</button>`
        : `<button class="show-more-btn" id="doneToggle">Show ${older.length} older done item${older.length === 1 ? "" : "s"}</button>`;
    }
  }
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => openEditModal(findItem(btn.dataset.edit))));
  wrap.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => handleDelete(findItem(btn.dataset.delete))));
  wrap.querySelectorAll("[data-complete]").forEach(btn => btn.addEventListener("click", () => handleComplete(findItem(btn.dataset.complete))));
  wrap.querySelectorAll("[data-reopen]").forEach(btn => btn.addEventListener("click", () => handleReopen(findItem(btn.dataset.reopen))));
  wrap.querySelectorAll("[data-letsdo]").forEach(btn => btn.addEventListener("click", () => toggleLetsDo(findItem(btn.dataset.letsdo))));
  wrap.querySelectorAll("[data-linktoggle]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.linktoggle;
    expandedLinks.has(id) ? expandedLinks.delete(id) : expandedLinks.add(id);
    render();
  }));
  const doneToggle = document.getElementById("doneToggle");
  if (doneToggle) doneToggle.addEventListener("click", () => {
    expandedDoneTabs.has(activeTab) ? expandedDoneTabs.delete(activeTab) : expandedDoneTabs.add(activeTab);
    render();
  });
}

function findItem(id) { return state.items.find(i => i.id === id); }

function renderStars(priority) {
  let out = "";
  for (let i = 1; i <= 5; i++) out += `<span class="star ${i <= priority ? "on" : ""}">★</span>`;
  return `<div class="stars">${out}</div>`;
}

function renderLinks(item) {
  if (!item.links || !item.links.length) return "";
  const expanded = expandedLinks.has(item.id);
  const shown = expanded ? item.links : item.links.slice(0, 3);
  const linkHtml = shown.map(l => `<a class="link-pill" href="${escapeAttr(l.url || "#")}" target="_blank" rel="noopener">${escapeHtml(l.label || l.url)}</a>`).join("");
  const more = item.links.length > 3
    ? `<button class="link-more" data-linktoggle="${item.id}">${expanded ? "Show less" : `+${item.links.length - 3} more`}</button>`
    : "";
  return `<div class="links-row">${linkHtml}${more}</div>`;
}

function renderCard(item) {
  const cfg = categoryConfig(item.category);
  const urgent = isUrgent(item);
  const isDone = item.status !== "active" && !isRoutine(item);
  const routine = isRoutine(item);

  const badges = [];
  if (urgent) badges.push(`<span class="badge urgent">‼ urgent</span>`);
  if (isDone) badges.push(`<span class="badge done">${item.status === "paid" ? "paid" : "done"}</span>`);
  if (item.recurrence === "monthly") badges.push(`<span class="badge recurring">monthly</span>`);
  if (routine) badges.push(`<span class="badge recurring">${item.recurrence}</span>`);
  if (cfg.priorityStyle === "segmented") badges.push(`<span class="badge priority-${priorityWord(item.priority).toLowerCase()}">${priorityWord(item.priority)} priority</span>`);
  if (cfg.isTravel && item.travel_status) badges.push(`<span class="badge status-${item.travel_status}">${TRAVEL_STATUS_LABELS[item.travel_status]}</span>`);

  const metaBits = [];
  if (cfg.isTravel) {
    const place = [item.city, item.region].filter(Boolean).join(", ");
    if (place) metaBits.push(place);
  }
  if (item.due_date) metaBits.push(`${cfg.dueDateLabel || "Due"}: ${formatDate(item.due_date)}`);
  if (item.end_date) metaBits.push(`through ${formatDate(item.end_date)}`);

  return `
    <div class="card ${isDone ? "done" : ""}">
      <div class="card-top">
        <div class="card-title-row">
          ${urgent ? `<span class="urgent-flag">‼️</span>` : ""}
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        ${cfg.isTravel
          ? `<button class="pin-toggle ${item.lets_do_this ? "active" : ""}" data-letsdo="${item.id}" title="Let's do this">★</button>`
          : (item.amount != null ? `<span class="amount">${formatMoney(item.amount)}</span>` : "")}
      </div>
      ${cfg.priorityStyle === "stars" ? renderStars(item.priority) : ""}
      ${badges.length ? `<div class="badges">${badges.join("")}</div>` : ""}
      ${metaBits.length ? `<div class="meta-row">${metaBits.join(" · ")}</div>` : ""}
      ${cfg.isTravel && item.amount != null ? `<div class="meta-row">Budget: ${formatMoney(item.amount)}</div>` : ""}
      ${item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : ""}
      ${cfg.hasLinks ? renderLinks(item) : ""}
      <div class="card-actions">
        ${!isDone && cfg.completeLabel ? `<button class="icon-btn complete" data-complete="${item.id}">${completeLabelFor(item)}</button>` : ""}
        ${isDone && cfg.completeLabel ? `<button class="icon-btn" data-reopen="${item.id}">Reopen</button>` : ""}
        <button class="icon-btn" data-edit="${item.id}">Edit</button>
        <button class="icon-btn danger" data-delete="${item.id}">Delete</button>
      </div>
    </div>
  `;
}

function renderModal() {
  const draft = modalState.draft;
  const cfg = categoryConfig(draft.category);
  return `
    <div class="overlay" id="overlay">
      <div class="modal">
        <div class="modal-head">
          <h2>${modalState.mode === "add" ? "New" : "Edit"} ${cfg.label.replace(/s$/, "")}</h2>
          <button class="modal-close" id="modalClose">&times;</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Title</label>
            <input type="text" id="f-title" value="${escapeHtml(draft.title || "")}" placeholder="e.g. ${placeholderFor(draft.category)}">
          </div>

          ${cfg.isTravel ? `
          <div class="field">
            <label>Region</label>
            <div class="region-toggle">
              <button type="button" class="region-btn ${draft.region === "US" ? "active" : ""}" data-region="US">US</button>
              <button type="button" class="region-btn ${draft.region === "International" ? "active" : ""}" data-region="International">International</button>
            </div>
          </div>
          <div class="row2">
            <div class="field"><label>City</label><input type="text" id="f-city" value="${escapeHtml(draft.city || "")}" placeholder="e.g. Austin"></div>
            <div class="field">
              <label>Status</label>
              <select id="f-travel-status">
                ${Object.entries(TRAVEL_STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${draft.travel_status === v ? "selected" : ""}>${l}</option>`).join("")}
              </select>
            </div>
          </div>` : ""}

          ${cfg.hasAmount ? `
          <div class="field">
            <label>${cfg.amountLabel}</label>
            <input type="number" step="0.01" id="f-amount" value="${draft.amount || ""}" placeholder="0.00">
          </div>` : ""}

          <div class="row2">
            ${cfg.hasDueDate ? `
            <div class="field">
              <label>${cfg.dueDateLabel}</label>
              <input type="date" id="f-due" value="${draft.due_date || ""}">
            </div>` : ""}
            ${cfg.hasEndDate ? `
            <div class="field">
              <label>End date</label>
              <input type="date" id="f-end" value="${draft.end_date || ""}">
            </div>` : ""}
          </div>

          ${cfg.recurrenceOptions ? `
          <div class="field">
            <label>Repeats</label>
            <select id="f-recurrence">
              ${cfg.recurrenceOptions.map(o => `<option value="${o.value}" ${draft.recurrence === o.value ? "selected" : ""}>${o.label}</option>`).join("")}
            </select>
          </div>` : ""}

          ${cfg.priorityStyle === "segmented" ? `
          <div class="field">
            <label>Priority</label>
            <div class="region-toggle">
              <button type="button" class="priority-btn ${draft.priority === 1 ? "active" : ""}" data-priority="1">Low</button>
              <button type="button" class="priority-btn ${draft.priority === 3 ? "active" : ""}" data-priority="3">Medium</button>
              <button type="button" class="priority-btn ${draft.priority === 5 ? "active" : ""}" data-priority="5">High</button>
            </div>
          </div>` : ""}
          ${cfg.priorityStyle === "stars" ? `
          <div class="field">
            <label>Priority</label>
            <div class="star-picker">
              ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star-pick ${n <= draft.priority ? "on" : ""}" data-star="${n}">★</button>`).join("")}
            </div>
          </div>` : ""}

          ${cfg.isTravel ? `
          <div class="field checkbox-field">
            <label><input type="checkbox" id="f-letsdo" ${draft.lets_do_this ? "checked" : ""}> Let's do this!</label>
          </div>` : ""}

          ${cfg.priorityStyle === "segmented" ? `
          <div class="field checkbox-field">
            <label><input type="checkbox" id="f-manual-urgent" ${draft.manual_urgent ? "checked" : ""}> Mark as urgent</label>
          </div>` : ""}

          ${cfg.hasNotes ? `
          <div class="field">
            <label>${cfg.notesLabel}</label>
            <textarea id="f-notes" placeholder="any details">${escapeHtml(draft.notes || "")}</textarea>
          </div>` : ""}

          ${cfg.hasLinks ? `
          <div class="field">
            <label>Links</label>
            <div class="link-rows">
              ${(draft.links || []).map((l, i) => `
                <div class="link-row">
                  <input type="text" class="link-label" placeholder="label" value="${escapeAttr(l.label || "")}">
                  <input type="url" class="link-url" placeholder="https://…" value="${escapeAttr(l.url || "")}">
                  <button type="button" class="link-remove" data-removelink="${i}">&times;</button>
                </div>`).join("")}
            </div>
            <button type="button" class="add-link-btn" id="addLinkBtn">+ Add link</button>
          </div>` : ""}

          <div class="modal-footer">
            <button class="btn-ghost" id="modalCancel">Cancel</button>
            <button class="btn-primary" id="modalSave">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function placeholderFor(category) {
  return { bills: "Electric bill", house: "Fix the fence", tasks: "Call the dentist", travel: "Trip to Austin", thoughts: "Idea for the guest room" }[category] || "";
}

function wireModal() {
  const close = () => closeModal();
  document.getElementById("overlay").addEventListener("click", e => { if (e.target.id === "overlay") close(); });
  document.getElementById("modalClose").addEventListener("click", close);
  document.getElementById("modalCancel").addEventListener("click", close);

  document.querySelectorAll(".region-btn").forEach(btn => btn.addEventListener("click", () => { syncDraftFromDom(); modalState.draft.region = btn.dataset.region; render(); }));
  document.querySelectorAll(".priority-btn").forEach(btn => btn.addEventListener("click", () => { syncDraftFromDom(); modalState.draft.priority = Number(btn.dataset.priority); render(); }));
  document.querySelectorAll(".star-pick").forEach(btn => btn.addEventListener("click", () => { syncDraftFromDom(); modalState.draft.priority = Number(btn.dataset.star); render(); }));
  const addLinkBtn = document.getElementById("addLinkBtn");
  if (addLinkBtn) addLinkBtn.addEventListener("click", addLinkRow);
  document.querySelectorAll("[data-removelink]").forEach(btn => btn.addEventListener("click", () => removeLinkRow(Number(btn.dataset.removelink))));

  document.getElementById("modalSave").addEventListener("click", () => {
    const get = id => { const el = document.getElementById(id); return el ? el.value : ""; };
    const letsdoEl = document.getElementById("f-letsdo");
    if (letsdoEl) modalState.draft.lets_do_this = letsdoEl.checked;
    submitModal({
      title: get("f-title"),
      amount: get("f-amount"),
      due_date: get("f-due"),
      end_date: get("f-end"),
      recurrence: get("f-recurrence") || "none",
      notes: get("f-notes"),
      priority: modalState.draft.priority,
      region: modalState.draft.region,
      city: get("f-city"),
      travel_status: get("f-travel-status") || "wishlist",
    });
  });
}

loadAll();
