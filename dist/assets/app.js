/**
 * ShiPu WP - public site.
 *
 * Every page of the marketing site, the account area and the purchase flow.
 * Two rules hold throughout this file:
 *
 *   1. A price is never written in markup - it is read from
 *      `shipuwp/pricing/pro` (with a declared fallback in firebase-config.js).
 *   2. The frontend never grants a plan and never claims a payment succeeded.
 *      Pro is activated by an admin calling `POST /admin/payments/:id/verify`.
 */

import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  PAYMENT_REJECTED,
  PAYMENT_VERIFIED,
  PLAN_FREE,
  PLAN_PRO,
  SUB_ACTIVE,
  validatePassword,
  validateUsername
} from "./firebase-config.js";

import {
  NotConfiguredError,
  clearPurchaseIntent,
  createPurchaseSession,
  decodeSessionToken,
  humaniseAuthError,
  isBackendConfigured,
  isSessionExpired,
  loadFreeDailyReplies,
  loadPaymentMethods,
  loadPricing,
  loadPurchaseIntent,
  onUserChanged,
  readLocalAccount,
  readOwnPayment,
  recallPayment,
  rememberPayment,
  register,
  requestPasswordReset,
  savePurchaseIntent,
  signIn,
  signOutUser,
  submitPayment,
  syncAccount
} from "./api.js";

import { href, navigate, refresh, route, setNotFound, start, currentRoute } from "./router.js";
import { mountWordmarks } from "./wordmark.js";
import {
  $,
  $$,
  busyLabel,
  chip,
  currencyCode,
  dataRow,
  el,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  kicker,
  meter,
  notice,
  pluralise,
  setBusy,
  statCard,
  statusChip,
  toast
} from "./ui.js";

/* ------------------------------------------------------------------ *
 * Session state
 * ------------------------------------------------------------------ */

const state = {
  user: null,
  pricing: null,
  freeDailyReplies: 25
};

const FEATURES = [
  {
    id: "ai",
    title: "AI-powered replies",
    body: "Every reply is drafted by a language model tuned for WhatsApp tone - short, natural, and ready to send.",
    tag: "generate"
  },
  {
    id: "wa",
    title: "WhatsApp automation",
    body: "The agent listens to the thread, decides when a reply is due, and keeps the conversation moving without you watching it.",
    tag: "listen"
  },
  {
    id: "smart",
    title: "Smart response generation",
    body: "Context-aware drafting that reads the whole message history instead of replying to an isolated line.",
    tag: "context"
  },
  {
    id: "free",
    title: "Free daily usage",
    body: "Twenty-five AI replies every day at no cost. The quota resets on your calendar day, tracked server-side.",
    tag: "25 / day"
  },
  {
    id: "pro",
    title: "Premium unlimited replies",
    body: "No ceiling, no daily counter. Verified once, then ShiPu WP drafts for as long as your plan runs.",
    tag: "unlimited"
  }
];

const FREE_FEATURES = [
  "25 AI replies per day",
  "AI-generated replies",
  "WhatsApp assistant",
  "Daily usage tracking",
  "Agent dashboard",
  "Community support"
];

const PRO_FEATURES = [
  "Unlimited AI replies",
  "Everything in Free",
  "No daily counter",
  "Priority AI generation",
  "Full agent dashboard",
  "Early access to new features"
];

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */

