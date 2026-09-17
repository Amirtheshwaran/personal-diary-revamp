(() => {
  "use strict";

  const state = {
    token: null,
    screen: "boot",
    previousMenuScreen: "menu",
    dates: [],
    selectedDate: null,
    entries: [],
    detailEntry: null,
    menuFocusIndex: 0,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const screens = $$(".screen");
  const wipeEl = $("#wipe");
  const toastEl = $("#toast");
  const menuItems = $$(".menu-item");

  // ---------------------------------------------------------------- utils
  function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (state.token) headers["X-Diary-Token"] = state.token;
    return fetch(path, Object.assign({}, opts, { headers }))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(data.error || "request_failed");
          err.data = data;
          err.status = res.status;
          throw err;
        }
        return data;
      });
  }

  function attachRipple(el) {
    el.addEventListener("click", (e) => {
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";
      el.appendChild(ripple);
      const anim = ripple.animate(
        [
          { transform: "scale(0)", opacity: 0.45 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
      anim.onfinish = () => ripple.remove();
    });
  }

  function playEntering(el, index) {
    el.style.setProperty("--i", index);
    el.classList.add("is-entering");
    el.addEventListener(
      "animationend",
      () => el.classList.remove("is-entering"),
      { once: true }
    );
  }

  function startParallax() {
    const bgMotif = $(".bg-motif");
    if (!bgMotif) return;
    let targetX = 0, targetY = 0, curX = 0, curY = 0;
    document.addEventListener("mousemove", (e) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 34;
      targetY = (e.clientY / window.innerHeight - 0.5) * 20;
    });
    function tick() {
      curX += (targetX - curX) * 0.06;
      curY += (targetY - curY) * 0.06;
      bgMotif.style.setProperty("--px", curX.toFixed(2) + "px");
      bgMotif.style.setProperty("--py", curY.toFixed(2) + "px");
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("is-visible"), 2400);
  }

  function formatDateHeading(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function formatDateShort(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------- screen routing
  function goToScreen(name, { wipe = true } = {}) {
    const doSwitch = () => {
      screens.forEach((s) => {
        const isTarget = s.dataset.screen === name;
        s.classList.toggle("is-active", isTarget);
      });
      state.screen = name;
      onScreenEnter(name);
    };

    if (wipe) {
      wipeEl.classList.remove("playing");
      // force reflow to restart animation
      void wipeEl.offsetWidth;
      wipeEl.classList.add("playing");
      setTimeout(doSwitch, 250);
      setTimeout(() => wipeEl.classList.remove("playing"), 650);
    } else {
      doSwitch();
    }
  }

  function onScreenEnter(name) {
    if (name === "menu") {
      $("#menu-date").textContent = formatDateHeading(todayISO());
      state.menuFocusIndex = 0;
      focusMenuItem(0);
    }
    if (name === "new-entry") {
      $("#entry-date").value = todayISO();
      const now = new Date();
      $("#entry-time").value = now.toTimeString().slice(0, 5);
      $("#entry-status").textContent = "";
      $("#entry-status").classList.remove("is-error");
      $("#entry-title").focus();
    }
    if (name === "journal") {
      loadDates();
    }
    if (name === "settings") {
      $("#settings-old").value = "";
      $("#settings-new").value = "";
      $("#settings-confirm").value = "";
      $("#settings-status").textContent = "";
      $("#settings-status").classList.remove("is-error");
    }
    if (name === "lock") {
      lockApp();
    }
  }

  // ---------------------------------------------------------------- boot + auth
  async function boot() {
    goToScreen("boot", { wipe: false });
    const status = await api("/api/status").catch(() => ({ password_set: false }));

    setTimeout(() => {
      if (!status.password_set) {
        showAuthScreen({ mode: "set" });
      } else {
        showAuthScreen({ mode: "login" });
      }
    }, 1650);
  }

  function showAuthScreen({ mode }) {
    const eyebrow = $("#auth-eyebrow");
    const title = $("#auth-title");
    const confirmWrap = $("#auth-confirm-wrap");
    const submit = $("#auth-submit");
    const error = $("#auth-error");
    error.textContent = "";
    $("#auth-password").value = "";
    $("#auth-confirm").value = "";

    if (mode === "set") {
      eyebrow.textContent = "SET YOUR PASSWORD";
      title.textContent = "First Time Setup";
      confirmWrap.hidden = false;
      submit.textContent = "CREATE";
    } else {
      eyebrow.textContent = "ENTER PASSWORD";
      title.textContent = "Welcome Back";
      confirmWrap.hidden = true;
      submit.textContent = "UNLOCK";
    }
    $("#auth-form").dataset.mode = mode;
    goToScreen("auth");
    setTimeout(() => $("#auth-password").focus(), 350);
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const mode = $("#auth-form").dataset.mode;
    const password = $("#auth-password").value;
    const error = $("#auth-error");
    error.textContent = "";

    if (mode === "set") {
      const confirm = $("#auth-confirm").value;
      if (!password) {
        error.textContent = "Password can't be empty.";
        return;
      }
      if (password !== confirm) {
        error.textContent = "Passwords don't match.";
        return;
      }
      try {
        const res = await api("/api/set-initial-password", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        state.token = res.token;
        goToScreen("menu");
      } catch (err) {
        error.textContent = "Something went wrong. Try again.";
      }
      return;
    }

    try {
      const res = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      state.token = res.token;
      goToScreen("menu");
    } catch (err) {
      error.textContent = "Wrong password. Try again.";
      $("#auth-password").value = "";
      $("#auth-password").focus();
      const box = $(".auth-box");
      box.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-10px)" },
          { transform: "translateX(10px)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 320, easing: "ease-in-out" }
      );
    }
  }

  function lockApp() {
    state.token = null;
    api("/api/lock", { method: "POST" }).catch(() => {});
    api("/api/status").then((status) => {
      showAuthScreen({ mode: status.password_set ? "login" : "set" });
    });
  }

  // ---------------------------------------------------------------- menu nav
  function focusMenuItem(index) {
    menuItems.forEach((el, i) => el.classList.toggle("is-focused", i === index));
  }

  function handleMenuKeydown(e) {
    if (state.screen !== "menu") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.menuFocusIndex = (state.menuFocusIndex + 1) % menuItems.length;
      focusMenuItem(state.menuFocusIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.menuFocusIndex = (state.menuFocusIndex - 1 + menuItems.length) % menuItems.length;
      focusMenuItem(state.menuFocusIndex);
    } else if (e.key === "Enter") {
      const target = menuItems[state.menuFocusIndex]?.dataset.target;
      if (target) goToScreen(target);
    }
  }

  function handleGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (["new-entry", "journal", "settings"].includes(state.screen)) {
        goToScreen("menu");
      }
    }
  }

  // ---------------------------------------------------------------- new entry
  async function handleEntrySubmit(e) {
    e.preventDefault();
    const status = $("#entry-status");
    status.classList.remove("is-error");
    const payload = {
      date: $("#entry-date").value,
      time: $("#entry-time").value,
      title: $("#entry-title").value,
      place: $("#entry-place").value,
      duration: $("#entry-duration").value,
      note: $("#entry-note").value,
    };
    if (!payload.date || !payload.time) {
      status.textContent = "Date and time are required.";
      status.classList.add("is-error");
      return;
    }
    try {
      await api("/api/entries", { method: "POST", body: JSON.stringify(payload) });
      status.textContent = "Saved to the record.";
      showToast("Entry added");
      $("#entry-title").value = "";
      $("#entry-place").value = "";
      $("#entry-duration").value = "";
      $("#entry-note").value = "";
    } catch (err) {
      status.textContent = "Could not save. Try again.";
      status.classList.add("is-error");
    }
  }

  // ---------------------------------------------------------------- journal
  async function loadDates() {
    try {
      const res = await api("/api/dates");
      state.dates = res.dates;
      renderDateList();
      if (state.dates.length && !state.selectedDate) {
        selectDate(state.dates[0]);
      } else if (state.selectedDate) {
        selectDate(state.selectedDate);
      } else {
        $("#journal-selected-date").textContent = "NO ENTRIES YET";
        $("#journal-entry-list").innerHTML = "";
      }
    } catch (err) {
      showToast("Could not load journal");
    }
  }

  function renderDateList() {
    const list = $("#journal-date-list");
    list.innerHTML = "";
    if (!state.dates.length) {
      const p = document.createElement("p");
      p.className = "journal-date-empty";
      p.textContent = "Nothing recorded yet.";
      list.appendChild(p);
      return;
    }
    state.dates.forEach((date, index) => {
      const btn = document.createElement("button");
      btn.className = "journal-date-item" + (date === state.selectedDate ? " is-active" : "");
      btn.textContent = formatDateShort(date);
      btn.addEventListener("click", () => selectDate(date));
      list.appendChild(btn);
      playEntering(btn, index);
    });
  }

  async function selectDate(date) {
    state.selectedDate = date;
    renderDateList();
    $("#journal-selected-date").textContent = formatDateHeading(date).toUpperCase();
    try {
      const res = await api("/api/entries?date=" + encodeURIComponent(date));
      state.entries = res.entries;
      renderEntryList();
    } catch (err) {
      showToast("Could not load entries");
    }
  }

  function renderEntryList() {
    const list = $("#journal-entry-list");
    list.innerHTML = "";
    if (!state.entries.length) {
      const p = document.createElement("p");
      p.className = "journal-date-empty";
      p.textContent = "No entries for this date.";
      list.appendChild(p);
      return;
    }
    state.entries.forEach((entry, index) => {
      const card = document.createElement("div");
      card.className = "journal-entry-card";
      card.innerHTML = `
        <div class="journal-entry-card__time">${escapeHtml(entry.time)}</div>
        <div class="journal-entry-card__body">
          <p class="journal-entry-card__title">${escapeHtml(entry.title || "Untitled entry")}</p>
          <p class="journal-entry-card__meta">${escapeHtml(entry.place || "")}${entry.duration ? " · " + escapeHtml(entry.duration) : ""}</p>
        </div>
      `;
      card.addEventListener("click", () => openEntryDetail(entry));
      list.appendChild(card);
      playEntering(card, index);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function openEntryDetail(entry) {
    state.detailEntry = entry;
    renderDetailView(entry);
    $("#entry-detail-view").hidden = false;
    $("#entry-detail-edit-form").hidden = true;
    $("#entry-detail-actions").hidden = false;
    $("#entry-detail").hidden = false;
  }

  function renderDetailView(entry) {
    $("#entry-detail-view").innerHTML = `
      <h3 class="detail-title">${escapeHtml(entry.title || "Untitled entry")}</h3>
      <div class="detail-row">
        <span class="detail-row__label">TIME</span>
        <span class="detail-row__value">${escapeHtml(entry.time)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row__label">PLACE</span>
        <span class="detail-row__value">${escapeHtml(entry.place || "-")}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row__label">DURATION</span>
        <span class="detail-row__value">${escapeHtml(entry.duration || "-")}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row__label">NOTE</span>
        <span class="detail-row__value">${escapeHtml(entry.note || "-")}</span>
      </div>
    `;
  }

  function closeEntryDetail() {
    $("#entry-detail").hidden = true;
    state.detailEntry = null;
  }

  function startEditEntry() {
    const entry = state.detailEntry;
    if (!entry) return;
    $("#entry-detail-view").hidden = true;
    $("#entry-detail-actions").hidden = true;
    const form = $("#entry-detail-edit-form");
    form.hidden = false;
    $("#edit-time").value = entry.time;
    $("#edit-title").value = entry.title || "";
    $("#edit-place").value = entry.place || "";
    $("#edit-duration").value = entry.duration || "";
    $("#edit-note").value = entry.note || "";
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    const entry = state.detailEntry;
    if (!entry) return;
    const payload = {
      time: $("#edit-time").value,
      title: $("#edit-title").value,
      place: $("#edit-place").value,
      duration: $("#edit-duration").value,
      note: $("#edit-note").value,
    };
    try {
      const res = await api(`/api/entries/${entry.id}`, { method: "PUT", body: JSON.stringify(payload) });
      state.detailEntry = res.entry;
      renderDetailView(res.entry);
      $("#entry-detail-view").hidden = false;
      $("#entry-detail-edit-form").hidden = true;
      $("#entry-detail-actions").hidden = false;
      showToast("Entry updated");
      await selectDate(state.selectedDate);
    } catch (err) {
      showToast("Could not save changes");
    }
  }

  async function handleDeleteEntry() {
    const entry = state.detailEntry;
    if (!entry) return;
    if (!confirm("Delete this entry? This can't be undone.")) return;
    try {
      await api(`/api/entries/${entry.id}`, { method: "DELETE" });
      closeEntryDetail();
      showToast("Entry deleted");
      await loadDates();
    } catch (err) {
      showToast("Could not delete entry");
    }
  }

  // ---------------------------------------------------------------- settings
  async function handleSettingsSubmit(e) {
    e.preventDefault();
    const status = $("#settings-status");
    status.classList.remove("is-error");
    const oldPw = $("#settings-old").value;
    const newPw = $("#settings-new").value;
    const confirmPw = $("#settings-confirm").value;

    if (newPw !== confirmPw) {
      status.textContent = "New passwords don't match.";
      status.classList.add("is-error");
      return;
    }
    try {
      await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      });
      status.textContent = "Password updated.";
      showToast("Password changed");
      $("#settings-old").value = "";
      $("#settings-new").value = "";
      $("#settings-confirm").value = "";
    } catch (err) {
      status.textContent = "Current password is incorrect.";
      status.classList.add("is-error");
    }
  }

  // ---------------------------------------------------------------- wire up
  function init() {
    $$(".menu-item").forEach((item) => {
      item.addEventListener("click", () => goToScreen(item.dataset.target));
      item.addEventListener("mouseenter", () => {
        const idx = menuItems.indexOf(item);
        state.menuFocusIndex = idx;
        focusMenuItem(idx);
      });
    });

    $$("[data-back]").forEach((btn) => btn.addEventListener("click", () => goToScreen("menu")));

    $("#auth-form").addEventListener("submit", handleAuthSubmit);
    $("#entry-form").addEventListener("submit", handleEntrySubmit);
    $("#entry-detail-close").addEventListener("click", closeEntryDetail);
    $("#entry-detail-edit-btn").addEventListener("click", startEditEntry);
    $("#entry-detail-delete-btn").addEventListener("click", handleDeleteEntry);
    $("#entry-detail-edit-form").addEventListener("submit", handleEditSubmit);
    $("#settings-form").addEventListener("submit", handleSettingsSubmit);

    document.addEventListener("keydown", handleMenuKeydown);
    document.addEventListener("keydown", handleGlobalKeydown);

    $$(".btn").forEach(attachRipple);
    startParallax();

    boot();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
