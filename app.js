"use strict";

const SUPABASE_URL = "https://bdryvigzpuyljjxlbuni.supabase.co";
const SUPABASE_KEY = "sb_publishable_BeTVsGr20R1qTWGNze_Rfg_HK4lyVS9";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const URGENT_WINDOW_DAYS = 3;

const CATEGORIES = [
  { id: "bills",    label: "Bills",           completeLabel: "Mark paid", completeStatus: "paid", hasAmount: true,  hasRecurrence: true,  hasDueDate: true,  hasEndDate: false, hasNotes: false, dueDateLabel: "Due date" },
  { id: "house",    label: "House Projects",  completeLabel: "Mark done", completeStatus: "done",  hasAmount: false, hasRecurrence: false, hasDueDate: true,  hasEndDate: false, hasNotes: true,  dueDateLabel: "Target date" },
  { id: "tasks",    label: "Personal Tasks",  completeLabel: "Mark done", completeStatus: "done",  hasAmount: false, hasRecurrence: false, hasDueDate: true,  hasEndDate: false, hasNotes: true,  dueDateLabel: "Due date" },
  { id: "travel",   label: "Travel Plans",    completeLabel: "Mark done", completeStatus: "done",  hasAmount: false, hasRecurrence: false, hasDueDate: true,  hasEndDate: true,  hasNotes: true,  dueDateLabel: "Start date" },
  { id: "thoughts", label: "Random Thoughts", completeLabel: null,        completeStatus: null,    hasAmount: false, hasRecurrence: false, hasDueDate: false, hasEndDate: false, hasNotes: true,  dueDateLabel: "" },
];

function categoryConfig(id) { return CATEGORIES.find(c => c.id === id); }

let state = { items: [] };
let loading = true;
let bannerMsg = "";
let activeTab = CATEGORIES[0].id;
let modalState = null; // { mode: 'add'|'edit', draft: {...} }

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(n) {
  if (n == null || n === "") return "";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addMonths(iso, months) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function isUrgent(item) {
  if (item.status !== "active" || !item.due_date) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + URGENT_WINDOW_DAYS);
  return new Date(item.due_date + "T00:00:00") <= cutoff;
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
  const active = items.filter(i => i.status === "active").sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  });
  const finished = items.filter(i => i.status !== "active").sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
  return { active, finished };
}