function markActiveNav() {
  const path = currentRoute().path;
  $$("[data-nav]").forEach((link) => {
    const target = link.dataset.nav;
    const isActive = target === path || (target === "/" && path === "/");
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function paintAuthChrome() {
  const label = $("#auth-label");
  const action = $("#auth-action");
  if (!label || !action) return;

  if (state.user) {
    label.textContent = `@${state.user.username}`;
    action.textContent = "Sign out";
    action.dataset.action = "signout";
    action.classList.remove("is-hidden");
  } else {
    label.textContent = "";
    action.textContent = "Login";
    action.dataset.action = "login";
    action.classList.remove("is-hidden");
  }

  const adminLink = $("[data-nav='admin']");
  if (adminLink) adminLink.textContent = state.user ? "Admin" : "Admin";
}

function renderFooterStatus() {
  const node = $("#footer-backend-status");
  if (!node) return;
  const ok = isBackendConfigured();
  node.textContent = ok ? "API CONNECTED" : "API NOT CONFIGURED";
  node.className = `footer-status ${ok ? "is-ok" : "is-off"}`;
}

/* ------------------------------------------------------------------ *
 * Page shell helpers
 * ------------------------------------------------------------------ */

function pageHead(eyebrow, title, lead) {
  return el("header", { class: "page-head" }, [
    kicker(eyebrow),
    el("h1", { class: "page-title" }, [title]),
    lead ? el("p", { class: "page-lead" }, [lead]) : null
  ]);
}

function signInPrompt(title = "Sign in to continue") {
  return el("div", { class: "stack stack-lg" }, [
    el("div", { class: "empty-panel" }, [
      el("span", { class: "empty-mark", "aria-hidden": "true" }, ["[ ! ]"]),
      el("h2", { class: "empty-title" }, [title]),
      el("p", { class: "empty-text" }, [
        "This area reads your account from ShiPu WP. Sign in with the username you registered."
      ]),
      el("div", { class: "empty-actions" }, [
        el("a", { class: "btn btn-primary", href: href("/login", { next: currentRoute().path }) }, ["Login"]),
        el("a", { class: "btn btn-ghost", href: href("/register") }, ["Create account"])
      ])
    ])
  ]);
}

/* ------------------------------------------------------------------ *
 * 1. Landing
 * ------------------------------------------------------------------ */

async function pageHome() {
  const view = $("#view");
  const wordmark = el("div", { class: "hero-wordmark", "data-wordmark": APP_NAME.toUpperCase(), "data-size": "hero" });

  view.textContent = "";
  view.appendChild(
    el("div", { class: "stack stack-lg" }, [
      el("section", { class: "hero" }, [
        el("div", { class: "hero-inner" }, [
          wordmark,
          el("p", { class: "hero-tagline" }, [APP_TAGLINE]),
          el("p", { class: "hero-lead" }, [APP_DESCRIPTION]),
          el("div", { class: "hero-actions" }, [
            el("a", { class: "btn btn-primary btn-lg", href: href("/register") }, ["Get Started"]),
            el("a", { class: "btn btn-ghost btn-lg", href: href("/login") }, ["Login"])
          ]),
          el("p", { class: "hero-note" }, [
            "Free tier: ",
            el("strong", {}, [`${state.freeDailyReplies} AI replies / day`]),
            " · no card required"
          ])
        ]),
        el("div", { class: "hero-terminal", "aria-hidden": "true" }, [buildTerminalPreview()])
      ]),

      el("section", { class: "section" }, [
        el("div", { class: "section-head" }, [
          kicker("capabilities"),
          el("h2", { class: "section-title" }, ["What ShiPu WP does"]),
          el("p", { class: "section-lead" }, [
            "One assistant for the reply you owe a customer right now."
          ])
        ]),
        el(
          "div",
          { class: "feature-grid" },
          FEATURES.map((feature) =>
            el("article", { class: "feature" }, [
              el("div", { class: "feature-top" }, [
                el("span", { class: "feature-tag" }, [`// ${feature.tag}`]),
                el("span", { class: "feature-index", "aria-hidden": "true" }, [
                  String(FEATURES.indexOf(feature) + 1).padStart(2, "0")
                ])
              ]),
              el("h3", { class: "feature-title" }, [feature.title]),
              el("p", { class: "feature-body" }, [feature.body])
            ])
          )
        )
      ]),

      el("section", { class: "section" }, [
        el("div", { class: "cta-band" }, [
          el("div", { class: "cta-copy" }, [
            kicker("start"),
            el("h2", { class: "section-title" }, ["Start with the free tier"]),
            el("p", { class: "section-lead" }, [
              `Create an account and generate ${state.freeDailyReplies} AI replies a day. Upgrade only when you need them all.`
            ])
          ]),
          el("div", { class: "cta-actions" }, [
            el("a", { class: "btn btn-primary btn-lg", href: href("/pricing") }, ["See pricing"]),
            el("a", { class: "btn btn-ghost btn-lg", href: href("/register") }, ["Get Started"])
          ])
        ])
      ])
    ])
  );

  mountWordmarks(view);
}

function buildTerminalPreview() {
  const lines = [
    { text: "$ shipu-wp run", tone: "cmd" },
    { text: "[*] connecting to whatsapp gateway", tone: "dim" },
    { text: "[+] listener ready", tone: "ok" },
    { text: "[>] 3 new messages", tone: "accent" },
    { text: "    Rahim: bhai, order confirm?", tone: "dim" },
    { text: "[*] drafting reply #1 ...", tone: "dim" },
    { text: "[+] draft ready -> send", tone: "ok" },
    { text: "[=] plan: FREE   usage: 8 / 25", tone: "warn" },
    { text: "$ _", tone: "cmd" }
  ];
  return el("div", { class: "term" }, [
    el("div", { class: "term-bar" }, [
      el("span", { class: "term-dot term-dot-r" }),
      el("span", { class: "term-dot term-dot-y" }),
      el("span", { class: "term-dot term-dot-g" }),
      el("span", { class: "term-title" }, ["shipu-wp — session"])
    ]),
    el(
      "pre",
      { class: "term-body" },
      lines.map((line) => el("span", { class: `term-line term-${line.tone}` }, [line.text]))
    )
  ]);
}

/* ------------------------------------------------------------------ *
 * 2. Pricing
 * ------------------------------------------------------------------ */

async function pagePricing() {
  const view = $("#view");
  const pricing = (await loadPricing().catch(() => state.pricing)) || state.pricing || {
    priceCents: 0,
    currency: "USD",
    durationDays: 30,
    published: false,
    source: "fallback"
  };
  state.pricing = pricing;

  const priceText = pricing.published
    ? formatMoney(pricing.priceCents, pricing.currency)
    : "Not published yet";
  const currency = currencyCode(pricing.currency);
  const durationDays = Number(pricing.durationDays) || 30;

  const priceCard = el("div", { class: "price-amount" }, [
    el("span", { class: `price-value${pricing.published ? "" : " is-unset"}` }, [priceText]),
    pricing.published
      ? el("span", { class: "price-period" }, [`/ ${pluralise(durationDays, "day")} · ${currency}`])
      : el("span", { class: "price-period" }, [`${currency} · ${pluralise(durationDays, "day")} · awaiting configuration`])
  ]);

  const proCard = el("article", { class: "plan-card plan-pro" }, [
    el("div", { class: "plan-flag" }, ["PRO"]),
    el("div", { class: "plan-head" }, [
      el("h3", { class: "plan-name" }, ["Pro"]),
      el("p", { class: "plan-tagline" }, ["Unlimited AI replies, no daily counter."])
    ]),
    priceCard,
    el("ul", { class: "plan-features" }, PRO_FEATURES.map((line) => el("li", { class: "plan-feature" }, [line]))),
    pricing.published
      ? el("a", { class: "btn btn-secondary btn-block", href: href("/purchase") }, ["Get Pro"])
      : el("button", { class: "btn btn-disabled btn-block", type: "button", disabled: true }, [
          "Get Pro"
        ]),
    pricing.published
      ? el("p", { class: "plan-foot" }, ["Activation is completed by an administrator after payment verification."])
      : el("p", { class: "plan-foot" }, ["Purchasing is unavailable until a price is published in the backend."])
  ]);

  const freeCard = el("article", { class: "plan-card plan-free" }, [
    el("div", { class: "plan-flag" }, ["FREE"]),
    el("div", { class: "plan-head" }, [
      el("h3", { class: "plan-name" }, ["Free"]),
      el("p", { class: "plan-tagline" }, ["Everything you need to start replying with AI."])
    ]),
    el("div", { class: "price-amount" }, [
      el("span", { class: "price-value" }, ["$0"]),
      el("span", { class: "price-period" }, [`/ forever · ${pluralise(state.freeDailyReplies, "reply")} per day`])
    ]),
    el("ul", { class: "plan-features" }, FREE_FEATURES.map((line) => el("li", { class: "plan-feature" }, [line]))),
    el("a", { class: "btn btn-ghost btn-block", href: href("/register") }, ["Get Started"]),
    el("p", { class: "plan-foot" }, ["No card. No expiry. Resets every calendar day."])
  ]);

  const notes = [];
  if (!pricing.published) {
    notes.push(
      notice(
        "warning",
        "Pro price not published",
        `No price is present in ${"shipuwp/pricing/pro"}, so the site shows the configured fallback rather than inventing an amount. Publishing a price in the backend switches this card over automatically.`
      )
    );
  }
  if (!isBackendConfigured()) {
    notes.push(
      notice(
        "info",
        "Purchasing is not configured on this deployment",
        "BACKEND_URL is empty, so purchase sessions cannot be minted and payments cannot be recorded. Browsing plans still works.",
        [el("a", { class: "btn btn-tiny btn-ghost", href: href("/dashboard") }, ["Open dashboard"])]
      )
    );
  }

  view.textContent = "";
  view.appendChild(
    el("div", { class: "stack stack-lg" }, [
      pageHead("pricing", "Two plans. One assistant.", "Start free. Upgrade when the daily ceiling starts costing you replies."),
      el("div", { class: "plan-grid" }, [freeCard, proCard]),
      notes.length ? el("div", { class: "notice-stack" }, notes) : null,
      el("p", { class: "fine-print" }, [
        "Prices are read from the database at request time. ",
        el("span", { class: "mono" }, [`source: ${pricing.source}`])
      ])
    ])
  );
}

/* ------------------------------------------------------------------ *
 * 3. Login / Register
 * ------------------------------------------------------------------ */

function authPage({ mode }) {
  const isLogin = mode === "login";
  const { query } = currentRoute();
  const next = typeof query.next === "string" ? query.next : "";

  const usernameInput = el("input", {
    class: "field-input",
    id: "username",
    name: "username",
    type: "text",
    autocomplete: "username",
    inputmode: "text",
    spellcheck: "false",
    placeholder: "rahim",
    required: true
  });

  const passwordInput = el("input", {
    class: "field-input",
    id: "password",
    name: "password",
    type: "password",
    autocomplete: isLogin ? "current-password" : "new-password",
    placeholder: "••••••••",
    required: true
  });

  const confirmInput = el("input", {
    class: "field-input",
    id: "confirm",
    name: "confirm",
    type: "password",
    autocomplete: "new-password",
    placeholder: "••••••••",
    required: true
  });

  const messageHost = el("div", { class: "form-message", role: "alert" });
  const submit = el(
    "button",
    { class: "btn btn-primary btn-block", type: "submit" },
    [isLogin ? "Login" : "Create account"]
  );

  const mappingHint = el("p", { class: "field-hint" }, [
    "Your username maps to an internal address of the form ",
    el("span", { class: "mono" }, ["name@shipu-wp.local"]),
    "."
  ]);

  const form = el(
    "form",
    { class: "auth-form", novalidate: true },
    [
      el("div", { class: "field" }, [
        el("label", { class: "field-label", for: "username" }, ["Username"]),
        usernameInput,
        mappingHint
      ]),
      el("div", { class: "field" }, [
        el("label", { class: "field-label", for: "password" }, ["Password"]),
        passwordInput,
        isLogin
          ? el("p", { class: "field-hint" }, ["Forgot it? Use the reset link below."])
          : el("p", { class: "field-hint" }, ["At least 6 characters."])
      ]),
      isLogin ? null : el("div", { class: "field" }, [el("label", { class: "field-label", for: "confirm" }, ["Confirm password"]), confirmInput]),
      messageHost,
      submit,
      isLogin
        ? el("button", { class: "link-button", type: "button", "data-action": "reset" }, ["Send password reset email"])
        : null
    ]
  );

  const wordmark = el("div", { class: "auth-wordmark", "data-wordmark": "SHIPU", "data-size": "md" });

  const node = el("div", { class: "auth-layout" }, [
    el("div", { class: "auth-panel" }, [
      wordmark,
      kicker(isLogin ? "authenticate" : "create account"),
      el("h1", { class: "auth-title" }, [isLogin ? "Login to ShiPu WP" : "Create your account"]),
      el("p", { class: "auth-lead" }, [
        isLogin
          ? "Sign in with your username and password."
          : `Pick a username. You get ${state.freeDailyReplies} AI replies every day on the free tier.`
      ]),
      form,
      el("p", { class: "auth-switch" }, [
        isLogin ? "No account yet? " : "Already registered? ",
        el("a", { href: isLogin ? href("/register") : href("/login") }, [isLogin ? "Create one" : "Login"])
      ])
    ]),
    el("aside", { class: "auth-aside" }, [
      el("p", { class: "aside-line" }, [`// ${APP_NAME} v${APP_VERSION}`]),
      el("p", { class: "aside-line" }, [`// ${APP_TAGLINE}`]),
      el("p", { class: "aside-line aside-muted" }, [
        "Authentication is handled by Firebase Email/Password under a synthetic address domain. Your real "
      ]),
      el("p", { class: "aside-line aside-muted" }, ["password never leaves this page."])
    ])
  ]);

  // ---- behaviour
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageHost.textContent = "";

    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    const usernameProblem = validateUsername(username);
    if (usernameProblem) return showFormError(usernameProblem);
    const passwordProblem = validatePassword(password);
    if (passwordProblem) return showFormError(passwordProblem);
    if (!isLogin && password !== confirmInput.value) return showFormError("Passwords do not match.");

    setBusy(submit, true, isLogin ? "Signing in…" : "Creating account…");
    try {
      if (isLogin) await signIn(username, password);
      else await register(username, password);

      toast(isLogin ? `Welcome back, @${username}` : `Account created: @${username}`, "success");
      const intent = loadPurchaseIntent();
      if (intent && next !== "/payment") {
        clearPurchaseIntent();
        navigate("/purchase", { session: intent });
      } else if (next) navigate(next);
      else navigate("/dashboard");
    } catch (error) {
      showFormError(humaniseAuthError(error));
    } finally {
      setBusy(submit, false);
    }
  });

  $("[data-action='reset']", form)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const username = usernameInput.value.trim().toLowerCase();
    const problem = validateUsername(username);
    if (problem) return showFormError(problem);
    setBusy(button, true, "Sending…");
    try {
      await requestPasswordReset(username);
      messageHost.textContent = "";
      messageHost.appendChild(
        notice("success", "Reset email sent", `If an account exists for @${username}, a reset link is on its way.`)
      );
    } catch (error) {
      showFormError(humaniseAuthError(error));
    } finally {
      setBusy(button, false);
    }
  });

  function showFormError(message) {
    messageHost.textContent = "";
    messageHost.appendChild(notice("error", null, message));
    messageHost.querySelector(".field-input, input")?.focus();
  }

  return node;
}

