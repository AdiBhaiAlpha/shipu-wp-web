/**
 * ShiPu WP - admin panel.
 *
 * Security posture, stated plainly:
 *   * The guard here is a UX gate, not a boundary. It reads
 *     `shipuwp/admins/{uid}/active === true` and hides the UI otherwise.
 *   * Every privileged call re-checks the same flag server-side, because
 *     `database.rules.json` makes `admins/**` unwritable by clients. Hiding a
 *     URL grants nothing; the backend refuses regardless.
 *   * Nothing in this file is a credential. There is no admin key, no token,
 *     and no bypass - only the signed-in user's own Firebase ID token.
 */

import { APP_VERSION, PLAN_PRO, validatePassword, validateUsername } from "./firebase-config.js";

import {
  NotConfiguredError,
  adminPayments,
  adminStats,
  backendUrl,
  humaniseAuthError,
  isAdmin,
  isBackendConfigured,
  onUserChanged,
  rejectPayment,
  signIn,
  signOutUser,
  verifyPayment
} from "./api.js";

import { mountWordmarks } from "./wordmark.js";
import {
  $,
  $$,
  busyLabel,
  chip,
  confirmDialog,
  currencyCode,
  dataRow,
  el,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  kicker,
  notice,
  setBusy,
  statCard,
  toast
} from "./ui.js";

const state = {
  user: null,
  isAdmin: false,
  guard: "checking", // checking | signed-out | not-admin | admin
  stats: null,
  payments: [],
  filter: "pending",
  loading: false,
  lastRefreshed: 0
};

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

function setChrome(active) {
  const badge = $("#guard-badge");
  const label = $("#guard-label");
  if (!badge || !label) return;
  badge.className = `guard-badge ${active ? "is-active" : "is-locked"}`;
  label.textContent = active ? "ADMIN SESSION" : "LOCKED";
}

function render() {
  const main = $("#admin-main");
  main.textContent = "";

  if (state.guard === "checking") {
    main.appendChild(busyLabel("Verifying administrator credentials…"));
    return;
  }

  if (state.guard === "signed-out") {
    main.appendChild(renderSignedOut());
    setChrome(false);
    return;
  }

  if (state.guard === "not-admin") {
    main.appendChild(renderNotAdmin());
    setChrome(false);
    return;
  }

  setChrome(true);
  main.appendChild(renderDashboard());
}

/* ---- guard screens ------------------------------------------------ */

function renderSignedOut() {
  const username = el("input", {
    class: "field-input",
    id: "admin-username",
    type: "text",
    placeholder: "your admin username",
    autocomplete: "username",
    spellcheck: "false"
  });
  const password = el("input", {
    class: "field-input",
    id: "admin-password",
    type: "password",
    placeholder: "••••••••",
    autocomplete: "current-password"
  });
  const message = el("div", { class: "form-message", role: "alert" });
  const submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, ["Sign in"]);

  const form = el("form", { class: "auth-form", novalidate: true }, [
    el("div", { class: "field" }, [
      el("label", { class: "field-label", for: "admin-username" }, ["Username"]),
      username
    ]),
    el("div", { class: "field" }, [
      el("label", { class: "field-label", for: "admin-password" }, ["Password"]),
      password
    ]),
    message,
    submit
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const name = username.value.trim().toLowerCase();
    const nameProblem = validateUsername(name);
    if (nameProblem) return fail(nameProblem);
    const passwordProblem = validatePassword(password.value);
    if (passwordProblem) return fail(passwordProblem);

    setBusy(submit, true, "Signing in…");
    try {
      await signIn(name, password.value);
    } catch (error) {
      fail(humaniseAuthError(error));
    } finally {
      setBusy(submit, false);
    }
  });

  function fail(text) {
    message.textContent = "";
    message.appendChild(notice("error", null, text));
  }

  return el("div", { class: "guard-screen" }, [
    el("div", { class: "guard-mark", "aria-hidden": "true" }, ["[ LOCKED ]"]),
    el("h1", { class: "guard-title" }, ["Administrator sign-in required"]),
    el("p", { class: "guard-text" }, [
      "This panel manages payment verification. Sign in with an administrator account to continue."
    ]),
    el("div", { class: "guard-panel" }, [form]),
    el("p", { class: "guard-foot" }, [
      "Access is granted by ",
      el("span", { class: "mono" }, ["shipuwp/admins/{uid}/active === true"]),
      " and re-checked on the server for every request."
    ])
  ]);
}