async function handleComplete(item) {
  const cfg = categoryConfig(item.category);
  if (!cfg.completeStatus) return;
  const { error } = await db.from("items").update({ status: cfg.completeStatus, completed_at: new Date().toISOString() }).eq("id", item.id);
  if (error) { showError("Couldn't update that: " + error.message); return; }

  if (item.category === "bills" && item.recurrence === "monthly" && item.due_date) {
    const nextDue = addMonths(item.due_date, 1);
    const { error: insertErr } = await db.from("items").insert({
      category: "bills", title: item.title, amount: item.amount,
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

function openAddModal() {
  modalState = { mode: "add", draft: { category: activeTab, title: "", notes: "", amount: "", due_date: "", end_date: "", recurrence: "none" } };
  render();
}

function openEditModal(item) {
  modalState = { mode: "edit", draft: { ...item, amount: item.amount == null ? "" : item.amount, due_date: item.due_date || "", end_date: item.end_date || "" } };
  render();
}

function closeModal() {
  modalState = null;
  render();
}

async function submitModal(formValues) {
  const draft = modalState.draft;
  const cfg = categoryConfig(draft.category);
  const payload = {
    category: draft.category,
    title: formValues.title.trim(),
    notes: cfg.hasNotes ? (formValues.notes || "").trim() : null,
    amount: cfg.hasAmount && formValues.amount !== "" ? Number(formValues.amount) : null,
    due_date: cfg.hasDueDate && formValues.due_date ? formValues.due_date : null,
    end_date: cfg.hasEndDate && formValues.end_date ? formValues.end_date : null,
    recurrence: cfg.hasRecurrence ? formValues.recurrence : "none",
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
      <div class="brand">Homebase</div>
      <button class="add-btn" id="addBtn">+ Add</button>
    </div>
    ${bannerMsg ? `<div class="banner">${escapeHtml(bannerMsg)}</div>` : ""}
    <div class="tabs">${CATEGORIES.map(c => `<button class="tab ${c.id === activeTab ? "active" : ""}" data-tab="${c.id}">${c.label}</button>`).join("")}</div>
    <div id="listWrap"></div>
    <button class="fab" id="fab">+</button>
    <footer class="credit">homebase · just for you</footer>
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

  const { active, finished } = itemsForTab(activeTab);
  if (active.length === 0 && finished.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><h3>Nothing here yet</h3><p>Tap + Add to create your first one.</p></div>`;
    return;
  }

  let html = `<div class="list">${active.map(renderCard).join("")}</div>`;
  if (finished.length) {
    html += `<div class="section-label">Done</div><div class="list">${finished.map(renderCard).join("")}</div>`;
  }
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => openEditModal(findItem(btn.dataset.edit))));
  wrap.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => handleDelete(findItem(btn.dataset.delete))));
  wrap.querySelectorAll("[data-complete]").forEach(btn => btn.addEventListener("click", () => handleComplete(findItem(btn.dataset.complete))));
  wrap.querySelectorAll("[data-reopen]").forEach(btn => btn.addEventListener("click", () => handleReopen(findItem(btn.dataset.reopen))));
}

function findItem(id) { return state.items.find(i => i.id === id); }

function renderCard(item) {
  const cfg = categoryConfig(item.category);
  const urgent = isUrgent(item);
  const isDone = item.status !== "active";

  const badges = [];
  if (urgent) badges.push(`<span class="badge urgent">‼ urgent</span>`);
  if (isDone) badges.push(`<span class="badge done">${item.status === "paid" ? "paid" : "done"}</span>`);
  if (item.recurrence === "monthly") badges.push(`<span class="badge recurring">monthly</span>`);

  const metaBits = [];
  if (item.due_date) metaBits.push(`${cfg.dueDateLabel || "Due"}: ${formatDate(item.due_date)}`);
  if (item.end_date) metaBits.push(`through ${formatDate(item.end_date)}`);

  return `
    <div class="card ${isDone ? "done" : ""}">
      <div class="card-top">
        <div class="card-title-row">
          ${urgent ? `<span class="urgent-flag">‼️</span>` : ""}
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        ${item.amount != null ? `<span class="amount">${formatMoney(item.amount)}</span>` : ""}
      </div>
      ${badges.length ? `<div class="badges">${badges.join("")}</div>` : ""}
      ${metaBits.length ? `<div class="meta-row">${metaBits.join(" · ")}</div>` : ""}
      ${item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : ""}
      <div class="card-actions">
        ${!isDone && cfg.completeLabel ? `<button class="icon-btn complete" data-complete="${item.id}">${cfg.completeLabel}</button>` : ""}
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
          ${cfg.hasAmount ? `
          <div class="field">
            <label>Amount</label>
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
          ${cfg.hasRecurrence ? `
          <div class="field">
            <label>Repeats</label>
            <select id="f-recurrence">
              <option value="none" ${draft.recurrence === "none" ? "selected" : ""}>One-time</option>
              <option value="monthly" ${draft.recurrence === "monthly" ? "selected" : ""}>Monthly</option>
            </select>
          </div>` : ""}
          ${cfg.hasNotes ? `
          <div class="field">
            <label>Notes</label>
            <textarea id="f-notes" placeholder="any details">${escapeHtml(draft.notes || "")}</textarea>
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
  document.getElementById("modalSave").addEventListener("click", () => {
    const get = id => { const el = document.getElementById(id); return el ? el.value : ""; };
    submitModal({
      title: get("f-title"),
      amount: get("f-amount"),
      due_date: get("f-due"),
      end_date: get("f-end"),
      recurrence: get("f-recurrence") || "none",
      notes: get("f-notes"),
    });
  });
}

loadAll();