function pageLogin() {
  const view = $("#view");
  view.textContent = "";
  view.appendChild(pageHead("auth", "Login", "Access your ShiPu WP dashboard and reply quota."));
  view.appendChild(authPage({ mode: "login" }));
  mountWordmarks(view);
}

function pageRegister() {
  const view = $("#view");
  view.textContent = "";
  view.appendChild(pageHead("onboarding", "Create account", "Username and password. That is the whole form."));
  view.appendChild(authPage({ mode: "register" }));
  mountWordmarks(view);
}

/* ------------------------------------------------------------------ *
 * 4. Dashboard
 * ------------------------------------------------------------------ */

async function pageDashboard() {
  const view = $("#view");
  view.textContent = "";

  if (!state.user) {
    view.appendChild(pageHead("account", "Dashboard", "Your plan, usage and quota in one place."));
    view.appendChild(signInPrompt("Sign in to view your dashboard"));
    return;
  }

  const body = el("div", { class: "stack stack-lg" });
  view.appendChild(body);
  body.appendChild(pageHead("account", "Dashboard", "Authoritative state comes from the ShiPu WP API."));

  const refreshBtn = el("button", { class: "btn btn-ghost", type: "button", "data-action": "refresh" }, [
    "Refresh Account"
  ]);
  const signOutBtn = el("button", { class: "btn btn-ghost", type: "button", "data-action": "signout" }, [
    "Sign out"
  ]);

  body.appendChild(
    el("div", { class: "toolbar" }, [refreshBtn, el("a", { class: "btn btn-ghost", href: href("/pricing") }, ["Pricing"]), signOutBtn])
  );

  const content = el("div", { class: "stack stack-lg" });
  body.appendChild(content);

  const renderContent = async () => {
    content.textContent = "";
    content.appendChild(busyLabel("Loading account…"));
    const result = await loadDashboardState();
    content.textContent = "";
    content.appendChild(result.node);
  };

  refreshBtn.addEventListener("click", async () => {
    setBusy(refreshBtn, true, "Refreshing…");
    await renderContent();
    setBusy(refreshBtn, false);
    toast("Account refreshed", "info");
  });

  signOutBtn.addEventListener("click", async () => {
    await signOutUser();
    toast("Signed out", "info");
    navigate("/");
  });

  await renderContent();
}