function renderNotAdmin() {
  return el("div", { class: "guard-screen" }, [
    el("div", { class: "guard-mark is-error", "aria-hidden": "true" }, ["[ 403 ]"]),
    el("h1", { class: "guard-title" }, ["Administrator access required"]),
    el("p", { class: "guard-text" }, [
      `You are signed in as @${state.user?.username || "unknown"}, but this account is not an active administrator.`
    ]),
    el("p", { class: "guard-text guard-text-dim" }, [
      "Hiding this URL is not what protects payments - the backend refuses verify and reject for any "
    ]),
    el("p", { class: "guard-text guard-text-dim" }, [
      "account without the admin flag, and the database rules make that flag unwritable from a client."
    ]),
    el("div", { class: "guard-actions" }, [
      el("button", { class: "btn btn-ghost", type: "button", "data-action": "signout" }, ["Sign out"]),
      el("a", { class: "btn btn-ghost", href: "../index.html#/", "data-action": "back" }, ["Back to site"])
    ])
  ]);
}

/* ---- dashboard ---------------------------------------------------- */

function renderDashboard() {
  const wrap = el("div", { class: "stack stack-lg" });

  wrap.appendChild(
    el("header", { class: "admin-head" }, [
      el("div", {}, [
        kicker("control panel"),
        el("h1", { class: "page-title" }, ["Payment verification"]),
        el("p", { class: "page-lead" }, [
          `Signed in as @${state.user.username}. Verifying a payment activates ShiPu WP Pro on the server and applies the 30-day renewal rule.`
        ])
      ]),
      el("div", { class: "admin-head-actions" }, [
        el("button", { class: "btn btn-primary", type: "button", "data-action": "refresh" }, ["Refresh"]),
        el("button", { class: "btn btn-ghost", type: "button", "data-action": "signout" }, ["Sign out"])
      ])
    ])
  );

  if (!isBackendConfigured()) {
    wrap.appendChild(
      el("div", { class: "notice-stack" }, [
        notice(
          "error",
          "Admin API not configured",
          "BACKEND_URL is empty on this deployment, so no payment can be listed, verified or rejected. This panel will not pretend otherwise. Set BACKEND_URL in assets/firebase-config.js (or a shipu-backend meta tag) and reload.",
          [el("span", { class: "mono notice-code" }, ["GET /admin/stats unavailable"])]
        )
      ])
    );
  }

  wrap.appendChild(renderStats());
  wrap.appendChild(renderPayments());

  return wrap;
}

function renderStats() {
  const grid = el("div", { class: "stat-grid stat-grid-admin" });

  if (state.loading && !state.stats) {
    grid.appendChild(busyLabel("Loading statistics…"));
    return grid;
  }

  const stats = state.stats || {};
  grid.appendChild(statCard("Total users", stats.totalUsers ?? "—", "registered accounts", "primary"));
  grid.appendChild(statCard("Free users", stats.freeUsers ?? "—", "on the free tier", "neutral"));
  grid.appendChild(statCard("Pro users", stats.proUsers ?? "—", "active subscriptions", "accent"));
  grid.appendChild(statCard("Pending payments", stats.pendingPayments ?? "—", "awaiting review", "warning"));
  return grid;
}