/**
 * Resolve the dashboard view.
 * Prefers `POST /account/sync` (authoritative). When the backend is not
 * configured it falls back to the caller's own database record and says so
 * loudly - the fallback is never presented as authoritative.
 */
async function loadDashboardState() {
  const user = state.user;
  const greeting = el("p", { class: "dash-greeting" }, [
    "Hello ",
    el("span", { class: "dash-handle" }, [`@${user?.username || user?.displayName || user?.uid || "unknown"}`])
  ]);

  if (!isBackendConfigured()) {
    const record = await readLocalAccount(user.uid);
    const plan = record?.plan === PLAN_PRO && record?.subscription?.status === SUB_ACTIVE ? PLAN_PRO : PLAN_FREE;
    const usage = record?.usage || {};
    const used = Number(usage.repliesUsed || 0);
    const limit = state.freeDailyReplies;

    return {
      node: el("div", { class: "stack stack-lg" }, [
        notice(
          "warning",
          "API not configured — offline view",
          "BACKEND_URL is empty on this deployment, so the authoritative account endpoint could not be called. The figures below are read directly from your own database record and may lag behind the server.",
          [el("span", { class: "mono notice-code" }, ["POST /account/sync unavailable"])]
        ),
        greeting,
        el("div", { class: "stat-grid" }, [
          statCard("Plan", plan === PLAN_PRO ? "PRO" : "FREE", "local mirror", plan === PLAN_PRO ? "accent" : "primary"),
          statCard("Status", String(record?.subscription?.status || "none").toUpperCase(), "local mirror", "neutral"),
          statCard("Expires", formatDate(record?.subscription?.expiresAt), "local mirror", "neutral"),
          statCard("Remaining days", plan === PLAN_PRO ? String(daysLeft(record?.subscription?.expiresAt)) : "—", "local mirror", "neutral")
        ]),
        el("div", { class: "panel" }, [
          el("div", { class: "panel-head" }, [
            el("h2", { class: "panel-title" }, ["AI Replies"]),
            plan === PLAN_PRO ? statusChip("pro") : chip(`${used} / ${limit}`, "primary")
          ]),
          el("div", { class: "panel-body stack" }, [
            plan === PLAN_PRO
              ? el("p", { class: "usage-unlimited" }, ["UNLIMITED"])
              : el("div", { class: "stack" }, [
                  el("p", { class: "usage-figure" }, [`${used} / ${limit}`]),
                  meter(used, limit),
                  el("p", { class: "panel-note" }, [`Remaining ${Math.max(0, limit - used)} replies today`])
                ])
          ])
        ])
      ])
    };
  }

  let account;
  try {
    account = await syncAccount();
  } catch (error) {
    return {
      node: el("div", { class: "stack stack-lg" }, [
        notice(
          "error",
          "Could not read your account",
          error?.message || "The account endpoint returned an error.",
          [el("button", { class: "btn btn-tiny btn-ghost", type: "button", "data-action": "retry" }, ["Try again"])]
        ),
        greeting
      ])
    };
  }

  const plan = account.plan === PLAN_PRO ? PLAN_PRO : PLAN_FREE;
  const isPro = plan === PLAN_PRO && account.status === SUB_ACTIVE;
  const usage = account.usage || {};
  const limit = Number(usage.dailyLimit) || state.freeDailyReplies;
  const used = Number(usage.repliesUsed || 0);
  const remaining = usage.remaining === null || usage.remaining === undefined ? null : Number(usage.remaining);

  const usageBody = isPro
    ? el("div", { class: "stack" }, [
        el("p", { class: "usage-unlimited" }, ["UNLIMITED"]),
        el("p", { class: "panel-note" }, [
          `Pro is active until ${formatDate(account.expiresAt)}. No daily counter applies.`
        ])
      ])
    : el("div", { class: "stack" }, [
        el("p", { class: "usage-figure" }, [`${used} / ${limit}`]),
        meter(used, limit),
        el("p", { class: "panel-note" }, [
          remaining === null
            ? `Remaining ${Math.max(0, limit - used)} replies today`
            : `Remaining ${remaining} ${remaining === 1 ? "reply" : "replies"} today`
        ]),
        usage.date ? el("p", { class: "panel-note panel-note-dim" }, [`usage date: ${usage.date}`]) : null
      ]);

  return {
    node: el("div", { class: "stack stack-lg" }, [
      notice(
        "success",
        "Authoritative state",
        ["Synced from ", el("span", { class: "mono" }, ["POST /account/sync"]), " just now."],
        [el("span", { class: "mono notice-code" }, [`uid: ${account.uid || user.uid}`])]
      ),
      greeting,
      el("div", { class: "stat-grid" }, [
        statCard("Plan", isPro ? "PRO" : "FREE", isPro ? "unlimited replies" : `${limit} replies / day`, isPro ? "accent" : "primary"),
        statCard("Status", String(account.status || "unknown").toUpperCase(), "from server", statusTone(account.status)),
        statCard("Expires", formatDate(account.expiresAt), account.expiresAt ? formatRelative(account.expiresAt) : "no expiry", "neutral"),
        statCard("Remaining days", isPro ? String(account.daysRemaining ?? daysLeft(account.expiresAt)) : "—", isPro ? "of this period" : "free tier has none", "neutral")
      ]),
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, [
          el("h2", { class: "panel-title" }, ["AI Replies"]),
          isPro ? statusChip("pro") : chip(`${used} / ${limit}`, "primary")
        ]),
        el("div", { class: "panel-body stack" }, [usageBody])
      ]),
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, [
          el("h2", { class: "panel-title" }, ["Upgrade"]),
          isPro ? statusChip("verified") : chip("free tier", "neutral")
        ]),
        el("div", { class: "panel-body stack" }, [
          el("p", { class: "panel-note" }, [
            isPro
              ? "Your Pro entitlement is managed on the server. Renewals are applied by an administrator after each verified payment."
              : `You are on the free tier with ${pluralise(limit, "AI reply")} per day. Pro removes the counter entirely.`
          ]),
          isPro
            ? null
            : el("div", { class: "panel-actions" }, [
                el("a", { class: "btn btn-secondary", href: href("/pricing") }, ["See Pro"]),
                el("button", {
                  class: "btn btn-ghost",
                  type: "button",
                  "data-action": "start-purchase",
                  title: "Ask the backend for a short-lived purchase session"
                }, ["Start purchase"])
              ])
        ])
      ])
    ])
  };
}

function statusTone(status) {
  const map = { active: "success", expired: "warning", none: "neutral" };
  return map[String(status)] || "neutral";
}

function daysLeft(expiresAt) {
  const ms = Number(expiresAt || 0);
  if (!ms) return 0;
  return Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));
}

/* ------------------------------------------------------------------ *
 * 5. Purchase
 * ------------------------------------------------------------------ */

async function pagePurchase() {
  const view = $("#view");
  view.textContent = "";
  const token = String(currentRoute().query.session || "").trim();

  view.appendChild(pageHead("checkout", "Upgrade to Pro", "A purchase session from ShiPu WP is required to continue."));

  if (!token) {
    view.appendChild(
      el("div", { class: "stack stack-lg" }, [
        notice(
          "warning",
          "Purchase session required",
          "This page only works with a short-lived session minted by the ShiPu WP backend. Open ShiPu WP, choose Get Pro, and let it open this link for you.",
          [el("a", { class: "btn btn-tiny btn-ghost", href: href("/dashboard") }, ["Open dashboard"])]
        ),
        el("p", { class: "fine-print" }, [
          "A raw ",
          el("span", { class: "mono" }, ["?username="]),
          " parameter is never accepted - it would let anyone pay for someone else's account."
        ])
      ])
    );
    return;
  }

  const decoded = decodeSessionToken(token);
  if (!decoded.ok) {
    view.appendChild(
      notice("error", "Invalid purchase session", "The session token could not be decoded. Generate a fresh one from ShiPu WP.")
    );
    return;
  }

  const session = decoded.payload;
  const expired = isSessionExpired(session);
  const pricing = (await loadPricing().catch(() => state.pricing)) || state.pricing;
  const durationDays = Number(pricing?.durationDays) || 30;
  const pricePublished = Boolean(pricing?.published);

  const summary = el("div", { class: "panel panel-summary" }, [
    el("div", { class: "panel-head" }, [
      el("h2", { class: "panel-title" }, ["Order summary"]),
      statusChip(PLAN_PRO)
    ]),
    el("div", { class: "panel-body stack" }, [
      dataRow("Account", `@${session.username || "unknown"}`, "accent"),
      dataRow("Plan", "PRO"),
      dataRow("Duration", pluralise(durationDays, "day")),
      dataRow(
        "Price",
        pricing?.published ? formatMoney(pricing.priceCents, pricing.currency) : "Not published yet",
        pricing?.published ? "success" : "warning"
      ),
      dataRow("Session expires", formatDateTime(session.expiresAt)),
      dataRow("Session id", el("span", { class: "mono truncate" }, [String(session.sessionId || "—")]))
    ])
  ]);

  const notices = [];

  if (expired) {
    notices.push(
      notice(
        "error",
        "Purchase session expired",
        "Sessions are valid for 10 minutes. Generate a new purchase link from ShiPu WP and open it again."
      )
    );
  }

  if (!isBackendConfigured()) {
    notices.push(
      notice(
        "warning",
        "Not configured",
        "BACKEND_URL is empty on this deployment, so payments cannot be recorded and this checkout cannot be completed.",
        [el("span", { class: "mono notice-code" }, ["POST /payments unavailable"])]
      )
    );
  }

  if (!pricePublished) {
    notices.push(
      notice(
        "warning",
        "Pro price not published",
        "No Pro price is published in the backend yet, so there is nothing to charge and this checkout cannot be completed. A ShiPu WP administrator must publish shipuwp/pricing/pro first.",
        [el("span", { class: "mono notice-code" }, ["shipuwp/pricing/pro unavailable"])]
      )
    );
  }

  if (state.user && session.uid && state.user.uid !== session.uid) {
    notices.push(
      notice(
        "error",
        "Account mismatch",
        `This session belongs to @${session.username}, but you are signed in as @${state.user.username}. Sign in with the purchasing account to continue.`
      )
    );
  }

  notices.push(
    notice(
      "info",
      "How verification works",
      `Submitting a payment records it as PENDING. A ShiPu WP administrator checks the transaction and activates ${pluralise(durationDays, "day")} of Pro. This page never marks a payment as paid.`
    )
  );

  const continueBtn = el("button", { class: "btn btn-secondary btn-lg", type: "button" }, [
    "Continue to Payment"
  ]);

  const blocked =
    expired ||
    !pricePublished ||
    !isBackendConfigured() ||
    (state.user && session.uid && state.user.uid !== session.uid);

  continueBtn.addEventListener("click", async () => {
    if (blocked) return;
    savePurchaseIntent(token);
    if (!state.user) {
      toast("Sign in to finish the purchase", "info");
      navigate("/login", { next: "/purchase" });
      return;
    }
    navigate("/payment", { session: token });
  });

  const selfService = el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h2", { class: "panel-title" }, ["No session to hand?"])]),
    el("div", { class: "panel-body stack" }, [
      el("p", { class: "panel-note" }, [
        "Signed-in users can ask the backend to mint a fresh session directly. The backend derives the account from the authentication token, so it cannot be pointed at another user."
      ]),
      el("div", { class: "panel-actions" }, [selfServiceBtn(session.plan || PLAN_PRO)])
    ])
  ]);

  view.appendChild(
    el("div", { class: "checkout" }, [
      el("div", { class: "checkout-main stack stack-lg" }, [
        summary,
        notices.length ? el("div", { class: "notice-stack" }, notices) : null,
        el("div", { class: "panel" }, [
          el("div", { class: "panel-body stack" }, [
            blocked
              ? el("p", { class: "panel-note" }, ["Continuation is disabled until the issues above are resolved."])
              : el("p", { class: "panel-note" }, [
                  state.user
                    ? `Continuing as @${state.user.username}.`
                    : "You will be asked to sign in on the next step."
                ]),
            el("div", { class: "panel-actions" }, [continueBtn])
          ])
        ])
      ]),
      el("aside", { class: "checkout-side stack stack-lg" }, [selfService])
    ])
  );

  continueBtn.disabled = blocked;

  view.appendChild(
    el("div", { class: "checkout" }, [
      el("div", { class: "checkout-main stack stack-lg" }, [
        summary,
        notices.length ? el("div", { class: "notice-stack" }, notices) : null,
        el("div", { class: "panel" }, [
          el("div", { class: "panel-body stack" }, [
            blocked
              ? el("p", { class: "panel-note" }, ["Continuation is disabled until the issues above are resolved."])
              : el("p", { class: "panel-note" }, [
                  state.user
                    ? `Continuing as @${state.user.username}.`
                    : "You will be asked to sign in on the next step."
                ]),
            el("div", { class: "panel-actions" }, [continueBtn])
          ])
        ])
      ]),
      el("aside", { class: "checkout-side stack stack-lg" }, [selfService])
    ])
  );

  function selfServiceBtn(plan) {
    const button = el("button", { class: "btn btn-ghost", type: "button" }, ["Create purchase session"]);
    button.addEventListener("click", async () => {
      if (!isBackendConfigured()) {
        toast("The ShiPu WP API is not configured on this deployment.", "error");
        return;
      }
      if (!state.user) {
        savePurchaseIntent("");
        toast("Sign in to request a purchase session", "info");
        navigate("/login", { next: "/dashboard" });
        return;
      }
      setBusy(button, true, "Requesting…");
      try {
        const result = await createPurchaseSession(plan);
        savePurchaseIntent(result.session || "");
        navigate("/purchase", { session: result.session });
      } catch (error) {
        toast(error?.message || "Could not create a purchase session.", "error");
      } finally {
        setBusy(button, false);
      }
    });
    return button;
  }
}