const FILTERS = [
  { id: "pending", label: "Pending" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
  { id: "", label: "All" }
];

function renderPayments() {
  const panel = el("section", { class: "panel" });

  const filterBar = el("div", { class: "panel-tabs" }, [
    ...FILTERS.map((filter) =>
      el(
        "button",
        {
          class: `panel-tab${state.filter === filter.id ? " is-active" : ""}`,
          type: "button",
          "data-filter": filter.id,
          "aria-pressed": String(state.filter === filter.id)
        },
        [
          filter.label,
          filter.id && state.stats
            ? el("span", { class: "tab-count" }, [
                String(
                  filter.id === "pending"
                    ? state.stats.pendingPayments
                    : filter.id === "verified"
                      ? state.stats.verifiedPayments
                      : state.stats.rejectedPayments
                )
              ])
            : null
        ]
      )
    )
  ]);

  panel.appendChild(
    el("div", { class: "panel-head panel-head-split" }, [
      el("div", {}, [el("h2", { class: "panel-title" }, ["Payments"]), state.lastRefreshed ? el("p", { class: "panel-note panel-note-dim" }, [`last refreshed ${formatDateTime(state.lastRefreshed)}`]) : null]),
      filterBar
    ])
  );

  const body = el("div", { class: "panel-body" });

  if (!isBackendConfigured()) {
    body.appendChild(
      notice("info", "Nothing to list", "The admin API is not configured, so this table stays empty rather than showing placeholder data.")
    );
  } else if (state.loading) {
    body.appendChild(busyLabel("Loading payments…"));
  } else if (!state.payments.length) {
    body.appendChild(
      el("div", { class: "table-empty" }, [
        el("span", { class: "empty-mark", "aria-hidden": "true" }, ["[ 0 ]"]),
        el("p", {}, [
          state.filter
            ? `No ${state.filter} payments.`
            : "No payments have been submitted yet."
        ])
      ])
    );
  } else {
    body.appendChild(renderTable(state.payments));
  }

  panel.appendChild(body);
  return panel;
}

function renderTable(rows) {
  const table = el("table", { class: "data-table" });

  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col" }, ["ID"]),
        el("th", { scope: "col" }, ["Username"]),
        el("th", { scope: "col", class: "num" }, ["Amount"]),
        el("th", { scope: "col" }, ["Method"]),
        el("th", { scope: "col" }, ["Transaction ID"]),
        el("th", { scope: "col" }, ["Submitted"]),
        el("th", { scope: "col" }, ["Status"]),
        el("th", { scope: "col", class: "col-actions" }, ["Actions"])
      ])
    ])
  );

  const tbody = el("tbody");
  for (const row of rows) {
    const isPending = row.status === "pending";
    tbody.appendChild(
      el("tr", { class: `row-${escapeHtml(String(row.status || "unknown"))}` }, [
        el("td", {}, [el("span", { class: "mono cell-id", title: row.id || "" }, [shortId(row.id)])]),
        el("td", {}, [el("span", { class: "cell-user" }, [`@${row.username || "—"}`])]),
        el("td", { class: "num mono" }, [
          row.amount ? `${currencyCode(row.currency)}${(Number(row.amount) / 100).toFixed(2)}` : "—"
        ]),
        el("td", {}, [chip(String(row.method || "—").toUpperCase(), "neutral")]),
        el("td", {}, [el("span", { class: "mono cell-txn", title: row.transactionId || "" }, [row.transactionId || "—"])]),
        el("td", {}, [
          el("span", { title: formatDateTime(row.createdAt) }, [formatRelative(row.createdAt)]),
          el("span", { class: "cell-sub mono" }, [formatDate(row.createdAt)])
        ]),
        el("td", {}, [statusPill(row.status)]),
        el("td", { class: "col-actions" }, [renderActions(row, isPending)])
      ])
    );
  }
  table.appendChild(tbody);
  return table;
}

function statusPill(status) {
  const map = { pending: "warning", verified: "success", rejected: "error" };
  const key = String(status || "unknown").toLowerCase();
  return chip(key.toUpperCase(), map[key] || "neutral");
}