/* ------------------------------------------------------------------ *
 * 6. Payment submission
 * ------------------------------------------------------------------ */

async function pagePayment() {
  const view = $("#view");
  view.textContent = "";
  const token = String(currentRoute().query.session || loadPurchaseIntent()).trim();

  view.appendChild(pageHead("payment", "Submit payment", "Your payment is recorded as pending until an administrator verifies it."));

  if (!token) {
    view.appendChild(notice("warning", "Purchase session required", "Return to the upgrade page and generate a purchase session first."));
    return;
  }

  const decoded = decodeSessionToken(token);
  if (!decoded.ok) {
    view.appendChild(notice("error", "Invalid purchase session", "The session token could not be decoded."));
    return;
  }
  const session = decoded.payload;

  if (isSessionExpired(session)) {
    view.appendChild(notice("error", "Purchase session expired", "Generate a new purchase link from ShiPu WP."));
    return;
  }

  if (!state.user) {
    savePurchaseIntent(token);
    view.appendChild(signInPrompt("Sign in to submit your payment"));
    return;
  }

  if (state.user.uid !== session.uid) {
    view.appendChild(
      notice(
        "error",
        "Account mismatch",
        `You are signed in as @${state.user.username}, but this purchase session belongs to @${session.username}. Sign in with the purchasing account.`
      )
    );
    return;
  }

  if (!isBackendConfigured()) {
    view.appendChild(
      notice(
        "warning",
        "Not configured",
        "BACKEND_URL is empty, so payments cannot be recorded. Nothing will be charged and nothing will be stored."
      )
    );
  }

  const pricing = (await loadPricing().catch(() => state.pricing)) || state.pricing;
  const methods = await loadPaymentMethods().catch(() => []);
  const amount = pricing?.published ? Number(pricing.priceCents) : 0;
  const currency = currencyCode(pricing?.currency);
  const durationDays = Number(pricing?.durationDays) || 30;

  // Never let an unpriced payment reach the API: the amount must be the
  // published price, and the backend has nothing authoritative to compare to.
  if (!pricing?.published) {
    view.appendChild(
      notice(
        "warning",
        "Pro price not published",
        "There is no published Pro price on this deployment, so no payment can be recorded with a correct amount. A ShiPu WP administrator must publish shipuwp/pricing/pro first.",
        [el("a", { class: "btn btn-tiny btn-ghost", href: href("/pricing") }, ["Back to pricing"])]
      )
    );
    return;
  }

  const readonlyField = (label, value, extraClass = "") =>
    el("div", { class: `field ${extraClass}` }, [
      el("label", { class: "field-label" }, [label]),
      el("input", { class: "field-input is-readonly", type: "text", value, readonly: true, tabindex: "-1" })
    ]);

  const usernameField = readonlyField("Username", `@${session.username || state.user.username}`, "field-readonly");
  const planField = readonlyField("Plan", `PRO — ${pluralise(durationDays, "day")}`, "field-readonly");
  const amountField = readonlyField(
    "Amount",
    pricing?.published ? `${formatMoney(pricing.priceCents, pricing.currency)} (${currency})` : "Not published yet",
    "field-readonly"
  );

  const methodSelect = el(
    "select",
    { class: "field-input", id: "method", name: "method", required: true },
    [
      el("option", { value: "" }, ["Select a payment method…"]),
      ...methods.map((method) => el("option", { value: method.id }, [method.label]))
    ]
  );

  const methodHint = el("p", { class: "field-hint" }, ["Choose the method you used to send the money."]);

  const transactionInput = el("input", {
    class: "field-input",
    id: "transactionId",
    name: "transactionId",
    type: "text",
    placeholder: "e.g. 8N2K4Q7Z",
    required: true,
    spellcheck: "false",
    autocomplete: "off"
  });

  const referenceInput = el("input", {
    class: "field-input",
    id: "reference",
    name: "reference",
    type: "text",
    placeholder: "e.g. sender number or note",
    autocomplete: "off"
  });

  const proofInput = el("input", {
    class: "field-input",
    id: "proofUrl",
    name: "proofUrl",
    type: "url",
    placeholder: "https://… (optional)",
    autocomplete: "off"
  });

  const messageHost = el("div", { class: "form-message", role: "alert" });
  const submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, ["Submit payment"]);

  const form = el(
    "form",
    { class: "panel payment-form", novalidate: true },
    [
      el("div", { class: "panel-head" }, [el("h2", { class: "panel-title" }, ["Payment details"]), statusChip("pending")]),
      el("div", { class: "panel-body stack stack-lg" }, [
        el("div", { class: "field-grid" }, [usernameField, planField]),
        amountField,
        el("div", { class: "field" }, [el("label", { class: "field-label", for: "method" }, ["Payment method"]), methodSelect, methodHint]),
        el("div", { class: "field" }, [
          el("label", { class: "field-label", for: "transactionId" }, ["Transaction ID"]),
          transactionInput,
          el("p", { class: "field-hint" }, ["The reference from your payment receipt. This is what the admin will look up."])
        ]),
        el("div", { class: "field" }, [
          el("label", { class: "field-label", for: "reference" }, ["Payment reference"]),
          referenceInput,
          el("p", { class: "field-hint" }, ["Optional. Anything that helps the admin find the transaction."])
        ]),
        el("div", { class: "field" }, [
          el("label", { class: "field-label", for: "proofUrl" }, ["Payment proof URL"]),
          proofInput,
          el("p", { class: "field-hint" }, ["Optional. A link to a screenshot or receipt you can share."])
        ]),
        messageHost,
        el("div", { class: "panel-actions panel-actions-split" }, [
          el("a", { class: "btn btn-ghost", href: href("/purchase", { session: token }) }, ["Back"]),
          submit
        ])
      ])
    ]
  );

  methodSelect.addEventListener("change", () => {
    const method = methods.find((item) => item.id === methodSelect.value);
    methodHint.textContent = method?.hint || "Choose the method you used to send the money.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageHost.textContent = "";

    const method = methodSelect.value;
    const transactionId = transactionInput.value.trim();

    if (!method) {
      messageHost.appendChild(notice("error", null, "Select a payment method."));
      return;
    }
    if (!transactionId) {
      messageHost.appendChild(notice("error", null, "Transaction ID is required."));
      transactionInput.focus();
      return;
    }
    if (!isBackendConfigured()) {
      messageHost.appendChild(
        notice("warning", "Not configured", "BACKEND_URL is empty, so this payment cannot be recorded.")
      );
      return;
    }
    if (!pricing?.published || !Number.isFinite(amount) || amount <= 0) {
      messageHost.appendChild(
        notice("error", "No published price", "A payment can only be submitted against a published Pro price.")
      );
      return;
    }

    setBusy(submit, true, "Submitting…");
    try {
      const payload = {
        plan: PLAN_PRO,
        amount,
        currency,
        method,
        transactionId,
        username: session.username || state.user.username,
        // Optional context the administrator can use. The reference backend
        // ignores fields it does not model.
        reference: referenceInput.value.trim() || undefined,
        proofUrl: proofInput.value.trim() || undefined
      };
      const result = await submitPayment(payload);
      rememberPayment(result.paymentId, payload.username);
      clearPurchaseIntent();
      toast(`Payment ${result.paymentId} recorded as pending`, "success");
      navigate("/payment-pending", { id: result.paymentId });
    } catch (error) {
      const offline = error instanceof NotConfiguredError;
      messageHost.appendChild(
        notice(
          offline ? "warning" : "error",
          offline ? "Not configured" : "Could not submit the payment",
          error?.message || "The payment endpoint returned an error."
        )
      );
    } finally {
      setBusy(submit, false);
    }
  });

  view.appendChild(form);
}

/* ------------------------------------------------------------------ *
 * 7. Payment pending
 * ------------------------------------------------------------------ */

async function pagePaymentPending() {
  const view = $("#view");
  view.textContent = "";

  const paymentId = String(currentRoute().query.id || recallPayment()?.paymentId || "").trim();
  view.appendChild(pageHead("payment status", "Payment submitted successfully.", "Status: PENDING VERIFICATION."));

  if (!paymentId) {
    view.appendChild(
      notice("info", "No payment to track", "This browser has no recent payment reference, so there is nothing to refresh.")
    );
    return;
  }

  const statusHost = el("div", { class: "stack stack-lg" });
  const refreshBtn = el("button", { class: "btn btn-ghost", type: "button" }, ["Refresh Status"]);

  const render = async (first = false) => {
    statusHost.textContent = "";
    if (!first) statusHost.appendChild(busyLabel("Checking payment status…"));

    const record = state.user ? await readOwnPayment(paymentId, state.user.uid) : null;

    if (first && !record) {
      statusHost.appendChild(
        notice(
          "info",
          "Waiting for the server to store this payment",
          `No readable record for ${paymentId} yet. The write may still be propagating. Use Refresh Status in a moment.`
        )
      );
    }

    statusHost.appendChild(
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, [
          el("h2", { class: "panel-title" }, ["Payment record"]),
          statusChip(record?.status || "pending")
        ]),
        el("div", { class: "panel-body stack" }, [
          el("div", { class: "data-list" }, [
            dataRow("Payment id", el("span", { class: "mono truncate" }, [paymentId])),
            dataRow("Account", `@${record?.username || recallPayment()?.username || "—"}`, "accent"),
            dataRow("Amount", record?.amount ? `${currencyCode(record.currency)}${Number(record.amount) / 100}` : "—"),
            dataRow("Method", String(record?.method || "—").toUpperCase()),
            dataRow("Transaction id", el("span", { class: "mono" }, [String(record?.transactionId || "—")])),
            dataRow("Submitted", formatDateTime(record?.createdAt))
          ]),
          el("p", { class: "panel-note" }, [
            "A ShiPu WP administrator will verify the transaction. Pro is activated only after that verification — not before, and not by this page."
          ])
        ])
      ])
    );

    if (record?.status === PAYMENT_VERIFIED) {
      toast("Payment verified", "success");
      navigate("/payment-success", { id: paymentId });
      return;
    }
    if (record?.status === PAYMENT_REJECTED) {
      toast("Payment rejected", "error");
      navigate("/payment-failed", { id: paymentId });
    }
  };

  refreshBtn.addEventListener("click", async () => {
    setBusy(refreshBtn, true, "Refreshing…");
    await render(false);
    setBusy(refreshBtn, false);
  });

  view.appendChild(
    el("div", { class: "stack stack-lg" }, [
      notice(
        "warning",
        "Pending verification",
        "Your payment was recorded. Nothing has been activated yet, and nothing will be until an administrator confirms the transaction."
      ),
      statusHost,
      el("div", { class: "toolbar" }, [
        refreshBtn,
        el("a", { class: "btn btn-primary", href: href("/dashboard") }, ["Back to Dashboard"])
      ])
    ])
  );

  await render(true);
}

/* ------------------------------------------------------------------ *
 * 8. Payment success / failure
 * ------------------------------------------------------------------ */

async function pagePaymentSuccess() {
  const view = $("#view");
  view.textContent = "";
  const paymentId = String(currentRoute().query.id || recallPayment()?.paymentId || "").trim();

  view.appendChild(pageHead("payment status", "Payment verified.", "Status: VERIFIED."));

  if (!paymentId) {
    view.appendChild(notice("info", "No payment to check", "Open this page from the pending screen so the payment can be identified."));
    return;
  }

  const record = state.user ? await readOwnPayment(paymentId, state.user.uid) : null;

  if (!record) {
    view.appendChild(
      notice("info", "Status unavailable", `No readable record for ${paymentId}. Sign in with the submitting account to check it.`)
    );
    return;
  }

  if (record.status !== PAYMENT_VERIFIED) {
    view.appendChild(
      el("div", { class: "stack stack-lg" }, [
        notice(
          "warning",
          "Not verified yet",
          `Payment ${paymentId} is currently ${String(record.status || "pending").toUpperCase()}. This page only reports real server state, so it will not claim success.`,
          [el("a", { class: "btn btn-tiny btn-ghost", href: href("/payment-pending", { id: paymentId }) }, ["Back to status"])]
        )
      ])
    );
    return;
  }

  let expiryNote = el("p", { class: "panel-note" }, ["Your Pro entitlement is now active."]);
  if (isBackendConfigured() && state.user) {
    try {
      const account = await syncAccount();
      expiryNote = el("p", { class: "panel-note" }, [
        `Pro is active until ${formatDate(account.expiresAt)} (${pluralise(account.daysRemaining ?? daysLeft(account.expiresAt), "day")} remaining).`
      ]);
    } catch {
      /* keep the generic note; the plan itself is authoritative server-side */
    }
  }

  view.appendChild(
    el("div", { class: "stack stack-lg" }, [
      notice("success", "Verified by an administrator", "The transaction was checked and ShiPu WP Pro has been activated on the server."),
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, [
          el("h2", { class: "panel-title" }, ["Entitlement"]),
          statusChip("pro")
        ]),
        el("div", { class: "panel-body stack" }, [
          el("div", { class: "data-list" }, [
            dataRow("Account", `@${record.username || "—"}`, "accent"),
            dataRow("Payment id", el("span", { class: "mono truncate" }, [paymentId])),
            dataRow("Method", String(record.method || "—").toUpperCase()),
            dataRow("Transaction id", el("span", { class: "mono" }, [String(record.transactionId || "—")])),
            dataRow("Verified at", formatDateTime(record.verifiedAt)),
            dataRow("Expires", formatDate(record.expiresAt))
          ]),
          expiryNote
        ])
      ]),
      el("div", { class: "toolbar" }, [
        el("a", { class: "btn btn-primary", href: href("/dashboard") }, ["Back to Dashboard"]),
        el("a", { class: "btn btn-ghost", href: href("/pricing") }, ["Pricing"])
      ])
    ])
  );
}