function shortId(id) {
  const value = String(id || "");
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || "—";
}

function renderActions(row, isPending) {
  const viewBtn = el("button", { class: "btn btn-tiny btn-ghost", type: "button", "data-view": row.id }, ["View"]);
  if (!isPending) return el("div", { class: "row-actions" }, [viewBtn]);

  const verifyBtn = el("button", { class: "btn btn-tiny btn-success", type: "button", "data-verify": row.id }, [
    "Verify"
  ]);
  const rejectBtn = el("button", { class: "btn btn-tiny btn-danger", type: "button", "data-reject": row.id }, [
    "Reject"
  ]);
  return el("div", { class: "row-actions" }, [viewBtn, verifyBtn, rejectBtn]);
}

/* ---- payment detail drawer ---------------------------------------- */

let dialog = null;

function showPayment(row) {
  dialog?.remove();
  dialog = el("dialog", { class: "modal modal-detail" }, [
    el("form", { method: "dialog", class: "modal-form" }, [
      el("div", { class: "modal-head" }, [
        el("h2", { class: "modal-title" }, ["Payment detail"]),
        statusPill(row.status)
      ]),
      el("div", { class: "data-list" }, [
        dataRow("ID", el("span", { class: "mono truncate" }, [String(row.id || "—")])),
        dataRow("Username", `@${row.username || "—"}`),
        dataRow("User UID", el("span", { class: "mono truncate" }, [String(row.uid || "—")])),
        dataRow("Plan", String(row.plan || PLAN_PRO).toUpperCase()),
        dataRow("Amount", row.amount ? formatMoney(row.amount, row.currency) : "—"),
        dataRow("Currency", currencyCode(row.currency)),
        dataRow("Method", String(row.method || "—").toUpperCase()),
        dataRow("Transaction ID", el("span", { class: "mono" }, [String(row.transactionId || "—")])),
        dataRow("Reference", String(row.reference || "—")),
        dataRow("Proof URL", el("span", { class: "truncate" }, [String(row.proofUrl || "—")])),
        dataRow("Submitted", formatDateTime(row.createdAt)),
        dataRow("Reviewed", formatDateTime(row.verifiedAt)),
        dataRow("Reviewed by", el("span", { class: "mono truncate" }, [String(row.verifiedBy || "—")])),
        dataRow("Reason", String(row.reason || "—")),
        dataRow("Expires after verify", formatDate(row.expiresAt))
      ]),
      el("div", { class: "modal-actions" }, [
        row.proofUrl
          ? el("a", { class: "btn btn-ghost", href: row.proofUrl, target: "_blank", rel: "noopener noreferrer" }, [
              "Open proof"
            ])
          : null,
        el("button", { class: "btn btn-ghost", value: "close", type: "submit" }, ["Close"])
      ])
    ])
  ]);
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

/* ---- data loading -------------------------------------------------- */

async function loadAll() {
  if (!isBackendConfigured()) {
    state.stats = null;
    state.payments = [];
    state.loading = false;
    render();
    return;
  }

  state.loading = true;
  render();

  try {
    const [stats, payments] = await Promise.all([adminStats(), adminPayments(state.filter)]);
    state.stats = stats || {};
    state.payments = Array.isArray(payments?.payments) ? payments.payments : [];
    state.lastRefreshed = Date.now();
  } catch (error) {
    state.stats = null;
    state.payments = [];
    state.loading = false;
    render();
    toast(error?.message || "Could not load admin data.", error instanceof NotConfiguredError ? "warning" : "error");
    return;
  }

  state.loading = false;
  render();
}

function findRow(id) {
  return state.payments.find((row) => row.id === id);
}

/* ---- privileged actions -------------------------------------------- */

async function handleVerify(id) {
  const row = findRow(id);
  if (!row) return toast("That payment is no longer in the list. Refresh first.", "warning");

  const confirmed = await confirmDialog({
    title: "Verify this payment?",
    message: `Verify this payment? This will activate <strong>30 days of ShiPu WP Pro</strong> for <strong>@${escapeHtml(row.username || "unknown")}</strong>.`,
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    tone: "success"
  });

  // Only a real confirmation reaches the API.
  if (!confirmed) {
    toast("Verification cancelled. Nothing was changed.", "info");
    return;
  }

  try {
    const result = await verifyPayment(id);
    toast(`Verified. Pro activated for @${row.username} until ${formatDate(result?.expiresAt)}.`, "success");
  } catch (error) {
    toast(error?.message || "Verification failed.", "error");
    return;
  }
  await loadAll();
}

async function handleReject(id) {
  const row = findRow(id);
  if (!row) return toast("That payment is no longer in the list. Refresh first.", "warning");

  const confirmed = await confirmDialog({
    title: "Reject this payment?",
    message: `Reject the payment from <strong>@${escapeHtml(row.username || "unknown")}</strong> (transaction <span class="mono">${escapeHtml(row.transactionId || "—")}</span>)? No Pro is granted and the user is not charged by this action.`,
    confirmLabel: "Confirm reject",
    cancelLabel: "Cancel",
    tone: "danger"
  });

  if (!confirmed) {
    toast("Rejection cancelled. Nothing was changed.", "info");
    return;
  }

  try {
    await rejectPayment(id, "");
    toast(`Rejected payment for @${row.username}.`, "info");
  } catch (error) {
    toast(error?.message || "Rejection failed.", "error");
    return;
  }
  await loadAll();
}

/* ---- events --------------------------------------------------------- */

function wire() {
  $("#admin-main")?.addEventListener("click", async (event) => {
    const target = event.target;

    const tab = target.closest("[data-filter]");
    if (tab) {
      state.filter = tab.dataset.filter;
      state.loading = true;
      render();
      await loadAll();
      return;
    }

    const refreshBtn = target.closest("[data-action='refresh']");
    if (refreshBtn) {
      setBusy(refreshBtn, true, "Refreshing…");
      await loadAll();
      setBusy(refreshBtn, false);
      return;
    }

    const signoutBtn = target.closest("[data-action='signout']");
    if (signoutBtn) {
      await signOutUser();
      toast("Signed out", "info");
      return;
    }

    const viewBtn = target.closest("[data-view]");
    if (viewBtn) {
      const row = findRow(viewBtn.dataset.view);
      if (row) showPayment(row);
      return;
    }

    const verifyBtn = target.closest("[data-verify]");
    if (verifyBtn) {
      verifyBtn.disabled = true;
      await handleVerify(verifyBtn.dataset.verify);
      verifyBtn.disabled = false;
      return;
    }

    const rejectBtn = target.closest("[data-reject]");
    if (rejectBtn) {
      rejectBtn.disabled = true;
      await handleReject(rejectBtn.dataset.reject);
      rejectBtn.disabled = false;
    }
  });

  $("#api-endpoint") && ($("#api-endpoint").textContent = backendUrl() || "not configured");
  $("#admin-version") && ($("#admin-version").textContent = `v${APP_VERSION}`);
}

/* ---- boot ----------------------------------------------------------- */

async function evaluateGuard(user) {
  if (!user) {
    state.user = null;
    state.isAdmin = false;
    state.guard = "signed-out";
    render();
    return;
  }

  state.user = user;
  state.isAdmin = await isAdmin(user.uid);
  state.guard = state.isAdmin ? "admin" : "not-admin";
  render();

  if (state.isAdmin) {
    // Authorisation is server-side too; any refusal here is reported honestly.
    await loadAll();
  }
}

async function boot() {
  wire();
  mountWordmarks(document);
  $$(".admin-tab").forEach((node) => node.classList.toggle("is-active", node.dataset.adminTab === "payments"));
  await onUserChanged(evaluateGuard);
}

boot();