async function pagePaymentFailed() {
  const view = $("#view");
  view.textContent = "";
  const paymentId = String(currentRoute().query.id || recallPayment()?.paymentId || "").trim();

  view.appendChild(pageHead("payment status", "Payment not approved.", "Status: REJECTED."));

  if (!paymentId) {
    view.appendChild(notice("info", "No payment to check", "Open this page from the pending screen so the payment can be identified."));
    return;
  }

  const record = state.user ? await readOwnPayment(paymentId, state.user.uid) : null;

  if (!record) {
    view.appendChild(
      notice("info", "Status unavailable", `No readable record for ${paymentId}. Sign in with the submitting account to check it.`)
    );
    return;
  }

  if (record.status !== PAYMENT_REJECTED) {
    view.appendChild(
      notice(
        "warning",
        "Not rejected",
        `Payment ${paymentId} is currently ${String(record.status || "pending").toUpperCase()}. This page reports server state only.`,
        [el("a", { class: "btn btn-tiny btn-ghost", href: href("/payment-pending", { id: paymentId }) }, ["Back to status"])]
      )
    );
    return;
  }

  view.appendChild(
    el("div", { class: "stack stack-lg" }, [
      notice(
        "error",
        "The administrator did not approve this payment",
        record.reason
          ? `Reason given: ${record.reason}`
          : "No reason was recorded. Contact support with your transaction ID if you believe this is a mistake.",
        [el("span", { class: "mono notice-code" }, [`txn: ${record.transactionId || "—"}`])]
      ),
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, [
          el("h2", { class: "panel-title" }, ["Payment record"]),
          statusChip("rejected")
        ]),
        el("div", { class: "panel-body stack" }, [
          el("div", { class: "data-list" }, [
            dataRow("Account", `@${record.username || "—"}`, "accent"),
            dataRow("Payment id", el("span", { class: "mono truncate" }, [paymentId])),
            dataRow("Amount", record.amount ? `${currencyCode(record.currency)}${Number(record.amount) / 100}` : "—"),
            dataRow("Transaction id", el("span", { class: "mono" }, [String(record.transactionId || "—")])),
            dataRow("Submitted", formatDateTime(record.createdAt)),
            dataRow("Reviewed", formatDateTime(record.verifiedAt))
          ])
        ])
      ]),
      el("div", { class: "toolbar" }, [
        el("a", { class: "btn btn-primary", href: href("/dashboard") }, ["Back to Dashboard"]),
        el("a", { class: "btn btn-ghost", href: href("/purchase") }, ["Try again"])
      ])
    ])
  );
}

/* ------------------------------------------------------------------ *
 * 404
 * ------------------------------------------------------------------ */

function pageNotFound() {
  const view = $("#view");
  view.textContent = "";
  view.appendChild(
    el("div", { class: "stack stack-lg" }, [
      el("div", { class: "empty-panel" }, [
        el("span", { class: "empty-mark", "aria-hidden": "true" }, ["[ 404 ]"]),
        el("h2", { class: "empty-title" }, ["No such route"]),
        el("p", { class: "empty-text" }, [`Nothing is mounted at ${currentRoute().path}.`]),
        el("div", { class: "empty-actions" }, [
          el("a", { class: "btn btn-primary", href: href("/") }, ["Back home"]),
          el("a", { class: "btn btn-ghost", href: href("/pricing") }, ["Pricing"])
        ])
      ])
    ])
  );
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function wireShell() {
  $("#auth-action")?.addEventListener("click", async () => {
    const action = $("#auth-action").dataset.action;
    if (action === "signout") {
      await signOutUser();
      toast("Signed out", "info");
      navigate("/");
    } else {
      navigate("/login");
    }
  });

  $("#nav-toggle")?.addEventListener("click", () => {
    const nav = $(".site-nav");
    const open = nav.classList.toggle("is-open");
    $("#nav-toggle").setAttribute("aria-expanded", String(open));
  });

  $("#year") && ($("#year").textContent = String(new Date().getFullYear()));

  // "Start purchase" on the dashboard.
  $("#view")?.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action='start-purchase']");
    if (!action) return;
    if (!isBackendConfigured()) {
      toast("The ShiPu WP API is not configured on this deployment.", "error");
      return;
    }
    if (!state.user) {
      navigate("/login", { next: "/dashboard" });
      return;
    }
    setBusy(action, true, "Requesting…");
    try {
      const result = await createPurchaseSession(PLAN_PRO);
      savePurchaseIntent(result.session || "");
      navigate("/purchase", { session: result.session });
    } catch (error) {
      toast(error?.message || "Could not create a purchase session.", "error");
    } finally {
      setBusy(action, false);
    }
  });

  $("#view")?.addEventListener("click", async (event) => {
    const retry = event.target.closest("[data-action='retry']");
    if (!retry) return;
    retry.disabled = true;
    await pageDashboard();
  });
}

async function boot() {
  wireShell();
  mountWordmarks(document);
  renderFooterStatus();

  // Warm the shared configuration so every page shows real numbers.
  state.freeDailyReplies = await loadFreeDailyReplies().catch(() => 25);
  state.pricing = await loadPricing().catch(() => null);

  route("/", pageHome);
  route("/pricing", pagePricing);
  route("/login", pageLogin);
  route("/register", pageRegister);
  route("/dashboard", pageDashboard);
  route("/purchase", pagePurchase);
  route("/payment", pagePayment);
  route("/payment-pending", pagePaymentPending);
  route("/payment-success", pagePaymentSuccess);
  route("/payment-failed", pagePaymentFailed);
  setNotFound(pageNotFound);

  onUserChanged((user) => {
    state.user = user;
    paintAuthChrome();
    // Re-render so gated pages pick up the new session.
    refresh();
  });

  start();
  markActiveNav();

  // Highlight the active nav item after every navigation.
  window.addEventListener("hashchange", () => window.setTimeout(markActiveNav, 0));
}

boot();