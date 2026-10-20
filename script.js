"use strict";

/* ============================================================
   PROFITLY — BUSINESS FINANCIAL OS
   script.js
   ============================================================
   PRINCIPLES
   ------------------------------------------------------------
   1. PostgreSQL/backend is the financial source of truth.
   2. localStorage is used only for session/UI preferences.
   3. No fake financial records are generated.
   4. Every business-scoped request uses the selected business.
   5. Rendering tolerates multiple reasonable API response shapes.
   6. UI state is separated from server financial state.
   7. Stale async responses are ignored with version counters.
   8. OAuth credentials are never invented client-side.
   9. Missing financial data produces zero/empty states, not fake data.
   ============================================================ */


/* ============================================================
   01. CONFIG
   ============================================================ */

const API_URL = (
    document.querySelector('meta[name="profitly-api-url"]')?.content ||
    window.PROFITLY_API_URL ||
    "http://localhost:3000/api/v1"
).replace(/\/+$/, "");

const STORAGE_KEYS = {
    token: "profitly_token",
    refreshToken: "profitly_refresh_token",
    accountId: "profitly_account_id",
    businessId: "profitly_business_id",
    sound: "profitly_sound",
    soundVolume: "profitly_sound_volume",
    reducedMotion: "profitly_reduced_motion",
    language: "profitly_language"
};

const SUPPORTED_CURRENCIES = [
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "CAD",
    "AUD",
    "CHF",
    "CNY"
];

const SUPPORTED_LANGUAGES = [
    "en-US",
    "en-GB",
    "es-ES",
    "fr-FR",
    "de-DE",
    "it-IT",
    "pt-BR",
    "ja-JP",
    "ko-KR"
];

const PERIODS = {
    1: "Today",
    7: "Last 7 days",
    30: "Last 30 days",
    90: "Last 3 months",
    180: "Last 6 months",
    365: "Last year"
};

const SECTION_TITLES = {
    overview: "Overview",
    transactions: "Transactions",
    products: "Products",
    expenses: "Expenses",
    analytics: "Analytics",
    goals: "Goals",
    reports: "Reports",
    settings: "Settings"
};


/* ============================================================
   02. STATE
   ============================================================ */

const state = {
    token: localStorage.getItem(STORAGE_KEYS.token) || null,
    refreshToken:
        localStorage.getItem(STORAGE_KEYS.refreshToken) || null,

    accountId:
        localStorage.getItem(STORAGE_KEYS.accountId) || null,

    user: null,
    account: null,

    businesses: [],

    selectedBusinessId:
        localStorage.getItem(STORAGE_KEYS.businessId) || null,

    transactions: [],
    products: [],
    expenses: [],
    goals: [],
    expenseCategories: [],
    analytics: null,

    periodDays: 30,
    customRange: null,

    transactionSearch: "",
    transactionFilter: "all",

    analyticsRanking: "profit",

    activeSection: "overview",
    activeSettingsTab: "account",

    loadingBusinessData: false,
    businessLoadVersion: 0,
    analyticsLoadVersion: 0,

    refreshPromise: null,

    resourceState: new Map(),

    editingProductId: null,

    pendingConfirmation: null,

    authMode: "login",

    soundEnabled:
        localStorage.getItem(STORAGE_KEYS.sound) !== "off",

    soundVolume: clamp(
        Number(
            localStorage.getItem(STORAGE_KEYS.soundVolume) ?? "0.35"
        ),
        0,
        1
    ),

    reducedMotion:
        localStorage.getItem(STORAGE_KEYS.reducedMotion) === "on" ||
        window.matchMedia?.(
            "(prefers-reduced-motion: reduce)"
        )?.matches === true,

    language: normalizeLanguage(
        localStorage.getItem(STORAGE_KEYS.language) ||
        navigator.language ||
        "en-US"
    ),

    audioContext: null,

    landingEnvironment: {
        renderer: null,
        scene: null,
        camera: null,
        points: null,
        line: null,
        raf: null,
        resizeObserver: null,
        initialized: false
    },

    landingMobileMenuOpen: false,

    toastTimer: null,

    searchIndex: [],

    currentSearchQuery: "",

    modalStack: [],

    lastKnownFocusedElement: null
};

function normalizeLanguage(value) {
    const raw = String(value ?? "").trim();

    if (!raw) {
        return "en-US";
    }

    const exact =
        SUPPORTED_LANGUAGES.find(
            language =>
                language.toLowerCase() === raw.toLowerCase()
        );

    if (exact) {
        return exact;
    }

    const languageCode =
        raw.split("-")[0].toLowerCase();

    const fallback =
        SUPPORTED_LANGUAGES.find(
            language =>
                language.split("-")[0].toLowerCase() ===
                languageCode
        );

    return fallback || "en-US";
}

/* ============================================================
   OAUTH CALLBACK
============================================================ */


function selectedLocale() {
    return normalizeLanguage(
        state.language ||
        navigator.language ||
        "en-US"
    );
}

function applyLanguagePreference() {
    const locale = selectedLocale();

    state.language = locale;
    document.documentElement.lang = locale;

    const languageSelect = $("settingsLanguage");

    if (languageSelect && languageSelect.value !== locale) {
        languageSelect.value = locale;
    }
}


/* ============================================================
   03. DOM HELPERS
   ============================================================ */

function $(id) {
    return document.getElementById(id);
}

function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

function exists(element) {
    return Boolean(element);
}

function setText(elementOrId, value) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    element.textContent =
        value === null || value === undefined
            ? ""
            : String(value);
}

function setHTML(elementOrId, value) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    element.innerHTML =
        value === null || value === undefined
            ? ""
            : String(value);
}

function show(elementOrId) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    element.hidden = false;
    element.removeAttribute("aria-hidden");
}

function hide(elementOrId) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
}

function toggleVisibility(elementOrId, visible) {
    if (visible) {
        show(elementOrId);
    } else {
        hide(elementOrId);
    }
}

function addClass(elementOrId, className) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    element?.classList.add(className);
}

function removeClass(elementOrId, className) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    element?.classList.remove(className);
}

function toggleClass(elementOrId, className, force) {
    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    element.classList.toggle(className, force);
}


/* ============================================================
   04. GENERAL UTILITIES
   ============================================================ */

function clamp(value, min, max) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return min;
    }

    return Math.min(
        max,
        Math.max(min, numberValue)
    );
}

function number(value, fallback = 0) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return fallback;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : fallback;
}

function integer(value, fallback = 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? Math.trunc(parsed)
        : fallback;
}

function today() {
    const date = new Date();

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function sleep(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

function isObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function safeArray(value) {
    return Array.isArray(value)
        ? value
        : [];
}

function unique(values) {
    return [...new Set(values)];
}

function lower(value) {
    return String(value ?? "").trim().toLowerCase();
}

function titleCase(value) {
    return String(value ?? "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(
            /\w\S*/g,
            word =>
                word.charAt(0).toUpperCase() +
                word.slice(1).toLowerCase()
        );
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatNumber(value, maximumFractionDigits = 0) {
    return new Intl.NumberFormat(
        selectedLocale(),
        {
            maximumFractionDigits,
            minimumFractionDigits: 0
        }
    ).format(number(value));
}

function formatPercent(value, digits = 1) {
    const parsed = number(value);

    if (!Number.isFinite(parsed)) {
        return "—";
    }

    return `${parsed.toFixed(digits)}%`;
}

function formatChangePercent(value) {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    ) {
        return "—";
    }

    const n = Number(value);

    if (Math.abs(n) < 0.005) {
        return "0%";
    }

    const prefix = n > 0 ? "+" : "";

    return `${prefix}${n.toFixed(
        Math.abs(n) >= 10 ? 0 : 1
    )}%`;
}

function initials(name) {
    const value = String(name ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!value.length) {
        return "P";
    }

    if (value.length === 1) {
        return value[0]
            .slice(0, 2)
            .toUpperCase();
    }

    return (
        value[0].charAt(0) +
        value[value.length - 1].charAt(0)
    ).toUpperCase();
}

function slug(value) {
    return String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


/* ============================================================
   05. DATE HELPERS
   ============================================================ */

function parseDateOnly(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? null
            : value;
    }

    const stringValue = String(value);

    const dateOnlyMatch =
        stringValue.match(
            /^(\d{4})-(\d{2})-(\d{2})$/
        );

    if (dateOnlyMatch) {
        const year = Number(dateOnlyMatch[1]);
        const month = Number(dateOnlyMatch[2]) - 1;
        const day = Number(dateOnlyMatch[3]);

        const localDate =
            new Date(year, month, day);

        return Number.isNaN(localDate.getTime())
            ? null
            : localDate;
    }

    const parsed = new Date(stringValue);

    return Number.isNaN(parsed.getTime())
        ? null
        : parsed;
}

function localDateKey(value) {
    const date =
        parseDateOnly(value);

    if (!date) {
        return null;
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function validDate(value) {
    return Boolean(
        parseDateOnly(value)
    );
}

function formatDate(value, options = {}) {
    const date =
        parseDateOnly(value);

    if (!date) {
        return "—";
    }

    const defaults = {
        year: "numeric",
        month: "short",
        day: "numeric"
    };

    return new Intl.DateTimeFormat(
        selectedLocale(),
        {
            ...defaults,
            ...options
        }
    ).format(date);
}

function getDateDaysAgo(days) {
    const date = new Date();

    date.setHours(
        0,
        0,
        0,
        0
    );

    date.setDate(
        date.getDate() - Math.max(0, days - 1)
    );

    return date;
}

function dateToISODate(date) {
    if (!(date instanceof Date)) {
        return null;
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function getActiveBounds() {
    if (
        state.customRange?.from &&
        state.customRange?.to
    ) {
        return {
            from:
                state.customRange.from,
            to:
                state.customRange.to
        };
    }

    const from =
        dateToISODate(
            getDateDaysAgo(state.periodDays)
        );

    return {
        from,
        to: today()
    };
}

function rangeBounds() {
    return getActiveBounds();
}

function inRange(value, from, to) {
    const key = localDateKey(value);

    if (!key) return false;

    const start =
        localDateKey(from);

    const end =
        localDateKey(to);

    if (!start || !end) {
        return false;
    }

    return key >= start && key <= end;
}


/* ============================================================
   06. CURRENCY
   ============================================================ */

function currencyExponent(currency) {
    return String(currency || "USD").toUpperCase() === "JPY"
        ? 0
        : 2;
}

function toMinor(value, currency = "USD") {
    const exponent = currencyExponent(currency);

    const normalized = String(value ?? "")
        .trim()
        .replace(",", ".");

    const numericValue = Number(normalized);

    if (!Number.isFinite(numericValue) || numericValue < 0) {
        return 0;
    }

    const factor = 10 ** exponent;

    return Math.round(numericValue * factor);
}

function fromMinor(value, currency = "USD") {
    const exponent =
        currencyExponent(currency);

    return (
        number(value) /
        10 ** exponent
    );
}

function currencySymbol(currency) {
    const symbols = {
        USD: "$",
        EUR: "€",
        GBP: "£",
        JPY: "¥",
        CAD: "CA$",
        AUD: "A$",
        CHF: "CHF ",
        CNY: "CN¥"
    };

    return symbols[
        String(currency || "USD").toUpperCase()
    ] || String(currency || "USD");
}

function formatCurrency(
    value,
    currency = "USD",
    options = {}
) {
    const amount = number(value);

    const defaults = {
        style: "currency",
        currency: String(currency || "USD")
            .toUpperCase(),
        minimumFractionDigits:
            currencyExponent(currency),
        maximumFractionDigits:
            currencyExponent(currency)
    };

    try {
        return new Intl.NumberFormat(
            selectedLocale(),
            {
                ...defaults,
                ...options
            }
        ).format(amount);
    } catch {
        return `${currencySymbol(currency)}${amount.toFixed(
            currencyExponent(currency)
        )}`;
    }
}

function formatMinorCurrency(
    minorValue,
    currency = "USD",
    options = {}
) {
    return formatCurrency(
        fromMinor(
            minorValue,
            currency
        ),
        currency,
        options
    );
}

function compactMoney(
    value,
    currency = "USD"
) {
    const amount = number(value);
    const symbol = currencySymbol(currency);

    const abs = Math.abs(amount);

    if (abs >= 1_000_000_000) {
        return (
            symbol +
            (amount / 1_000_000_000)
                .toFixed(1) +
            "B"
        );
    }

    if (abs >= 1_000_000) {
        return (
            symbol +
            (amount / 1_000_000)
                .toFixed(1) +
            "M"
        );
    }

    if (abs >= 1_000) {
        return (
            symbol +
            (amount / 1_000)
                .toFixed(1) +
            "K"
        );
    }

    return formatCurrency(
        amount,
        currency
    );
}

function supportedCurrency(value) {
    const currency =
        String(value || "")
            .toUpperCase();

    return SUPPORTED_CURRENCIES.includes(
        currency
    )
        ? currency
        : "USD";
}

function businessCurrency() {
    return supportedCurrency(
        selectedBusiness()?.baseCurrency ||
        selectedBusiness()?.currency ||
        "USD"
    );
}

function updateCurrencyUI() {

    const currency =
        businessCurrency();

    $$(".js-business-currency")
        .forEach(element => {
            setText(
                element,
                currency
            );
        });

    const currencyFields = [
        $("productCurrency"),
        $("goalCurrency")
    ];

    currencyFields.forEach(field => {
        if (!field) return;

        if (
            [...field.options]
                .some(
                    option =>
                        option.value === currency
                )
        ) {
            field.value =
                field.id === "productCurrency"
                    ? field.value || currency
                    : currency;
        }
    });

    syncTransactionCurrencyUI();
}


/* ============================================================
   07. BUSINESS STATE
   ============================================================ */

function selectedBusiness() {
    return state.businesses.find(
        business =>
            String(business.id) ===
            String(state.selectedBusinessId)
    ) || null;
}

function hasBusiness() {
    return Boolean(
        selectedBusiness()
    );
}

function persistBusinessSelection() {

    if (state.selectedBusinessId) {
        localStorage.setItem(
            STORAGE_KEYS.businessId,
            state.selectedBusinessId
        );
    } else {
        localStorage.removeItem(
            STORAGE_KEYS.businessId
        );
    }
}

function clearBusinessData() {

    state.transactions = [];
    state.products = [];
    state.expenses = [];
    state.goals = [];
    state.expenseCategories = [];
    state.analytics = null;

    state.resourceState.clear();

    renderAllBusinessData();
}

function getBusinessId() {

    const business =
        selectedBusiness();

    return business?.id || null;
}


/* ============================================================
   08. API NORMALIZATION
   ============================================================ */

function unwrap(payload) {

    if (
        payload &&
        isObject(payload) &&
        "data" in payload
    ) {
        return payload.data;
    }

    return payload;
}

function extractArray(payload, keys = []) {

    const data = unwrap(payload);

    if (Array.isArray(data)) {
        return data;
    }

    if (
        data &&
        isObject(data)
    ) {
        for (const key of keys) {
            if (Array.isArray(data[key])) {
                return data[key];
            }
        }
    }

    return [];
}

function extractEntity(payload, keys = []) {

    const data = unwrap(payload);

    if (!data) {
        return null;
    }

    if (
        isObject(data) &&
        keys.length
    ) {
        for (const key of keys) {
            if (
                data[key] &&
                isObject(data[key])
            ) {
                return data[key];
            }
        }
    }

    return isObject(data)
        ? data
        : null;
}

function sessionFromPayload(payload) {

    const data =
        unwrap(payload) || {};

    const tokens =
        data.tokens || {};

    return {
        user:
            data.user ||
            null,

        account:
            data.account ||
            null,

        accounts:
            safeArray(
                data.accounts
            ),

        accessToken:
            tokens.accessToken ||
            data.accessToken ||
            null,

        refreshToken:
            tokens.refreshToken ||
            data.refreshToken ||
            null
    };
}


/* ============================================================
   09. SESSION
   ============================================================ */

function persistSession(session) {

    if (
        session.accessToken
    ) {
        state.token =
            session.accessToken;

        localStorage.setItem(
            STORAGE_KEYS.token,
            state.token
        );
    }

    if (
        session.refreshToken
    ) {
        state.refreshToken =
            session.refreshToken;

        localStorage.setItem(
            STORAGE_KEYS.refreshToken,
            state.refreshToken
        );
    }

    if (
        session.account?.id
    ) {
        state.accountId =
            session.account.id;

        localStorage.setItem(
            STORAGE_KEYS.accountId,
            String(
                state.accountId
            )
        );
    }

    if (session.user) {
        state.user =
            session.user;
    }

    if (session.account) {
        state.account =
            session.account;
    }
}

function clearSession() {

    state.token = null;
    state.refreshToken = null;
    state.accountId = null;

    state.user = null;
    state.account = null;

    state.businesses = [];

    state.selectedBusinessId =
        null;

    clearBusinessData();

    localStorage.removeItem(
        STORAGE_KEYS.token
    );

    localStorage.removeItem(
        STORAGE_KEYS.refreshToken
    );

    localStorage.removeItem(
        STORAGE_KEYS.accountId
    );

    localStorage.removeItem(
        STORAGE_KEYS.businessId
    );
}

async function refreshSession() {

    if (state.refreshPromise) {
        return state.refreshPromise;
    }

    const refreshToken =
        localStorage.getItem(
            STORAGE_KEYS.refreshToken
        ) ||
        state.refreshToken;

    if (!refreshToken) {
        const error =
            new Error(
                "Your session has expired. Please log in again."
            );

        error.status = 401;

        throw error;
    }

    state.refreshToken =
        refreshToken;

    state.refreshPromise =
        (async () => {

            try {

                const response =
                    await fetch(
                        `${API_URL}/auth/refresh`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    refreshToken
                                })
                        }
                    );

                const payload =
                    await parseResponseJSON(
                        response
                    );

                if (!response.ok) {
                    throw createAPIError(
                        payload,
                        response.status
                    );
                }

                const session =
                    sessionFromPayload(
                        payload
                    );

                if (
                    !session.accessToken ||
                    !session.refreshToken
                ) {
                    const error =
                        new Error(
                            "Unable to renew your session. Please log in again."
                        );

                    error.status = 401;

                    throw error;
                }

                persistSession(
                    session
                );

                return session;

            } catch (error) {

                if (
                    error.status === 401 ||
                    error.status === 403
                ) {
                    clearSession();
                }

                throw error;

            } finally {

                state.refreshPromise =
                    null;
            }

        })();

    return state.refreshPromise;
}


/* ============================================================
   10. API ERROR / RESPONSE
   ============================================================ */

async function parseResponseJSON(response) {

    const contentType =
        response.headers.get(
            "content-type"
        ) || "";

    if (
        contentType.includes(
            "application/json"
        )
    ) {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    const text =
        await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return {
            raw: text
        };
    }
}

function createAPIError(
    payload,
    status
) {

    const message =
        payload?.error?.message ||
        payload?.message ||
        payload?.error ||
        payload?.raw ||
        `Request failed with status ${status}`;

    const error =
        new Error(
            String(message)
        );

    error.status =
        status;

    error.payload =
        payload;

    error.requestId =
        payload?.requestId ||
        null;

    return error;
}

async function apiRequest(
    path,
    options = {},
    retryAfterRefresh = true
) {

    const storedToken =
        localStorage.getItem(
            STORAGE_KEYS.token
        );

    if (storedToken) {
        state.token = storedToken;
    }

    const headers = {
        ...(options.headers || {})
    };

    if (
        options.body &&
        !headers["Content-Type"] &&
        !headers["content-type"]
    ) {
        headers["Content-Type"] =
            "application/json";
    }

    if (state.token) {
        headers.Authorization =
            `Bearer ${state.token}`;
    }

    let response;

    try {

        response =
            await fetch(
                `${API_URL}${path}`,
                {
                    ...options,
                    headers
                }
            );

    } catch (error) {

        const networkError =
            new Error(
                "Unable to connect to Profitly API."
            );

        networkError.cause =
            error;

        throw networkError;
    }

    const payload =
        await parseResponseJSON(
            response
        );

    if (
        response.status === 401 &&
        payload?.error?.code === "UNAUTHORIZED" &&
        retryAfterRefresh
    ) {

        const latestToken =
            localStorage.getItem(
                STORAGE_KEYS.token
            );

        if (
            latestToken &&
            latestToken !== state.token
        ) {
            state.token =
                latestToken;

            return apiRequest(
                path,
                options,
                false
            );
        }

        try {

            await refreshSession();

            return apiRequest(
                path,
                options,
                false
            );

        } catch (refreshError) {

            if (
                refreshError.status === 401 ||
                refreshError.status === 403
            ) {
                clearSession();
                showAuthScreen("login");
            }

            throw refreshError;
        }
    }

    if (!response.ok) {
        throw createAPIError(
            payload,
            response.status
        );
    }

    return payload;
}


/* ============================================================
   11. AUTHENTICATION
   ============================================================ */

function showLanding() {

    const landing =
        $("landingPage");

    const loginSection =
        $("loginSection");

    const mainApp =
        $("mainApp");

    if (landing) {
        landing.hidden = false;
    }

    if (loginSection) {
        loginSection.hidden = true;
    }

    if (mainApp) {
        mainApp.hidden = true;
    }

    closeAllModals();

    document.body.classList.remove(
        "app-authenticated"
    );
}

function showAuthScreen(
    mode = "login"
) {

    state.authMode =
        mode === "register"
            ? "register"
            : "login";

    const landing =
        $("landingPage");

    const loginSection =
        $("loginSection");

    const mainApp =
        $("mainApp");

    if (landing) {
        landing.hidden = true;
    }

    if (mainApp) {
        mainApp.hidden = true;
    }

    if (loginSection) {
        loginSection.hidden = false;
    }

    syncAuthMode();

    document.body.classList.remove(
        "app-authenticated"
    );

    window.scrollTo({
        top: 0,
        behavior:
            state.reducedMotion
                ? "auto"
                : "smooth"
    });

    const email =
        $("authEmail");

    if (email) {
        setTimeout(
            () => email.focus(),
            50
        );
    }
}

function cleanupLandingEnvironment() {

    const env =
        state.landingEnvironment;

    if (env.raf) {
        cancelAnimationFrame(env.raf);
        env.raf = null;
    }

    if (env.resizeObserver) {
        window.removeEventListener(
            "resize",
            env.resizeObserver
        );
        env.resizeObserver = null;
    }

    if (env.renderer) {
        env.renderer.dispose();
        env.renderer = null;
    }

    if (env.points) {
        env.points.geometry?.dispose();
        env.points.material?.dispose();
        env.points = null;
    }

    if (env.line) {
        env.line.geometry?.dispose();
        env.line.material?.dispose();
        env.line = null;
    }

    if (env.scene) {
        env.scene.clear();
        env.scene = null;
    }

    env.camera = null;
    env.initialized = false;
}

function showApp() {

    const landing =
        $("landingPage");

    const loginSection =
        $("loginSection");

    const mainApp =
        $("mainApp");

    if (landing) {
        landing.hidden = true;
        cleanupLandingEnvironment();
    }

    if (loginSection) {
        loginSection.hidden = true;
    }

    if (mainApp) {
        mainApp.hidden = false;
    }

    document.body.classList.add(
        "app-authenticated"
    );
}

function authMessage(
    message,
    isError = false
) {

    const status =
        $("authStatus");

    if (!status) return;

    setText(
        status,
        message
    );

    status.classList.toggle(
        "error",
        isError
    );

    status.classList.toggle(
        "success",
        !isError && Boolean(message)
    );
}

function syncAuthMode() {

    const mode =
        state.authMode;

    const loginTab =
        $("authLoginTab");

    const registerTab =
        $("authRegisterTab");

    const nameField =
        $("authNameField");

    const confirmField =
        $("authConfirmPasswordField");

    const heading =
        $("authHeading");

    const description =
        $("authDescription");

    const kicker =
        $("authKicker");

    const submit =
        $("authSubmitButton");

    const forgot =
        $("forgotPasswordButton");

    if (loginTab) {
        toggleClass(
            loginTab,
            "active",
            mode === "login"
        );

        loginTab.setAttribute(
            "aria-selected",
            mode === "login"
                ? "true"
                : "false"
        );
    }

    if (registerTab) {
        toggleClass(
            registerTab,
            "active",
            mode === "register"
        );

        registerTab.setAttribute(
            "aria-selected",
            mode === "register"
                ? "true"
                : "false"
        );
    }

    toggleVisibility(
        nameField,
        mode === "register"
    );

    toggleVisibility(
        confirmField,
        mode === "register"
    );

    toggleVisibility(
        forgot,
        mode === "login"
    );

    setText(
        kicker,
        mode === "login"
            ? "WELCOME BACK"
            : "START BUILDING"
    );

    setText(
        heading,
        mode === "login"
            ? "Sign in to Profitly"
            : "Create your Profitly account"
    );

    setText(
        description,
        mode === "login"
            ? "Access your financial workspace."
            : "Create your account and start building your financial system."
    );

    setText(
        submit,
        mode === "login"
            ? "Log in"
            : "Create account"
    );

    authMessage("");
}

function validateEmail(
    email
) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(
            String(email)
                .trim()
        );
}

function validatePassword(
    password
) {
    return String(password || "")
        .length >= 8;
}

async function login() {

    const email =
        $("authEmail")?.value.trim();

    const password =
        $("authPassword")?.value || "";

    if (!validateEmail(email)) {
        authMessage(
            "Enter a valid email address.",
            true
        );
        return;
    }

    if (!validatePassword(password)) {
        authMessage(
            "Password must contain at least 8 characters.",
            true
        );
        return;
    }

    const submit =
        $("authSubmitButton");

    setBusy(
        submit,
        true,
        "Logging in..."
    );

    authMessage("");

    try {

        const payload =
            await apiRequest(
                "/auth/login",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify({
                            email,
                            password
                        })
                },
                false
            );

        const session =
            sessionFromPayload(
                payload
            );

        if (
            !session.accessToken
        ) {
            throw new Error(
                "Authentication succeeded but no access token was returned."
            );
        }

        persistSession(
            session
        );

        await completeAuthentication();

    } catch (error) {

        console.error(
            "Profitly login failed:",
            error
        );

        authMessage(
            error.message ||
                "Unable to log in.",
            true
        );

    } finally {

        setBusy(
            submit,
            false
        );
    }
}

async function register() {

    const name =
        $("authName")?.value.trim();

    const email =
        $("authEmail")?.value.trim();

    const password =
        $("authPassword")?.value || "";

    const confirmPassword =
        $("authConfirmPassword")?.value || "";

    if (!name) {
        authMessage(
            "Enter your name.",
            true
        );
        return;
    }

    if (!validateEmail(email)) {
        authMessage(
            "Enter a valid email address.",
            true
        );
        return;
    }

    if (!validatePassword(password)) {
        authMessage(
            "Password must contain at least 8 characters.",
            true
        );
        return;
    }

    if (
        password !==
        confirmPassword
    ) {
        authMessage(
            "Passwords do not match.",
            true
        );
        return;
    }

    const submit =
        $("authSubmitButton");

    setBusy(
        submit,
        true,
        "Creating account..."
    );

    authMessage("");

    try {

        const payload =
            await apiRequest(
                "/auth/register",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify({
                            name,
                            email,
                            password
                        })
                },
                false
            );

        const session =
            sessionFromPayload(
                payload
            );

        if (
            session.accessToken
        ) {
            persistSession(
                session
            );

            await completeAuthentication();

        } else {

            state.authMode =
                "login";

            syncAuthMode();

            const emailField =
                $("authEmail");

            const status =
                $("authStatus");

            if (emailField) {
                emailField.value =
                    email;
            }

            setText(
                status,
                "Account created. Check your email if verification is required, then log in."
            );

            status.classList.add(
                "success"
            );
        }

    } catch (error) {

        console.error(
            "Profitly registration failed:",
            error
        );

        authMessage(
            error.message ||
                "Unable to create account.",
            true
        );

    } finally {

        setBusy(
            submit,
            false
        );
    }
}

async function completeAuthentication() {

    showApp();

    await loadCurrentUser();

    updateProfileUI();

    await loadBusinesses();

    const requestedSection =
        getSectionFromHash();

    openSection(
        requestedSection ||
            "overview",
        false
    );

    toast(
        "Welcome to Profitly."
    );
}

async function logout() {

    try {

        if (
            state.refreshToken ||
            state.token
        ) {

            await apiRequest(
                "/auth/logout",
                {
                    method: "POST",
                    body:
                        JSON.stringify({
                            refreshToken:
                                state.refreshToken
                        })
                },
                false
            );

        }

    } catch (error) {

        console.warn(
            "Logout request failed:",
            error
        );

    } finally {

        clearSession();

        showLanding();

        closeLandingMobileMenu();

        window.location.hash = "";

        toast(
            "You have been logged out."
        );
    }
}


/* ============================================================
   12. BUSINESS LOADING
   ============================================================ */

async function loadBusinesses() {

    if (
        !state.token ||
        !state.accountId
    ) {
        showAuthScreen("login");
        return;
    }

    try {

        setTopbarBusy(
            true
        );

        const payload =
            await apiRequest(
                `/accounts/${encodeURIComponent(
                    state.accountId
                )}/businesses`
            );

        const businesses =
            extractArray(
                payload,
                [
                    "businesses",
                    "items",
                    "results"
                ]
            );

        state.businesses =
            businesses;

        if (
            !state.businesses.some(
                business =>
                    String(business.id) ===
                    String(
                        state.selectedBusinessId
                    )
            )
        ) {
            state.selectedBusinessId =
                state.businesses[0]?.id ||
                null;

            persistBusinessSelection();
        }

        renderBusinesses();

        updateProfileUI();

        if (
            state.selectedBusinessId
        ) {
            await loadBusinessData();
        } else {

            clearBusinessData();

            renderBusinessEmptyState();

        }

    } catch (error) {

        console.error(
            "Failed to load businesses:",
            error
        );

        if (error.status === 401) {
            clearSession();
            showAuthScreen("login");
        } else {

            setSectionState(
                "overview",
                "error",
                "Unable to load businesses.",
                error.message
            );

            toast(
                error.message ||
                    "Unable to load businesses."
            );
        }

    } finally {

        setTopbarBusy(
            false
        );
    }
}

function renderBusinesses() {

    const list =
        $("businessList");

    if (!list) return;

    list.replaceChildren();

    if (
        !state.businesses.length
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "business-empty";

        empty.textContent =
            "No businesses yet.";

        list.appendChild(
            empty
        );

        updateBusinessSwitcher();

        return;
    }

    state.businesses.forEach(
        business => {

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "business-list-item";

            if (
                String(business.id) ===
                String(
                    state.selectedBusinessId
                )
            ) {
                button.classList.add(
                    "active"
                );
            }

            button.dataset.businessId =
                String(
                    business.id
                );

            const avatar =
                document.createElement(
                    "span"
                );

            avatar.className =
                "business-list-avatar";

            avatar.textContent =
                initials(
                    business.name
                );

            const copy =
                document.createElement(
                    "span"
                );

            copy.className =
                "business-list-copy";

            const name =
                document.createElement(
                    "strong"
                );

            name.textContent =
                business.name ||
                "Business";

            const currency =
                document.createElement(
                    "small"
                );

            currency.textContent =
                supportedCurrency(
                    business.baseCurrency ||
                    business.currency
                );

            copy.append(
                name,
                currency
            );

            const selected =
                document.createElement(
                    "span"
                );

            selected.className =
                "business-list-check";

            selected.textContent =
                String(business.id) ===
                String(
                    state.selectedBusinessId
                )
                    ? "✓"
                    : "";

            button.append(
                avatar,
                copy,
                selected
            );

            list.appendChild(
                button
            );
        }
    );

    updateBusinessSwitcher();
}

function updateBusinessSwitcher() {

    const business =
        selectedBusiness();

    const avatar =
        $("businessSwitcherAvatar");

    const name =
        $("businessSwitcherName");

    const currency =
        $("businessSwitcherCurrency");

    if (!business) {

        setText(
            avatar,
            "B"
        );

        setText(
            name,
            "Select business"
        );

        setText(
            currency,
            "USD"
        );

        return;
    }

    setText(
        avatar,
        initials(
            business.name
        )
    );

    setText(
        name,
        business.name
    );

    setText(
        currency,
        supportedCurrency(
            business.baseCurrency ||
            business.currency
        )
    );

    updateCurrencyUI();
}

async function switchBusiness(
    businessId
) {

    const business =
        state.businesses.find(
            item =>
                String(item.id) ===
                String(businessId)
        );

    if (!business) {
        return;
    }

    if (
        String(
            state.selectedBusinessId
        ) ===
        String(business.id)
    ) {

        closeBusinessDropdown();

        return;
    }

    state.selectedBusinessId =
        business.id;

    persistBusinessSelection();

    clearBusinessData();

    renderBusinesses();

    closeBusinessDropdown();

    await loadBusinessData();

    toast(
        `Switched to ${business.name}.`
    );
}

async function createBusiness() {

    if (!state.accountId) {
        showAuthScreen("login");
        return;
    }

    const name =
        $("businessName")?.value.trim();

    const legalName =
        $("businessLegalName")?.value.trim() ||
        null;

    const baseCurrency =
        supportedCurrency(
            $("businessCurrency")?.value ||
            "USD"
        );

    const timezone =
        $("businessTimezone")?.value ||
        "UTC";

    if (!name) {

        setFormStatus(
            "businessFormStatus",
            "Enter a business name.",
            true
        );

        return;
    }

    const button =
        $("businessSubmitButton");

    setBusy(
        button,
        true,
        "Creating..."
    );

    setFormStatus(
        "businessFormStatus",
        "",
        false
    );

    try {

        const payload =
            await apiRequest(
                `/accounts/${encodeURIComponent(
                    state.accountId
                )}/businesses`,
                {
                    method: "POST",
                    body:
                        JSON.stringify({
                            name,
                            legalName,
                            baseCurrency,
                            timezone
                        })
                }
            );

        const business =
            extractEntity(
                payload,
                [
                    "business",
                    "item"
                ]
            );

        if (!business?.id) {
            throw new Error(
                "Business was created but the API did not return the business."
            );
        }

        state.businesses.push(
            business
        );

        state.selectedBusinessId =
            business.id;

        persistBusinessSelection();

        renderBusinesses();

        closeModal(
            "businessModal"
        );

        await loadBusinessData();

        resetBusinessForm();

        toast(
            "Business created successfully."
        );

    } catch (error) {

        console.error(
            "Create business failed:",
            error
        );

        setFormStatus(
            "businessFormStatus",
            error.message ||
                "Unable to create business.",
            true
        );

    } finally {

        setBusy(
            button,
            false
        );
    }
}


/* ============================================================
   13. BUSINESS API PATHS
   ============================================================ */

function businessPath(
    suffix = ""
) {

    const businessId =
        getBusinessId();

    if (!businessId) {
        return null;
    }

    return (
        `/businesses/${encodeURIComponent(
            businessId
        )}` +
        suffix
    );
}

function productsApiPath() {
    return (
        businessPath("/products") ||
        null
    );
}

function transactionsApiPath() {
    return (
        businessPath("/transactions") ||
        null
    );
}

function expensesApiPath() {
    return (
        businessPath("/expenses") ||
        null
    );
}

function goalsApiPath() {
    return (
        businessPath("/goals") ||
        null
    );
}

function analyticsApiPath() {

    const base =
        businessPath(
            "/analytics"
        );

    if (!base) {
        return null;
    }

    const {
        from,
        to
    } = rangeBounds();

    const params =
        new URLSearchParams();

    if (from) {
        params.set(
            "from",
            from
        );
    }

    if (to) {
        params.set(
            "to",
            to
        );
    }

    return (
        `${base}?${params.toString()}`
    );
}


/* ============================================================
   14. BUSINESS DATA LOADING
   ============================================================ */

async function loadBusinessData() {

    const businessId =
        getBusinessId();

    if (!businessId) {

        clearBusinessData();

        renderBusinessEmptyState();

        return;
    }

    const version =
        ++state.businessLoadVersion;

    state.loadingBusinessData =
        true;

    setTopbarBusy(
        true
    );

    markBusinessResourcesLoading();

    renderLoadStates();

    try {

        const [
            productsResult,
            transactionsResult,
            expensesResult,
            goalsResult
        ] = await Promise.allSettled([
            apiRequest(
                productsApiPath()
            ),
            apiRequest(
                transactionsApiPath()
            ),
            apiRequest(
                expensesApiPath()
            ),
            apiRequest(
                goalsApiPath()
            )
        ]);

        if (
            version !==
            state.businessLoadVersion
        ) {
            return;
        }

        if (
            productsResult.status ===
            "fulfilled"
        ) {

            state.products =
                extractArray(
                    productsResult.value,
                    [
                        "products",
                        "items",
                        "results"
                    ]
                );

            markResource(
                "products",
                "ready"
            );

        } else {

            console.error(
                "Products load failed:",
                productsResult.reason
            );

            state.products =
                [];

            markResource(
                "products",
                "error",
                productsResult.reason
            );
        }

        if (
            transactionsResult.status ===
            "fulfilled"
        ) {

            state.transactions =
                extractArray(
                    transactionsResult.value,
                    [
                        "transactions",
                        "items",
                        "results"
                    ]
                );

            markResource(
                "transactions",
                "ready"
            );

        } else {

            console.error(
                "Transactions load failed:",
                transactionsResult.reason
            );

            state.transactions =
                [];

            markResource(
                "transactions",
                "error",
                transactionsResult.reason
            );
        }

        if (
            expensesResult.status ===
            "fulfilled"
        ) {

            const data =
                unwrap(
                    expensesResult.value
                );

            state.expenses =
                extractArray(
                    data,
                    [
                        "expenses",
                        "items",
                        "results"
                    ]
                );

            state.expenseCategories =
                extractArray(
                    data,
                    [
                        "categories",
                        "expenseCategories"
                    ]
                );

            markResource(
                "expenses",
                "ready"
            );

        } else {

            console.error(
                "Expenses load failed:",
                expensesResult.reason
            );

            state.expenses =
                [];

            state.expenseCategories =
                [];

            markResource(
                "expenses",
                "error",
                expensesResult.reason
            );
        }

        if (
            goalsResult.status ===
            "fulfilled"
        ) {

            state.goals =
                extractArray(
                    goalsResult.value,
                    [
                        "goals",
                        "items",
                        "results"
                    ]
                );

            markResource(
                "goals",
                "ready"
            );

        } else {

            console.error(
                "Goals load failed:",
                goalsResult.reason
            );

            state.goals =
                [];

            markResource(
                "goals",
                "error",
                goalsResult.reason
            );
        }

        renderBusinesses();

        renderAllBusinessData();

        refreshAnalyticsForPeriod();

    } finally {

        if (
            version ===
            state.businessLoadVersion
        ) {

            state.loadingBusinessData =
                false;

            setTopbarBusy(
                false
            );

            renderLoadStates();
        }
    }
}

async function refreshAnalyticsForPeriod() {

    const businessId =
        getBusinessId();

    if (!businessId) {
        state.analytics = null;
        renderAnalytics();
        return;
    }

    const path =
        analyticsApiPath();

    if (!path) {
        return;
    }

    const version =
        ++state.analyticsLoadVersion;

    markResource(
        "analytics",
        "loading"
    );

    if (
        state.activeSection ===
        "analytics"
    ) {
        renderAnalytics();
    }

    try {

        const payload =
            await apiRequest(
                path
            );

        if (
            version !==
            state.analyticsLoadVersion
        ) {
            return;
        }

        state.analytics =
            unwrap(payload);

        markResource(
            "analytics",
            "ready"
        );

        renderAnalytics();
        renderDashboard();
        renderReports();

    } catch (error) {

        if (
            version !==
            state.analyticsLoadVersion
        ) {
            return;
        }

        console.error(
            "Analytics load failed:",
            error
        );

        state.analytics =
            null;

        markResource(
            "analytics",
            "error",
            error
        );

        renderAnalytics();
        renderDashboard();
        renderReports();
    }
}


/* ============================================================
   15. RESOURCE STATE
   ============================================================ */

function markResource(
    name,
    status,
    error = null
) {

    state.resourceState.set(
        name,
        {
            status,
            error
        }
    );
}

function markBusinessResourcesLoading() {

    [
        "products",
        "transactions",
        "expenses",
        "goals"
    ].forEach(
        resource =>
            markResource(
                resource,
                "loading"
            )
    );

    markResource(
        "analytics",
        "loading"
    );
}

function resourceError(
    name
) {

    return (
        state.resourceState.get(
            name
        )?.error || null
    );
}

function resourceStatus(
    name
) {

    return (
        state.resourceState.get(
            name
        )?.status || "idle"
    );
}

function renderLoadStates() {

    [
        ["transactionsStateBanner", "transactions"],
        ["overviewStateBanner", "transactions"],
        ["analyticsStateBanner", "analytics"]
    ].forEach(
        ([elementId, resource]) => {

            const status =
                resourceStatus(
                    resource
                );

            const error =
                resourceError(
                    resource
                );

            const element =
                $(elementId);

            if (!element) return;

            if (status === "loading") {

                setText(
                    element,
                    "Loading real business data..."
                );

                show(element);

            } else if (status === "error") {

                setText(
                    element,
                    error?.message ||
                        "Some business data could not be loaded."
                );

                show(element);

            } else {

                hide(element);
            }
        }
    );
}


/* ============================================================
   16. UI BUSY / STATUS
   ============================================================ */

function setBusy(
    elementOrId,
    busy,
    busyLabel = null
) {

    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    if (
        busy &&
        !element.dataset.originalLabel
    ) {

        element.dataset.originalLabel =
            element.textContent;
    }

    element.disabled =
        Boolean(busy);

    element.setAttribute(
        "aria-busy",
        busy
            ? "true"
            : "false"
    );

    if (busyLabel) {

        element.textContent =
            busyLabel;

    } else if (
        !busy &&
        element.dataset.originalLabel
    ) {

        element.textContent =
            element.dataset.originalLabel;

        delete element.dataset.originalLabel;
    }
}

function setFormStatus(
    id,
    message,
    isError = false
) {

    const element =
        $(id);

    if (!element) return;

    setText(
        element,
        message
    );

    element.classList.toggle(
        "error",
        Boolean(
            message &&
            isError
        )
    );

    element.classList.toggle(
        "success",
        Boolean(
            message &&
            !isError
        )
    );
}

function setTopbarBusy(
    busy
) {

    const button =
        $("topbarNewTransactionButton");

    if (!button) return;

    button.classList.toggle(
        "is-busy",
        Boolean(busy)
    );
}

function setSectionState(
    section,
    type,
    title,
    details = ""
) {

    const sectionElement =
        $(`section-${section}`);

    if (!sectionElement) {
        return;
    }

    let banner =
        sectionElement.querySelector(
            ".section-state-banner"
        );

    if (!banner) {

        banner =
            document.createElement(
                "div"
            );

        banner.className =
            "section-state-banner";

        sectionElement.prepend(
            banner
        );
    }

    banner.className =
        `section-state-banner ${type}`;

    const heading =
        document.createElement(
            "strong"
        );

    heading.textContent =
        title;

    const description =
        document.createElement(
            "span"
        );

    description.textContent =
        details;

    banner.replaceChildren(
        heading,
        description
    );

    show(banner);
}


/* ============================================================
   17. RENDER BUSINESS EMPTY
   ============================================================ */

function renderBusinessEmptyState() {

    renderBusinesses();

    renderDashboard();

    renderTransactions();

    renderProducts();

    renderExpenses();

    renderGoals();

    renderAnalytics();

    renderReports();

    updateProfileUI();
}


/* ============================================================
   18. TRANSACTION HELPERS
   ============================================================ */

function normalizedStatus(
    record
) {

    return lower(
        record?.status ||
        record?.state ||
        ""
    );
}

function posted(
    record
) {

    const status =
        normalizedStatus(
            record
        );

    return (
        !status ||
        status === "posted" ||
        status === "completed"
    );
}

function transactionDate(
    transaction
) {

    return (
        transaction?.date ||
        transaction?.transactionDate ||
        transaction?.postedAt ||
        transaction?.createdAt ||
        null
    );
}

function transactionType(
    transaction
) {

    return lower(
        transaction?.type ||
        transaction?.transactionType ||
        "sale"
    );
}

function transactionSign(
    transaction
) {

    const type =
        transactionType(
            transaction
        );

    if (
        type === "refund"
    ) {
        return -1;
    }

    return 1;
}

function transactionLines(
    transaction
) {

    return safeArray(
        transaction?.lines ||
        transaction?.transactionLines ||
        transaction?.items
    );
}

function lineProductId(
    line
) {

    return (
        line?.productId ||
        line?.product?.id ||
        null
    );
}

function lineQuantity(
    line
) {

    return number(
        line?.quantity ||
        line?.qty ||
        0
    );
}

function lineRevenue(
    line,
    currency = "USD"
) {

    if (
        line?.revenueMinor !==
            undefined &&
        line?.revenueMinor !==
            null
    ) {
        return fromMinor(
            line.revenueMinor,
            currency
        );
    }

    if (
        line?.revenue !==
            undefined &&
        line?.revenue !==
            null
    ) {
        return number(
            line.revenue
        );
    }

    if (
        line?.unitPriceMinor !==
            undefined
    ) {
        return (
            fromMinor(
                line.unitPriceMinor,
                currency
            ) *
            lineQuantity(line)
        );
    }

    return (
        number(
            line.unitPrice
        ) *
        lineQuantity(line)
    );
}

function lineCost(
    line,
    currency = "USD"
) {

    if (
        line?.costMinor !==
            undefined &&
        line?.costMinor !==
            null
    ) {
        return fromMinor(
            line.costMinor,
            currency
        );
    }

    if (
        line?.cost !==
            undefined &&
        line?.cost !==
            null
    ) {
        return number(
            line.cost
        );
    }

    if (
        line?.unitCostMinor !==
            undefined
    ) {
        return (
            fromMinor(
                line.unitCostMinor,
                currency
            ) *
            lineQuantity(line)
        );
    }

    return (
        number(
            line.unitCost
        ) *
        lineQuantity(line)
    );
}

function transactionRevenue(
    transaction
) {

    const currency =
        transaction?.currency ||
        businessCurrency();

    /*
       Revenue excludes taxes (financial rules: revenue =
       subtotal - discount, i.e. total - tax when the header
       is complete). taxTotalMinor may be absent for header
       payloads without tax data, in which case the post-tax
       total is correct as before.
    */
    const hasTax =
        transaction?.taxTotalMinor !== undefined &&
        transaction?.taxTotalMinor !== null;

    const directMinor =
        transaction?.revenueMinor ??
        transaction?.totalRevenueMinor ??
        (hasTax
            ? Math.round(
                Number(transaction.totalMinor) -
                Number(transaction.taxTotalMinor)
            )
            : transaction?.totalMinor);

    if (
        directMinor !==
            undefined &&
        directMinor !==
            null
    ) {
        return fromMinor(
            directMinor,
            currency
        );
    }

    const direct =
        transaction?.revenue ??
        transaction?.totalRevenue;

    if (
        direct !==
            undefined &&
        direct !==
            null
    ) {
        return number(
            direct
        );
    }

    const lines =
        transactionLines(
            transaction
        );

    return lines.reduce(
        (
            total,
            line
        ) =>
            total +
            lineRevenue(
                line,
                currency
            ),
        0
    );
}

function transactionCost(
    transaction
) {

    const currency =
        transaction?.currency ||
        businessCurrency();

    const directMinor =
        transaction?.costMinor ??
        transaction?.totalCostMinor ??
        transaction?.costTotalMinor;

    if (
        directMinor !==
            undefined &&
        directMinor !==
            null
    ) {
        return fromMinor(
            directMinor,
            currency
        );
    }

    const direct =
        transaction?.cost ??
        transaction?.totalCost;

    if (
        direct !==
            undefined &&
        direct !==
            null
    ) {
        return number(
            direct
        );
    }

    const lines =
        transactionLines(
            transaction
        );

    return lines.reduce(
        (
            total,
            line
        ) =>
            total +
            lineCost(
                line,
                currency
            ),
        0
    );
}

function transactionQuantity(
    transaction
) {

    const direct =
        transaction?.quantity ??
        transaction?.totalQuantity;

    if (
        direct !==
            undefined &&
        direct !==
            null
    ) {
        return number(
            direct
        );
    }

    return transactionLines(
        transaction
    ).reduce(
        (
            total,
            line
        ) =>
            total +
            lineQuantity(line),
        0
    );
}

function transactionProfit(
    transaction
) {

    return (
        transactionRevenue(
            transaction
        ) -
        transactionCost(
            transaction
        )
    ) *
        transactionSign(
            transaction
        );
}

function transactionMatchesSearch(
    transaction
) {

    const query =
        lower(
            state.transactionSearch
        );

    if (!query) {
        return true;
    }

    const productNames =
        transactionProductNames(
            transaction
        ).join(" ");

    const searchable = [
        transaction?.id,
        transaction?.reference,
        transaction?.description,
        transactionType(transaction),
        normalizedStatus(transaction),
        productNames,
        transactionDate(transaction)
    ]
        .filter(Boolean)
        .join(" ");

    return lower(
        searchable
    ).includes(
        query
    );
}

function matchesTransactionFilter(
    transaction
) {

    if (
        state.transactionFilter ===
        "all"
    ) {
        return true;
    }

    return (
        transactionType(
            transaction
        ) ===
        lower(
            state.transactionFilter
        )
    );
}


/* ============================================================
   19. PRODUCT HELPERS
   ============================================================ */

function productPrice(
    product
) {

    const currency =
        product?.currency ||
        businessCurrency();

    if (
        product?.defaultSalePriceMinor !==
            undefined
    ) {
        return fromMinor(
            product.defaultSalePriceMinor,
            currency
        );
    }

    if (
        product?.salePriceMinor !==
            undefined
    ) {
        return fromMinor(
            product.salePriceMinor,
            currency
        );
    }

    return number(
        product?.defaultSalePrice ??
        product?.salePrice ??
        product?.price ??
        0
    );
}

function productCost(
    product
) {

    const currency =
        product?.currency ||
        businessCurrency();

    if (
        product?.defaultCostMinor !==
            undefined
    ) {
        return fromMinor(
            product.defaultCostMinor,
            currency
        );
    }

    if (
        product?.defaultCostPriceMinor !==
            undefined
    ) {
        return fromMinor(
            product.defaultCostPriceMinor,
            currency
        );
    }

    if (
        product?.costMinor !==
            undefined
    ) {
        return fromMinor(
            product.costMinor,
            currency
        );
    }

    return number(
        product?.defaultCost ??
        product?.cost ??
        0
    );
}

function isArchivedProduct(
    product
) {

    return Boolean(
        product?.archivedAt ||
        lower(
            product?.status
        ) === "archived"
    );
}

function activeProducts() {

    return safeArray(
        state.products
    ).filter(
        product =>
            !isArchivedProduct(
                product
            )
    );
}

function findProduct(
    productId
) {

    if (!productId) {
        return null;
    }

    return state.products.find(
        product =>
            String(product.id) ===
            String(productId)
    ) || null;
}

function transactionProductNames(
    transaction
) {

    const lines =
        transactionLines(
            transaction
        );

    return unique(
        lines
            .map(
                line => {

                    const directName =
                        line?.product?.name ||
                        line?.productName;

                    if (
                        directName
                    ) {
                        return String(
                            directName
                        );
                    }

                    const product =
                        findProduct(
                            lineProductId(
                                line
                            )
                        );

                    return (
                        product?.name ||
                        null
                    );
                }
            )
            .filter(Boolean)
    );
}

function transactionProductName(
    transaction
) {

    return (
        transactionProductNames(
            transaction
        )[0] ||
        transaction?.product?.name ||
        transaction?.productName ||
        "Unlinked product"
    );
}

function productMetrics(
    product
) {

    let units = 0;
    let revenue = 0;
    let cost = 0;

    state.transactions
        .filter(
            transaction =>
                posted(transaction)
        )
        .forEach(
            transaction => {

                const lines =
                    transactionLines(
                        transaction
                    );

                lines.forEach(
                    line => {

                        if (
                            String(
                                lineProductId(
                                    line
                                )
                            ) !==
                            String(
                                product.id
                            )
                        ) {
                            return;
                        }

                        const sign =
                            transactionSign(
                                transaction
                            );

                        units +=
                            lineQuantity(
                                line
                            ) *
                            sign;

                        revenue +=
                            lineRevenue(
                                line,
                                product.currency ||
                                    businessCurrency()
                            ) *
                            sign;

                        cost +=
                            lineCost(
                                line,
                                product.currency ||
                                    businessCurrency()
                            ) *
                            sign;
                    }
                );
            }
        );

    const profit =
        revenue -
        cost;

    const margin =
        revenue !== 0
            ? profit / revenue * 100
            : null;

    return {
        units,
        revenue,
        cost,
        profit,
        margin
    };
}


/* ============================================================
   20. EXPENSE HELPERS
   ============================================================ */

function expenseDate(
    expense
) {

    return (
        expense?.date ||
        expense?.expenseDate ||
        expense?.postedAt ||
        expense?.createdAt ||
        null
    );
}

function expenseAmount(
    expense
) {

    const currency =
        expense?.currency ||
        businessCurrency();

    if (
        expense?.amountMinor !==
            undefined
    ) {
        return fromMinor(
            expense.amountMinor,
            currency
        );
    }

    return number(
        expense?.amount ||
        expense?.value ||
        0
    );
}

function expenseCategory(
    expense
) {

    return (
        expense?.category?.name ||
        expense?.categoryName ||
        expense?.category ||
        "Uncategorized"
    );
}

function categoryName(
    category
) {

    if (
        typeof category ===
        "string"
    ) {
        return category;
    }

    return (
        category?.name ||
        category?.label ||
        "Uncategorized"
    );
}


/* ============================================================
   21. GOAL HELPERS
   ============================================================ */

function goalType(
    goal
) {

    return lower(
        goal?.type ||
        goal?.goalType ||
        "revenue"
    );
}

function goalTarget(
    goal
) {

    const type =
        goalType(goal);

    const currency =
        goal?.currency ||
        businessCurrency();

    if (
        [
            "margin",
            "roi"
        ].includes(type)
    ) {
        return number(
            goal?.target ??
            goal?.targetPercent ??
            0
        );
    }

    if (
        type ===
        "sales_count"
    ) {
        return number(
            goal?.target ??
            goal?.targetCount ??
            0
        );
    }

    if (
        goal?.targetMinor !==
            undefined
    ) {
        return fromMinor(
            goal.targetMinor,
            currency
        );
    }

    return number(
        goal?.target ??
        goal?.targetValue ??
        0
    );
}

function goalBounds(
    goal
) {

    const start =
        goal?.startDate ||
        goal?.from ||
        goal?.periodStart ||
        null;

    const end =
        goal?.endDate ||
        goal?.to ||
        goal?.periodEnd ||
        null;

    return {
        from: start,
        to: end
    };
}

function goalCurrent(
    goal
) {

    if (
        goal?.currentValue !==
            undefined
    ) {
        return number(
            goal.currentValue
        );
    }

    if (
        goal?.currentValueMinor !==
            undefined
    ) {
        return fromMinor(
            goal.currentValueMinor,
            goal.currency ||
                businessCurrency()
        );
    }

    if (
        goal?.progressValue !==
            undefined
    ) {
        return number(
            goal.progressValue
        );
    }

    const {
        from,
        to
    } =
        goalBounds(goal);

    const type =
        goalType(goal);

    const start =
        from ||
        rangeBounds().from;

    const end =
        to ||
        rangeBounds().to;

    const transactions =
        state.transactions.filter(
            transaction =>
                posted(transaction) &&
                inRange(
                    transactionDate(
                        transaction
                    ),
                    start,
                    end
                )
        );

    const expenses =
        state.expenses.filter(
            expense =>
                posted(expense) &&
                inRange(
                    expenseDate(expense),
                    start,
                    end
                )
        );

    const revenue =
        transactions.reduce(
            (
                total,
                transaction
            ) =>
                total +
                transactionRevenue(
                    transaction
                ) *
                transactionSign(
                    transaction
                ),
            0
        );

    const costs =
        transactions.reduce(
            (
                total,
                transaction
            ) =>
                total +
                transactionCost(
                    transaction
                ) *
                transactionSign(
                    transaction
                ),
            0
        );

    const postedExpenses =
        expenses.reduce(
            (
                total,
                expense
            ) =>
                total +
                expenseAmount(
                    expense
                ),
            0
        );

    const grossProfit =
        revenue -
        costs;

    const netProfit =
        grossProfit -
        postedExpenses;

    if (
        type ===
        "revenue"
    ) {
        return revenue;
    }

    if (
        type ===
        "profit"
    ) {
        return netProfit;
    }

    if (
        type ===
        "sales_count"
    ) {
        return transactions.filter(
            transaction =>
                transactionType(
                    transaction
                ) === "sale"
        ).length;
    }

    if (
        type ===
        "margin"
    ) {
        return revenue
            ? (
                grossProfit /
                revenue
            ) * 100
            : 0;
    }

    if (
        type ===
        "roi"
    ) {

        const investment =
            costs +
            postedExpenses;

        return investment
            ? (
                netProfit /
                investment
            ) * 100
            : 0;
    }

    if (
        type ===
        "expense_limit"
    ) {
        return postedExpenses;
    }

    return 0;
}

function goalProgress(
    goal
) {

    const target =
        goalTarget(goal);

    const current =
        goalCurrent(goal);

    if (
        target <= 0
    ) {
        return 0;
    }

    return clamp(
        current / target * 100,
        0,
        100
    );
}

function goalIsActive(
    goal
) {

    const status =
        normalizedStatus(
            goal
        );

    if (
        [
            "archived",
            "cancelled",
            "completed"
        ].includes(status)
    ) {
        return false;
    }

    const {
        from,
        to
    } =
        goalBounds(
            goal
        );

    const now =
        today();

    if (
        from &&
        localDateKey(now) <
        localDateKey(from)
    ) {
        return false;
    }

    if (
        to &&
        localDateKey(now) >
        localDateKey(to)
    ) {
        return false;
    }

    return true;
}

function formatGoalValue(
    goal,
    value
) {

    const type =
        goalType(goal);

    if (
        type ===
        "sales_count"
    ) {
        return formatNumber(
            value
        );
    }

    if (
        [
            "margin",
            "roi"
        ].includes(type)
    ) {
        return formatPercent(
            value
        );
    }

    return formatCurrency(
        value,
        goal?.currency ||
            businessCurrency()
    );
}


/* ============================================================
   22. ANALYTICS NORMALIZATION
   ============================================================ */

function numericValue(
    object,
    keys,
    fallback = null
) {

    for (
        const key of keys
    ) {

        const value =
            object?.[key];

        if (
            value !== undefined &&
            value !== null &&
            value !== "" &&
            Number.isFinite(
                Number(value)
            )
        ) {
            return Number(
                value
            );
        }
    }

    return fallback;
}

function analyticsRoot() {

    if (
        !state.analytics
    ) {
        return null;
    }

    return (
        state.analytics?.data ||
        state.analytics
    );
}

function analyticsSummary() {

    const root =
        analyticsRoot();

    if (!root) {
        return null;
    }

    const summary =
        root.summary ||
        root.totals ||
        root.metrics ||
        root;

    const currency =
        businessCurrency();

    const asMajor = value =>
        value === null || value === undefined
            ? null
            : fromMinor(value, currency);

    return {
        revenue:
            fromMinor(
                numericValue(
                    summary,
                    [
                        "revenue",
                        "totalRevenue",
                        "revenueTotal"
                    ],
                    0
                ),
                currency
            ),

        costs:
            fromMinor(
                numericValue(
                    summary,
                    [
                        "cost",
                        "costs",
                        "productCosts",
                        "totalCost"
                    ],
                    0
                ),
                currency
            ),

        grossProfit:
            asMajor(
                numericValue(
                    summary,
                    [
                        "grossProfit",
                        "gross_profit"
                    ],
                    null
                )
            ),

        netProfit:
            asMajor(
                numericValue(
                    summary,
                    [
                        "netProfit",
                        "net_profit",
                        "profit",
                        "totalProfit"
                    ],
                    null
                )
            ),

        expenses:
            fromMinor(
                numericValue(
                    summary,
                    [
                        "expenses",
                        "totalExpenses",
                        "expenseTotal"
                    ],
                    0
                ),
                currency
            ),

        sales:
            numericValue(
                summary,
                [
                    "sales",
                    "salesCount",
                    "transactionCount"
                ],
                0
            ),

        margin:
            numericValue(
                summary,
                [
                    "margin",
                    "grossMargin",
                    "marginPercent"
                ],
                null
            ),

        roi:
            numericValue(
                summary,
                [
                    "roi",
                    "roiPercent"
                ],
                null
            ),

        previousRevenue:
            asMajor(
                numericValue(
                    summary,
                    [
                        "previousRevenue",
                        "revenuePrevious",
                        "priorRevenue"
                    ],
                    null
                )
            ),

        previousProfit:
            asMajor(
                numericValue(
                    summary,
                    [
                        "previousProfit",
                        "profitPrevious",
                        "priorProfit"
                    ],
                    null
                )
            ),

        previousExpenses:
            asMajor(
                numericValue(
                    summary,
                    [
                        "previousExpenses",
                        "expensesPrevious",
                        "priorExpenses"
                    ],
                    null
                )
            )
    };
}

function analyticsSeries() {

    const root =
        analyticsRoot();

    if (!root) {
        return [];
    }

    const series =
        root.series ||
        root.timeline ||
        root.trend ||
        root.points ||
        [];

    if (
        !Array.isArray(series)
    ) {
        return [];
    }

    const currency =
        businessCurrency();

    return series
        .map(
            item => {

                const date =
                    item.date ||
                    item.day ||
                    item.period ||
                    item.label ||
                    item.timestamp;

                return {
                    date,
                    label:
                        item.label ||
                        item.period ||
                        date,

                    revenue:
                        fromMinor(
                            numericValue(
                                item,
                                [
                                    "revenue",
                                    "totalRevenue"
                                ],
                                0
                            ),
                            currency
                        ),

                    profit:
                        fromMinor(
                            numericValue(
                                item,
                                [
                                    "profit",
                                    "netProfit",
                                    "totalProfit"
                                ],
                                0
                            ),
                            currency
                        ),

                    expenses:
                        fromMinor(
                            numericValue(
                                item,
                                [
                                    "expenses",
                                    "totalExpenses"
                                ],
                                0
                            ),
                            currency
                        )
                };
            }
        )
        .filter(
            item =>
                item.date ||
                item.label
        );
}

function normalizeAnalyticsSummary() {

    const summary =
        analyticsSummary();

    if (!summary) {
        return null;
    }

    const calculatedGrossProfit =
        summary.grossProfit ??
        (
            summary.revenue -
            summary.costs
        );

    const calculatedNetProfit =
        summary.netProfit ??
        (
            calculatedGrossProfit -
            summary.expenses
        );

    const margin =
        summary.margin ??
        (
            summary.revenue !== 0
                ? (
                    calculatedGrossProfit /
                    summary.revenue
                ) * 100
                : null
        );

    const roi =
        summary.roi ??
        (
            summary.costs +
                summary.expenses >
            0
                ? (
                    calculatedNetProfit /
                    (
                        summary.costs +
                        summary.expenses
                    )
                ) * 100
                : null
        );

    return {
        ...summary,
        grossProfit:
            calculatedGrossProfit,

        netProfit:
            calculatedNetProfit,

        margin,
        roi
    };
}


/* ============================================================
   23. LOCAL STATS FALLBACK
   ============================================================ */

function calculateStats(
    from,
    to
) {

    const transactions =
        state.transactions.filter(
            transaction =>
                posted(transaction) &&
                inRange(
                    transactionDate(
                        transaction
                    ),
                    from,
                    to
                )
        );

    const expenses =
        state.expenses.filter(
            expense =>
                posted(expense) &&
                inRange(
                    expenseDate(expense),
                    from,
                    to
                )
        );

    let revenue = 0;
    let costs = 0;
    let sales = 0;

    transactions.forEach(
        transaction => {

            const sign =
                transactionSign(
                    transaction
                );

            revenue +=
                transactionRevenue(
                    transaction
                ) *
                sign;

            costs +=
                transactionCost(
                    transaction
                ) *
                sign;

            if (
                transactionType(
                    transaction
                ) === "sale"
            ) {
                sales += 1;
            }
        }
    );

    const expenseTotal =
        expenses.reduce(
            (
                total,
                expense
            ) =>
                total +
                expenseAmount(
                    expense
                ),
            0
        );

    const grossProfit =
        revenue -
        costs;

    const netProfit =
        grossProfit -
        expenseTotal;

    const margin =
        revenue !== 0
            ? (
                grossProfit /
                revenue
            ) * 100
            : null;

    const roi =
        costs +
            expenseTotal >
        0
            ? (
                netProfit /
                (
                    costs +
                    expenseTotal
                )
            ) * 100
            : null;

    return {
        revenue,
        costs,
        grossProfit,
        netProfit,
        expenses:
            expenseTotal,
        sales,
        margin,
        roi
    };
}

function dashboardStats() {

    const {
        from,
        to
    } =
        rangeBounds();

    const server =
        normalizeAnalyticsSummary();

    if (server) {
        return server;
    }

    return calculateStats(
        from,
        to
    );
}

function percentChange(
    current,
    previous
) {

    const c =
        number(current);

    const p =
        number(previous);

    if (
        p === 0
    ) {
        if (
            c === 0
        ) {
            return 0;
        }

        return null;
    }

    return (
        (c - p) /
        Math.abs(p)
    ) * 100;
}

function getChange(
    current,
    previous
) {

    if (
        previous ===
        null ||
        previous ===
        undefined
    ) {
        return null;
    }

    return percentChange(
        current,
        previous
    );
}

function setChange(
    elementOrId,
    change,
    neutralText = "—"
) {

    const element =
        typeof elementOrId === "string"
            ? $(elementOrId)
            : elementOrId;

    if (!element) return;

    element.classList.remove(
        "positive",
        "negative",
        "neutral",
        "muted"
    );

    if (
        change ===
            null ||
        change ===
            undefined
    ) {

        element.textContent =
            neutralText;

        element.classList.add(
            "muted"
        );

        return;
    }

    if (
        Math.abs(
            number(change)
        ) < 0.005
    ) {

        element.textContent =
            "0%";

        element.classList.add(
            "neutral"
        );

        return;
    }

    element.textContent =
        formatChangePercent(
            change
        );

    element.classList.add(
        change > 0
            ? "positive"
            : "negative"
    );
}


/* ============================================================
   24. DASHBOARD RENDER
   ============================================================ */

function renderDashboard() {

    const business =
        selectedBusiness();

    if (!business) {

        [
            "revenueMetric",
            "productCostsMetric",
            "grossProfitMetric",
            "netProfitMetric",
            "expensesMetric"
        ].forEach(
            id =>
                setText(
                    id,
                    "$0.00"
                )
        );

        setText(
            "salesMetric",
            "0"
        );

        [
            "revenueChange",
            "productCostsChange",
            "grossProfitChange",
            "netProfitChange",
            "salesChange",
            "expensesChange"
        ].forEach(
            id =>
                setText(
                    id,
                    "—"
                )
        );

        renderPerformanceChart(
            []
        );

        renderDashboardTransactions();

        renderBusinessHealth();

        return;
    }

    const stats =
        dashboardStats();

    const currency =
        businessCurrency();

    setText(
        "revenueMetric",
        formatCurrency(
            stats.revenue,
            currency
        )
    );

    setText(
        "productCostsMetric",
        formatCurrency(
            stats.costs,
            currency
        )
    );

    setText(
        "grossProfitMetric",
        formatCurrency(
            stats.grossProfit,
            currency
        )
    );

    setText(
        "netProfitMetric",
        formatCurrency(
            stats.netProfit,
            currency
        )
    );

    setText(
        "expensesMetric",
        formatCurrency(
            stats.expenses,
            currency
        )
    );

    setText(
        "salesMetric",
        formatNumber(
            stats.sales
        )
    );

    const summary =
        normalizeAnalyticsSummary();

    setChange(
        "revenueChange",
        getChange(
            stats.revenue,
            summary?.previousRevenue
        )
    );

    setChange(
        "grossProfitChange",
        getChange(
            stats.grossProfit,
            summary?.previousProfit
        )
    );

    setChange(
        "netProfitChange",
        null
    );

    setChange(
        "expensesChange",
        getChange(
            stats.expenses,
            summary?.previousExpenses
        )
    );

    setText(
        "productCostsChange",
        "—"
    );

    setText(
        "salesChange",
        "—"
    );

    renderPerformanceChart(
        analyticsSeries()
    );

    renderDashboardTransactions();

    renderBusinessHealth();

    updateCurrencyUI();
}

function renderDashboardTransactions() {

    const container =
        $("dashboardTransactions");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const transactions =
        state.transactions
            .filter(
                transaction =>
                    posted(transaction)
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    new Date(
                        transactionDate(
                            b
                        ) || 0
                    ) -
                    new Date(
                        transactionDate(
                            a
                        ) || 0
                    )
            )
            .slice(0, 6);

    if (
        !transactions.length
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "mini-list-empty";

        empty.innerHTML = `
            <strong>No posted transactions</strong>
            <span>Your real sales activity will appear here.</span>
        `;

        container.appendChild(
            empty
        );

        return;
    }

    transactions.forEach(
        transaction => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "mini-transaction";

            const main =
                document.createElement(
                    "div"
                );

            main.className =
                "mini-transaction-main";

            const type =
                document.createElement(
                    "span"
                );

            type.className =
                "mini-transaction-type";

            type.textContent =
                titleCase(
                    transactionType(
                        transaction
                    )
                );

            const product =
                document.createElement(
                    "strong"
                );

            product.className =
                "mini-transaction-product";

            product.textContent =
                transactionProductName(
                    transaction
                );

            const date =
                document.createElement(
                    "small"
                );

            date.className =
                "mini-transaction-date";

            date.textContent =
                formatDate(
                    transactionDate(
                        transaction
                    ),
                    {
                        month: "short",
                        day: "numeric"
                    }
                );

            main.append(
                type,
                product,
                date
            );

            const value =
                document.createElement(
                    "strong"
                );

            value.className =
                "mini-transaction-value";

            const amount =
                transactionRevenue(
                    transaction
                ) *
                transactionSign(
                    transaction
                );

            value.textContent =
                formatCurrency(
                    amount,
                    transaction.currency ||
                        businessCurrency()
                );

            if (
                transactionSign(
                    transaction
                ) < 0
            ) {
                value.classList.add(
                    "negative"
                );
            }

            item.append(
                main,
                value
            );

            container.appendChild(
                item
            );
        }
    );
}

function renderBusinessHealth() {

    const container =
        $("businessHealth");

    if (!container) {
        return;
    }

    container.replaceChildren();

    if (!selectedBusiness()) {

        appendHealthItem(
            container,
            "business-health-empty",
            "No business selected",
            "Create or select a business to begin."
        );

        return;
    }

    const stats =
        dashboardStats();

    const productCount =
        activeProducts().length;

    const postedTransactions =
        state.transactions.filter(
            transaction =>
                posted(transaction)
        ).length;

    const postedExpenses =
        state.expenses.filter(
            expense =>
                posted(expense)
        ).length;

    const goals =
        state.goals.filter(
            goal =>
                goalIsActive(goal)
        );

    const indicators = [];

    if (
        postedTransactions >
        0
    ) {

        indicators.push({
            label:
                "Transaction activity",
            value:
                `${formatNumber(
                    postedTransactions
                )} posted`,
            tone:
                "positive"
        });

    } else {

        indicators.push({
            label:
                "Transaction activity",
            value:
                "No posted activity",
            tone:
                "neutral"
        });

    }

    if (
        productCount >
        0
    ) {

        indicators.push({
            label:
                "Active catalog",
            value:
                `${formatNumber(
                    productCount
                )} products`,
            tone:
                "positive"
        });

    } else {

        indicators.push({
            label:
                "Active catalog",
            value:
                "No active products",
            tone:
                "warning"
        });

    }

    if (
        stats.revenue >
        0
    ) {

        indicators.push({
            label:
                "Profitability",
            value:
                `${formatPercent(
                    stats.margin
                )} gross margin`,
            tone:
                stats.margin >= 0
                    ? "positive"
                    : "negative"
        });

    } else {

        indicators.push({
            label:
                "Profitability",
            value:
                "Awaiting revenue data",
            tone:
                "neutral"
        });
    }

    indicators.push({
        label:
            "Active goals",
        value:
            goals.length
                ? formatNumber(
                    goals.length
                )
                : "None yet",
        tone:
            goals.length
                ? "positive"
                : "neutral"
    });

    indicators.push({
        label:
            "Expenses",
        value:
            postedExpenses
                ? `${formatNumber(
                    postedExpenses
                )} posted`
                : "No posted expenses",
        tone:
            postedExpenses
                ? "neutral"
                : "neutral"
    });

    indicators.forEach(
        item =>
            appendHealthItem(
                container,
                `business-health-item ${item.tone}`,
                item.label,
                item.value
            )
    );
}

function appendHealthItem(
    container,
    className,
    label,
    value
) {

    const item =
        document.createElement(
            "div"
        );

    item.className =
        className;

    const labelElement =
        document.createElement(
            "span"
        );

    labelElement.textContent =
        label;

    const valueElement =
        document.createElement(
            "strong"
        );

    valueElement.textContent =
        value;

    item.append(
        labelElement,
        valueElement
    );

    container.appendChild(
        item
    );
}


/* ============================================================
   25. PERFORMANCE CHART
   ============================================================ */

function chartDomain(series) {

    const values =
        safeArray(series)
            .flatMap(
                point => [
                    number(point.revenue),
                    number(point.profit),
                    number(point.expenses)
                ]
            );

    if (!values.length) {
        return {
            min: 0,
            max: 1
        };
    }

    let min =
        Math.min(
            0,
            ...values
        );

    let max =
        Math.max(
            0,
            ...values
        );

    if (
        min === max
    ) {
        max =
            max === 0
                ? 1
                : max * 1.15;
    }

    const padding =
        (max - min) * 0.08;

    return {
        min:
            min - padding,
        max:
            max + padding
    };
}

function linePath(
    points
) {

    if (
        !points.length
    ) {
        return "";
    }

    if (
        points.length === 1
    ) {
        const point =
            points[0];

        return `
            M ${point.x.toFixed(2)}
              ${point.y.toFixed(2)}
        `;
    }

    let path =
        `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

    for (
        let i = 1;
        i < points.length;
        i++
    ) {

        const previous =
            points[i - 1];

        const current =
            points[i];

        const controlX =
            (
                previous.x +
                current.x
            ) / 2;

        path +=
            ` C ${controlX.toFixed(2)} ${previous.y.toFixed(2)}, ` +
            `${controlX.toFixed(2)} ${current.y.toFixed(2)}, ` +
            `${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
    }

    return path;
}

function renderPerformanceChart(
    series
) {

    const svg =
        $("performanceChartSvg");

    const empty =
        $("performanceChartEmpty");

    if (!svg) {
        return;
    }

    const gridGroup =
        svg.querySelector(
            ".chart-grid-lines"
        );

    const labelsGroup =
        svg.querySelector(
            ".chart-axis-labels"
        );

    const revenuePath =
        $("revenueChartPath");

    const profitPath =
        $("profitChartPath");

    const expensesPath =
        $("expensesChartPath");

    if (
        !gridGroup ||
        !labelsGroup
    ) {
        return;
    }

    gridGroup.replaceChildren();

    labelsGroup.replaceChildren();

    if (!series.length) {

        setAttributeSafe(
            revenuePath,
            "d",
            ""
        );

        setAttributeSafe(
            profitPath,
            "d",
            ""
        );

        setAttributeSafe(
            expensesPath,
            "d",
            ""
        );

        show(empty);

        return;
    }

    hide(empty);

    const width =
        1200;

    const height =
        420;

    const left =
        58;

    const right =
        22;

    const top =
        18;

    const bottom =
        44;

    const chartWidth =
        width -
        left -
        right;

    const chartHeight =
        height -
        top -
        bottom;

    const domain =
        chartDomain(
            series
        );

    const xStep =
        series.length <= 1
            ? chartWidth / 2
            : chartWidth /
                (
                    series.length - 1
                );

    const yPosition = value => {

        const ratio =
            (
                value -
                domain.min
            ) /
            (
                domain.max -
                domain.min
            );

        return (
            top +
            chartHeight *
            (
                1 - ratio
            )
        );
    };

    const makePoints = key =>
        series.map(
            (
                point,
                index
            ) => ({
                x:
                    left +
                    xStep *
                    index,

                y:
                    yPosition(
                        number(
                            point[key]
                        )
                    ),

                value:
                    number(
                        point[key]
                    ),

                date:
                    point.date ||
                    point.label ||
                    ""
            })
        );

    const revenuePoints =
        makePoints(
            "revenue"
        );

    const profitPoints =
        makePoints(
            "profit"
        );

    const expensePoints =
        makePoints(
            "expenses"
        );

    setAttributeSafe(
        revenuePath,
        "d",
        linePath(
            revenuePoints
        )
    );

    setAttributeSafe(
        profitPath,
        "d",
        linePath(
            profitPoints
        )
    );

    setAttributeSafe(
        expensesPath,
        "d",
        linePath(
            expensePoints
        )
    );

    const gridCount =
        5;

    for (
        let i = 0;
        i <= gridCount;
        i++
    ) {

        const y =
            top +
            (
                chartHeight /
                gridCount
            ) *
            i;

        const line =
            document.createElementNS(
                "http://www.w3.org/2000/svg",
                "line"
            );

        line.setAttribute(
            "x1",
            String(left)
        );

        line.setAttribute(
            "x2",
            String(
                width -
                right
            )
        );

        line.setAttribute(
            "y1",
            String(y)
        );

        line.setAttribute(
            "y2",
            String(y)
        );

        line.setAttribute(
            "class",
            "chart-grid-line"
        );

        gridGroup.appendChild(
            line
        );

        const value =
            domain.max -
            (
                domain.max -
                domain.min
            ) *
            (
                i /
                gridCount
            );

        const label =
            document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text"
            );

        label.setAttribute(
            "x",
            String(
                left - 11
            )
        );

        label.setAttribute(
            "y",
            String(
                y + 4
            )
        );

        label.setAttribute(
            "text-anchor",
            "end"
        );

        label.setAttribute(
            "class",
            "chart-axis-label"
        );

        label.textContent =
            compactMoney(
                value,
                businessCurrency()
            );

        labelsGroup.appendChild(
            label
        );
    }

    const labelIndexes =
        chooseChartLabelIndexes(
            series.length,
            6
        );

    labelIndexes.forEach(
        index => {

            const point =
                revenuePoints[
                    index
                ];

            if (!point) {
                return;
            }

            const label =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "text"
                );

            label.setAttribute(
                "x",
                String(point.x)
            );

            label.setAttribute(
                "y",
                String(
                    height -
                    13
                )
            );

            label.setAttribute(
                "text-anchor",
                "middle"
            );

            label.setAttribute(
                "class",
                "chart-axis-label"
            );

            label.textContent =
                formatChartDate(
                    point.date
                );

            labelsGroup.appendChild(
                label
            );
        }
    );

    renderChartPoints(
        "performanceChartPoints",
        revenuePoints,
        "revenue"
    );
}

function chooseChartLabelIndexes(
    length,
    desired
) {

    if (
        length <= desired
    ) {
        return Array.from(
            {
                length
            },
            (
                _,
                index
            ) =>
                index
        );
    }

    const result = [];

    for (
        let i = 0;
        i < desired;
        i++
    ) {

        const ratio =
            i /
            (
                desired -
                1
            );

        result.push(
            Math.round(
                ratio *
                (
                    length -
                    1
                )
            )
        );
    }

    return unique(
        result
    );
}

function formatChartDate(
    date
) {

    if (!date) {
        return "—";
    }

    const parsed =
        parseDateOnly(
            date
        );

    if (!parsed) {
        return String(
            date
        );
    }

    return new Intl.DateTimeFormat(
        selectedLocale(),
        {
            month: "short",
            day: "numeric"
        }
    ).format(
        parsed
    );
}

function renderChartPoints(
    groupId,
    points,
    seriesName
) {

    const group =
        $(groupId);

    if (!group) {
        return;
    }

    group.replaceChildren();

    if (
        points.length >
        80
    ) {
        return;
    }

    points.forEach(
        point => {

            const circle =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "circle"
                );

            circle.setAttribute(
                "cx",
                String(point.x)
            );

            circle.setAttribute(
                "cy",
                String(point.y)
            );

            circle.setAttribute(
                "r",
                "2.7"
            );

            circle.setAttribute(
                "class",
                `chart-point ${seriesName}`
            );

            circle.dataset.index =
                String(
                    points.indexOf(
                        point
                    )
                );

            group.appendChild(
                circle
            );
        }
    );
}

function setAttributeSafe(
    element,
    name,
    value
) {

    if (
        element &&
        typeof element.setAttribute ===
            "function"
    ) {
        element.setAttribute(
            name,
            value
        );
    }
}


/* ============================================================
   26. PERFORMANCE CHART HOVER
   ============================================================ */

function handlePerformancePointer(
    event
) {

    const chart =
        $("performanceChart");

    const svg =
        $("performanceChartSvg");

    const tooltip =
        $("performanceChartTooltip");

    if (
        !chart ||
        !svg ||
        !tooltip
    ) {
        return;
    }

    const series =
        analyticsSeries();

    if (
        !series.length
    ) {
        hide(tooltip);
        return;
    }

    const rect =
        svg.getBoundingClientRect();

    const clientX =
        event.clientX ??
        event.touches?.[0]?.clientX;

    if (
        clientX ===
            undefined ||
        !Number.isFinite(clientX)
    ) {
        return;
    }

    const x =
        clamp(
            clientX -
            rect.left,
            0,
            rect.width
        );

    const ratio =
        rect.width
            ? x /
                rect.width
            : 0;

    const index =
        Math.round(
            ratio *
            (
                series.length -
                1
            )
        );

    const point =
        series[
            clamp(
                index,
                0,
                series.length - 1
            )
        ];

    if (!point) {
        return;
    }

    renderPerformanceTooltip(
        tooltip,
        event,
        point
    );
}

function renderPerformanceTooltip(
    tooltip,
    event,
    point
) {

    const currency =
        businessCurrency();

    const dateLabel =
        formatDate(
            point.date ||
                point.label
        );

    tooltip.innerHTML = `
        <div class="chart-tooltip-title">
            ${escapeHTML(
                dateLabel
            )}
        </div>

        <div class="chart-tooltip-row">
            <span>Revenue</span>
            <strong>
                ${escapeHTML(
                    formatCurrency(
                        point.revenue,
                        currency
                    )
                )}
            </strong>
        </div>

        <div class="chart-tooltip-row">
            <span>Profit</span>
            <strong>
                ${escapeHTML(
                    formatCurrency(
                        point.profit,
                        currency
                    )
                )}
            </strong>
        </div>

        <div class="chart-tooltip-row">
            <span>Expenses</span>
            <strong>
                ${escapeHTML(
                    formatCurrency(
                        point.expenses,
                        currency
                    )
                )}
            </strong>
        </div>
    `;

    const containerRect =
        tooltip.parentElement
            ?.getBoundingClientRect();

    if (!containerRect) {
        return;
    }

    const width =
        tooltip.offsetWidth ||
        190;

    let left =
        event.clientX -
        containerRect.left +
        12;

    let top =
        event.clientY -
        containerRect.top -
        20;

    if (
        left +
        width >
        containerRect.width -
        8
    ) {
        left =
            event.clientX -
            containerRect.left -
            width -
            12;
    }

    top =
        clamp(
            top,
            8,
            Math.max(
                8,
                containerRect.height -
                (
                    tooltip.offsetHeight ||
                    120
                ) -
                8
            )
        );

    tooltip.style.left =
        `${Math.round(left)}px`;

    tooltip.style.top =
        `${Math.round(top)}px`;

    show(tooltip);
}


/* ============================================================
   27. TRANSACTIONS RENDER
   ============================================================ */

function renderTransactions() {

    const body =
        $("transactionsTableBody");

    const empty =
        $("transactionsEmpty");

    if (
        !body ||
        !empty
    ) {
        return;
    }

    body.replaceChildren();

    const filtered =
        state.transactions
            .slice()
            .sort(
                (
                    a,
                    b
                ) =>
                    new Date(
                        transactionDate(b) ||
                            0
                    ) -
                    new Date(
                        transactionDate(a) ||
                            0
                    )
            )
            .filter(
                transaction =>
                    matchesTransactionFilter(
                        transaction
                    )
            )
            .filter(
                transaction =>
                    transactionMatchesSearch(
                        transaction
                    )
            );

    if (
        !filtered.length
    ) {

        show(empty);

        return;
    }

    hide(empty);

    filtered.forEach(
        transaction => {

            const tr =
                document.createElement(
                    "tr"
                );

            const dateCell =
                td(
                    formatDate(
                        transactionDate(
                            transaction
                        )
                    )
                );

            const productCell =
                td(
                    transactionProductName(
                        transaction
                    )
                );

            const typeCell =
                createTypeStatusChip(
                    titleCase(
                        transactionType(
                            transaction
                        )
                    ),
                    "type-chip",
                    transactionType(
                        transaction
                    )
                );

            const quantityCell =
                td(
                    formatNumber(
                        transactionQuantity(
                            transaction
                        )
                    )
                );

            const currency =
                transaction.currency ||
                businessCurrency();

            const revenue =
                transactionRevenue(
                    transaction
                ) *
                transactionSign(
                    transaction
                );

            const cost =
                transactionCost(
                    transaction
                ) *
                transactionSign(
                    transaction
                );

            const profit =
                transactionProfit(
                    transaction
                );

            const revenueCell =
                td(
                    formatCurrency(
                        revenue,
                        currency
                    )
                );

            const costCell =
                td(
                    formatCurrency(
                        cost,
                        currency
                    )
                );

            const profitCell =
                td(
                    formatCurrency(
                        profit,
                        currency
                    )
                );

            applyFinancialTone(
                profitCell,
                profit
            );

            const statusCell =
                createTypeStatusChip(
                    titleCase(
                        normalizedStatus(
                            transaction
                        ) ||
                        "posted"
                    ),
                    "status-chip",
                    normalizedStatus(
                        transaction
                    ) || "posted"
                );

            const actionCell =
                document.createElement(
                    "td"
                );

            if (
                posted(transaction)
            ) {

                const button =
                    document.createElement(
                        "button"
                    );

                button.type =
                    "button";

                button.className =
                    "row-action-button danger-soft";

                button.dataset.action =
                    "void-transaction";

                button.dataset.id =
                    String(
                        transaction.id
                    );

                button.textContent =
                    "Void";

                actionCell.appendChild(
                    button
                );
            }

            tr.append(
                dateCell,
                productCell,
                typeCell,
                quantityCell,
                revenueCell,
                costCell,
                profitCell,
                statusCell,
                actionCell
            );

            body.appendChild(
                tr
            );
        }
    );
}

function td(
    value
) {

    const cell =
        document.createElement(
            "td"
        );

    cell.textContent =
        value === null ||
        value === undefined
            ? "—"
            : String(value);

    return cell;
}

function createTypeStatusChip(
    label,
    baseClass,
    tone
) {

    const chip =
        document.createElement(
            "span"
        );

    chip.className =
        `${baseClass} ${slug(tone)}`;

    chip.textContent =
        label;

    return chip;
}

function applyFinancialTone(
    element,
    value
) {

    element.classList.remove(
        "value-positive",
        "value-negative",
        "value-warning",
        "value-neutral"
    );

    const n =
        number(value);

    if (
        n > 0
    ) {
        element.classList.add(
            "value-positive"
        );
    } else if (
        n < 0
    ) {
        element.classList.add(
            "value-negative"
        );
    } else {
        element.classList.add(
            "value-neutral"
        );
    }
}


/* ============================================================
   28. PRODUCTS RENDER
   ============================================================ */

function renderProducts() {

    const body =
        $("productsTableBody");

    const empty =
        $("productsEmpty");

    if (
        !body ||
        !empty
    ) {
        return;
    }

    const products =
        activeProducts();

    body.replaceChildren();

    const currency =
        businessCurrency();

    setText(
        "productsTotalMetric",
        formatNumber(
            products.length
        )
    );

    const margins =
        products
            .map(
                product =>
                    productMetrics(
                        product
                    ).margin
            )
            .filter(
                value =>
                    value !== null
            );

    const averageMargin =
        margins.length
            ? margins.reduce(
                (
                    total,
                    value
                ) =>
                    total +
                    value,
                0
            ) /
              margins.length
            : null;

    setText(
        "productsMarginMetric",
        averageMargin === null
            ? "—"
            : formatPercent(
                averageMargin
            )
    );

    let totalUnits =
        0;

    let totalProfit =
        0;

    products.forEach(
        product => {

            const metrics =
                productMetrics(
                    product
                );

            totalUnits +=
                metrics.units;

            totalProfit +=
                metrics.profit;
        }
    );

    setText(
        "productsUnitsMetric",
        formatNumber(
            totalUnits
        )
    );

    setText(
        "productsProfitMetric",
        formatCurrency(
            totalProfit,
            currency
        )
    );

    if (
        !products.length
    ) {

        show(empty);

        populateProductSelect();

        return;
    }

    hide(empty);

    products.forEach(
        product => {

            const metrics =
                productMetrics(
                    product
                );

            const tr =
                document.createElement(
                    "tr"
                );

            tr.dataset.productId =
                String(
                    product.id
                );

            const name =
                td(
                    product.name ||
                        "Unnamed product"
                );

            const sku =
                td(
                    product.sku ||
                        "—"
                );

            const price =
                td(
                    formatCurrency(
                        productPrice(
                            product
                        ),
                        product.currency ||
                            currency
                    )
                );

            const cost =
                td(
                    formatCurrency(
                        productCost(
                            product
                        ),
                        product.currency ||
                            currency
                    )
                );

            const margin =
                td(
                    metrics.margin === null
                        ? "—"
                        : formatPercent(
                            metrics.margin
                        )
                );

            const units =
                td(
                    formatNumber(
                        metrics.units
                    )
                );

            const profit =
                td(
                    formatCurrency(
                        metrics.profit,
                        product.currency ||
                            currency
                    )
                );

            applyFinancialTone(
                profit,
                metrics.profit
            );

            const actions =
                document.createElement(
                    "td"
                );

            const wrapper =
                document.createElement(
                    "div"
                );

            wrapper.className =
                "table-actions";

            const edit =
                document.createElement(
                    "button"
                );

            edit.type =
                "button";

            edit.className =
                "row-action-button";

            edit.dataset.action =
                "edit-product";

            edit.dataset.id =
                String(
                    product.id
                );

            edit.textContent =
                "Edit";

            const archive =
                document.createElement(
                    "button"
                );

            archive.type =
                "button";

            archive.className =
                "row-action-button danger-soft";

            archive.dataset.action =
                "archive-product";

            archive.dataset.id =
                String(
                    product.id
                );

            archive.textContent =
                "Archive";

            wrapper.append(
                edit,
                archive
            );

            actions.appendChild(
                wrapper
            );

            tr.append(
                name,
                sku,
                price,
                cost,
                margin,
                units,
                profit,
                actions
            );

            body.appendChild(
                tr
            );
        }
    );

    populateProductSelect();
}


/* ============================================================
   29. PRODUCT SELECT
   ============================================================ */

function populateProductSelect() {

    const select =
        $("transactionProduct");

    if (!select) {
        return;
    }

    const current =
        select.value;

    const products =
        activeProducts();

    select.replaceChildren();

    const placeholder =
        document.createElement(
            "option"
        );

    placeholder.value =
        "";

    placeholder.disabled =
        true;

    placeholder.textContent =
        products.length
            ? "Select product"
            : "No products yet";

    select.appendChild(
        placeholder
    );

    products.forEach(
        product => {

            const option =
                document.createElement(
                    "option"
                );

            option.value =
                String(
                    product.id
                );

            option.textContent =
                product.name ||
                "Unnamed product";

            option.dataset.currency =
                product.currency ||
                businessCurrency();

            option.dataset.price =
                String(
                    productPrice(
                        product
                    )
                );

            option.dataset.cost =
                String(
                    productCost(
                        product
                    )
                );

            select.appendChild(
                option
            );
        }
    );

    if (
        current &&
        [...select.options]
            .some(
                option =>
                    option.value ===
                    current
            )
    ) {
        select.value =
            current;
    } else {
        select.value = "";
        placeholder.selected = true;
    }

    syncSelectedProduct();
}

function syncSelectedProduct() {

    const select =
        $("transactionProduct");

    if (!select) {
        return;
    }

    const option =
        select.options[
            select.selectedIndex
        ];

    if (
        !option ||
        !option.value
    ) {
        const price =
            $("transactionUnitPrice");

        const cost =
            $("transactionUnitCost");

        if (price) {
            price.value = "";
        }

        if (cost) {
            cost.value = "0";
        }

        updateTransactionPreview();

        return;
    }

    const price =
        $("transactionUnitPrice");

    const cost =
        $("transactionUnitCost");

    if (price) {
        price.value =
            option.dataset.price ||
            "";
    }

    if (cost) {
        cost.value =
            option.dataset.cost ||
            "";
    }

    syncTransactionCurrencyUI();

    updateTransactionPreview();
}

function syncTransactionCurrencyUI() {

    const select =
        $("transactionProduct");

    const currency =
        selectedProductCurrency();

    if (!select) {
        return;
    }

    const status =
        $("transactionCurrencyStatus");

    if (
        status
    ) {
        setText(
            status,
            currency
                ? `Currency: ${currency}`
                : ""
        );
    }

    const productCurrency =
        $("productCurrency");

    if (
        productCurrency &&
        currency
    ) {
        productCurrency.value =
            currency;
    }
}

function selectedProductCurrency() {

    const select =
        $("transactionProduct");

    if (!select) {
        return businessCurrency();
    }

    const option =
        select.options[
            select.selectedIndex
        ];

    return (
        option?.dataset.currency ||
        businessCurrency()
    );
}

function syncProductCurrencyUI() {

    const currency =
        businessCurrency();

    const field =
        $("productCurrency");

    if (!field) {
        return;
    }

    /*
       MVP money rule: business reports only in its base
       currency, so the product modal offers just that one
       currency. Server rejects any other value as a fallback.
    */
    if (
        field.options.length !== 1 ||
        field.options[0].value !== currency
    ) {

        field.replaceChildren();

        const option =
            document.createElement(
                "option"
            );

        option.value =
            currency;

        option.textContent =
            currency;

        field.appendChild(
            option
        );
    }

    field.value =
        currency;
}


/* ============================================================
   30. PRODUCT CREATE / UPDATE
   ============================================================ */

function openProductModal(
    productId = null
) {

    state.editingProductId =
        productId
            ? String(productId)
            : null;

    const title =
        $("productModalTitle");

    const button =
        $("productSubmitButton");

    resetProductForm();

    if (
        productId
    ) {

        const product =
            findProduct(
                productId
            );

        if (!product) {
            return;
        }

        setText(
            title,
            "Edit product"
        );

        setText(
            button,
            "Save changes"
        );

        if (
            $("productName")
        ) {
            $("productName").value =
                product.name || "";
        }

        if (
            $("productSku")
        ) {
            $("productSku").value =
                product.sku || "";
        }

        if (
            $("productDescription")
        ) {
            $("productDescription").value =
                product.description || "";
        }

        if (
            $("productCurrency")
        ) {
            $("productCurrency").value =
                product.currency ||
                businessCurrency();
        }

        if (
            $("productSalePrice")
        ) {
            $("productSalePrice").value =
                productPrice(
                    product
                );
        }

        if (
            $("productCost")
        ) {
            $("productCost").value =
                productCost(
                    product
                );
        }

    } else {

        setText(
            title,
            "New product"
        );

        setText(
            button,
            "Save product"
        );

        syncProductCurrencyUI();
    }

    openModal(
        "productModal"
    );
}

function resetProductForm() {

    const form =
        $("productForm");

    form?.reset();

    state.editingProductId =
        null;

    setFormStatus(
        "productFormStatus",
        "",
        false
    );

    syncProductCurrencyUI();
}

function closeProductModal() {

    closeModal(
        "productModal"
    );

    resetProductForm();
}

async function saveProduct() {

    const businessId =
        getBusinessId();

    if (!businessId) {

        setFormStatus(
            "productFormStatus",
            "Select a business first.",
            true
        );

        return;
    }

    const name =
        $("productName")?.value.trim();

    const sku =
        $("productSku")?.value.trim() ||
        null;

    const description =
        $("productDescription")?.value.trim() ||
        null;

    const currency =
        supportedCurrency(
            $("productCurrency")?.value ||
            businessCurrency()
        );

    const salePrice =
        number(
            $("productSalePrice")?.value
        );

    const cost =
        number(
            $("productCost")?.value
        );

    if (!name) {

        setFormStatus(
            "productFormStatus",
            "Enter a product name.",
            true
        );

        return;
    }

    if (
        salePrice < 0 ||
        cost < 0
    ) {

        setFormStatus(
            "productFormStatus",
            "Price and cost cannot be negative.",
            true
        );

        return;
    }

    const button =
        $("productSubmitButton");

    setBusy(
        button,
        true,
        state.editingProductId
            ? "Saving..."
            : "Creating..."
    );

    setFormStatus(
        "productFormStatus",
        "",
        false
    );

    try {

        const payload = {
            name,
            sku,
            description,
            currency,
            defaultSalePriceMinor:
                toMinor(
                    salePrice,
                    currency
                ),
            defaultCostPriceMinor:
                toMinor(
                    cost,
                    currency
                )
        };

        let response;

        if (
            state.editingProductId
        ) {

            response =
                await apiRequest(
                    `${productsApiPath()}/${encodeURIComponent(
                        state.editingProductId
                    )}`,
                    {
                        method: "PATCH",
                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

        } else {

            response =
                await apiRequest(
                    productsApiPath(),
                    {
                        method: "POST",
                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );
        }

        const product =
            extractEntity(
                response,
                [
                    "product",
                    "item"
                ]
            );

        if (product?.id) {

            if (
                state.editingProductId
            ) {

                state.products =
                    state.products.map(
                        existing =>
                            String(
                                existing.id
                            ) ===
                            String(
                                product.id
                            )
                                ? product
                                : existing
                    );

            } else {

                state.products.push(
                    product
                );
            }

        } else {

            await reloadProductsOnly();
        }

        closeProductModal();

        renderProducts();

        toast(
            state.editingProductId
                ? "Product updated."
                : "Product created."
        );

    } catch (error) {

        console.error(
            "Save product failed:",
            error
        );

        setFormStatus(
            "productFormStatus",
            error.message ||
                "Unable to save product.",
            true
        );

    } finally {

        setBusy(
            button,
            false
        );
    }
}

async function reloadProductsOnly() {

    const path =
        productsApiPath();

    if (!path) {
        return;
    }

    const payload =
        await apiRequest(
            path
        );

    state.products =
        extractArray(
            payload,
            [
                "products",
                "items",
                "results"
            ]
        );
}

async function archiveProduct(
    productId
) {

    const product =
        findProduct(
            productId
        );

    if (!product) {
        return;
    }

    requestConfirmation({
        title:
            "Archive product?",
        message:
            `Archive "${product.name || "this product"}"? It will no longer appear as an active product.`,
        confirmLabel:
            "Archive",
        tone:
            "danger",
        action:
            async () => {

                await apiRequest(
                    `${productsApiPath()}/${encodeURIComponent(
                        productId
                    )}/archive`,
                    {
                        method: "POST"
                    }
                );

                state.products =
                    state.products.map(
                        item =>
                            String(
                                item.id
                            ) ===
                            String(
                                productId
                            )
                                ? {
                                    ...item,
                                    status:
                                        "archived",
                                    archivedAt:
                                        new Date().toISOString()
                                }
                                : item
                    );

                renderProducts();

                toast(
                    "Product archived."
                );
            }
    });
}


/* ============================================================
   31. TRANSACTION FORM
   ============================================================ */

function resetTransactionForm() {

    const form =
        $("transactionForm");

    form?.reset();

    if (
        $("transactionDate")
    ) {
        $("transactionDate").value =
            today();
    }

    if (
        $("transactionQuantity")
    ) {
        $("transactionQuantity").value =
            "1";
    }

    if (
        $("transactionUnitCost")
    ) {
        $("transactionUnitCost").value =
            "0";
    }

    setFormStatus(
        "transactionFormStatus",
        "",
        false
    );

    setText(
        "transactionPreviewRevenue",
        formatCurrency(
            0,
            businessCurrency()
        )
    );

    setText(
        "transactionPreviewCost",
        formatCurrency(
            0,
            businessCurrency()
        )
    );

    setText(
        "transactionPreviewProfit",
        formatCurrency(
            0,
            businessCurrency()
        )
    );

    populateProductSelect();
}

function updateTransactionPreview() {

    const product =
        findProduct(
            $("transactionProduct")?.value
        );

    const currency =
        product?.currency ||
        businessCurrency();

    const quantity =
        Math.max(
            0,
            number(
                $("transactionQuantity")?.value
            )
        );

    const unitPrice =
        number(
            $("transactionUnitPrice")?.value
        );

    const unitCost =
        number(
            $("transactionUnitCost")?.value
        );

    let sign =
        transactionSign({
            type:
                $("transactionType")?.value ||
                "sale"
        });

    const revenue =
        unitPrice *
        quantity *
        sign;

    const cost =
        unitCost *
        quantity *
        sign;

    const profit =
        revenue -
        cost;

    setText(
        "transactionPreviewRevenue",
        formatCurrency(
            revenue,
            currency
        )
    );

    setText(
        "transactionPreviewCost",
        formatCurrency(
            cost,
            currency
        )
    );

    setText(
        "transactionPreviewProfit",
        formatCurrency(
            profit,
            currency
        )
    );

    applyValueTone(
        $("transactionPreviewProfit"),
        profit
    );
}

function buildTransactionPayload() {

    const productId =
        $("transactionProduct")?.value ||
        null;

    const product =
        findProduct(
            productId
        );

    const type =
        lower(
            $("transactionType")?.value ||
            "sale"
        );

    const status =
        lower(
            $("transactionStatus")?.value ||
            "posted"
        );

    const date =
        $("transactionDate")?.value ||
        today();

    const quantity =
        Math.max(
            0,
            number(
                $("transactionQuantity")?.value
            )
        );

    const currency =
        product?.currency ||
        businessCurrency();

    const unitPrice =
        number(
            $("transactionUnitPrice")?.value
        );

    const unitCost =
        number(
            $("transactionUnitCost")?.value
        );

    const note =
        $("transactionNote")?.value.trim() ||
        null;

    if (
        !validDate(date)
    ) {
        throw new Error(
            "Enter a valid transaction date."
        );
    }

    if (
        !productId
    ) {
        throw new Error(
            "Select a product."
        );
    }

    if (
        quantity <= 0
    ) {
        throw new Error(
            "Quantity must be greater than zero."
        );
    }

    if (
        unitPrice < 0 ||
        unitCost < 0
    ) {
        throw new Error(
            "Price and cost cannot be negative."
        );
    }

    const subtotalMinor =
        toMinor(
            unitPrice,
            currency
        ) * quantity;

    const costTotalMinor =
        toMinor(
            unitCost,
            currency
        ) * quantity;

    return {
        type,
        status,
        transactionDate: date,
        currency,
        subtotalMinor,
        discountTotalMinor: 0,
        taxTotalMinor: 0,
        totalMinor: subtotalMinor,
        costTotalMinor,
        notes: note,
        lines: [
            {
                productId,
                quantity,
                unitPriceMinor:
                    toMinor(
                        unitPrice,
                        currency
                    ),
                unitCostMinor:
                    toMinor(
                        unitCost,
                        currency
                    ),
                revenueMinor: subtotalMinor,
                costMinor: costTotalMinor
            }
        ]
    };
}

async function createTransaction() {

    const path =
        transactionsApiPath();

    if (!path) {

        setFormStatus(
            "transactionFormStatus",
            "Select a business first.",
            true
        );

        return;
    }

    let payload;

    try {

        payload =
            buildTransactionPayload();

    } catch (error) {

        setFormStatus(
            "transactionFormStatus",
            error.message,
            true
        );

        return;
    }

    const button =
        $("transactionSubmitButton");

    setBusy(
        button,
        true,
        "Creating..."
    );

    setFormStatus(
        "transactionFormStatus",
        "",
        false
    );

    try {

        const response =
            await apiRequest(
                path,
                {
                    method: "POST",
                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        const transaction =
            extractEntity(
                response,
                [
                    "transaction",
                    "item"
                ]
            );

        if (
            transaction?.id
        ) {

            state.transactions.push(
                transaction
            );

        } else {

            await reloadTransactionsOnly();
        }

        closeModal(
            "transactionModal"
        );

        resetTransactionForm();

        renderTransactions();

        renderDashboard();

        refreshAnalyticsForPeriod();

        toast(
            "Transaction created."
        );

    } catch (error) {

        console.error(
            "Create transaction failed:",
            error
        );

        setFormStatus(
            "transactionFormStatus",
            error.message ||
                "Unable to create transaction.",
            true
        );

    } finally {

        setBusy(
            button,
            false
        );
    }
}

async function reloadTransactionsOnly() {

    const path =
        transactionsApiPath();

    if (!path) {
        return;
    }

    const response =
        await apiRequest(
            path
        );

    state.transactions =
        extractArray(
            response,
            [
                "transactions",
                "items",
                "results"
            ]
        );
}

async function voidTransaction(
    transactionId
) {

    const transaction =
        state.transactions.find(
            item =>
                String(item.id) ===
                String(transactionId)
        );

    if (!transaction) {
        return;
    }

    requestConfirmation({
        title:
            "Void transaction?",
        message:
            "Voiding changes the transaction state without deleting the historical record.",
        confirmLabel:
            "Void transaction",
        tone:
            "danger",
        action:
            async () => {

                await apiRequest(
                    `${transactionsApiPath()}/${encodeURIComponent(
                        transactionId
                    )}`,
                    {
                        method: "PATCH",
                        body:
                            JSON.stringify({
                                status:
                                    "voided"
                            })
                    }
                );

                state.transactions =
                    state.transactions.map(
                        item =>
                            String(
                                item.id
                            ) ===
                            String(
                                transactionId
                            )
                                ? {
                                    ...item,
                                    status:
                                        "voided"
                                }
                                : item
                    );

                renderTransactions();

                renderDashboard();

                refreshAnalyticsForPeriod();

                toast(
                    "Transaction voided."
                );
            }
    });
}

async function voidExpense(
    expenseId
) {

    const expense =
        state.expenses.find(
            item =>
                String(item.id) ===
                String(expenseId)
        );

    if (!expense) {
        return;
    }

    requestConfirmation({
        title:
            "Void expense?",
        message:
            "Voiding removes the expense from totals without deleting the historical record.",
        confirmLabel:
            "Void expense",
        tone:
            "danger",
        action:
            async () => {

                await apiRequest(
                    `${expensesApiPath()}/${encodeURIComponent(
                        expenseId
                    )}/void`,
                    {
                        method: "POST"
                    }
                );

                state.expenses =
                    state.expenses.map(
                        item =>
                            String(
                                item.id
                            ) ===
                            String(
                                expenseId
                            )
                                ? {
                                    ...item,
                                    status:
                                        "voided"
                                }
                                : item
                    );

                renderExpenses();

                renderDashboard();

                refreshAnalyticsForPeriod();

                toast(
                    "Expense voided."
                );
            }
    });
}


/* ============================================================
   32. EXPENSES RENDER / CREATE
   ============================================================ */

function renderExpenses() {

    const body =
        $("expensesTableBody");

    const empty =
        $("expensesEmpty");

    if (
        !body ||
        !empty
    ) {
        return;
    }

    body.replaceChildren();

    const currency =
        businessCurrency();

    const postedExpenses =
        state.expenses.filter(
            expense =>
                posted(expense)
        );

    const expenseTotal =
        postedExpenses.reduce(
            (
                total,
                expense
            ) =>
                total +
                expenseAmount(
                    expense
                ),
            0
        );

    setText(
        "expensesPostedMetric",
        formatCurrency(
            expenseTotal,
            currency
        )
    );

    const categories =
        unique(
            state.expenses.map(
                expense =>
                    expenseCategory(
                        expense
                    )
            )
        );

    setText(
        "expenseCategoriesMetric",
        formatNumber(
            categories.length
        )
    );

    const categoryTotals =
        buildExpenseCategoryTotals();

    const largest =
        categoryTotals
            .sort(
                (
                    a,
                    b
                ) =>
                    b.total -
                    a.total
            )[0];

    setText(
        "largestExpenseCategoryMetric",
        largest?.name ||
            "—"
    );

    setText(
        "expensePeriodMetric",
        periodLabel()
    );

    const sorted =
        state.expenses
            .slice()
            .sort(
                (
                    a,
                    b
                ) =>
                    new Date(
                        expenseDate(b) ||
                            0
                    ) -
                    new Date(
                        expenseDate(a) ||
                            0
                    )
            );

    if (
        !sorted.length
    ) {

        show(empty);

        renderExpenseCategories();

        return;
    }

    hide(empty);

    sorted.forEach(
        expense => {

            const tr =
                document.createElement(
                    "tr"
                );

            tr.append(
                td(
                    formatDate(
                        expenseDate(
                            expense
                        )
                    )
                ),

                td(
                    expenseCategory(
                        expense
                    )
                ),

                td(
                    expense.description ||
                    "—"
                ),

                td(
                    expense.vendor ||
                    "—"
                ),

                td(
                    formatCurrency(
                        expenseAmount(
                            expense
                        ),
                        expense.currency ||
                            currency
                    )
                ),

                createTypeStatusChip(
                    titleCase(
                        normalizedStatus(
                            expense
                        ) ||
                        "posted"
                    ),
                    "status-chip",
                    normalizedStatus(
                        expense
                    ) || "posted"
                ),

                createExpenseActionCell(
                    expense
                )
            );

            body.appendChild(
                tr
            );
        }
    );

    renderExpenseCategories();
}

function createExpenseActionCell(
    expense
) {

    const cell =
        document.createElement(
            "td"
        );

    if (
        posted(expense)
    ) {

        const button =
            document.createElement(
                "button"
            );

        button.type =
            "button";

        button.className =
            "row-action-button danger-soft";

        button.dataset.action =
            "void-expense";

        button.dataset.id =
            String(
                expense.id
            );

        button.textContent =
            "Void";

        cell.appendChild(
            button
        );
    }

    return cell;
}

function buildExpenseCategoryTotals() {

    const totals =
        new Map();

    state.expenses
        .filter(
            expense =>
                posted(expense)
        )
        .forEach(
            expense => {

                const name =
                    expenseCategory(
                        expense
                    );

                const amount =
                    expenseAmount(
                        expense
                    );

                totals.set(
                    name,
                    (
                        totals.get(
                            name
                        ) || 0
                    ) + amount
                );
            }
        );

    return Array.from(
        totals.entries()
    ).map(
        ([name, total]) => ({
            name,
            total
        })
    );
}

function renderExpenseCategories() {

    const container =
        $("expenseCategoryBreakdown");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const totals =
        buildExpenseCategoryTotals()
            .sort(
                (
                    a,
                    b
                ) =>
                    b.total -
                    a.total
            );

    if (
        !totals.length
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "mini-list-empty";

        empty.innerHTML = `
            <strong>No posted expenses</strong>
            <span>Category totals appear after expenses are posted.</span>
        `;

        container.appendChild(
            empty
        );

        return;
    }

    const total =
        totals.reduce(
            (
                sum,
                item
            ) =>
                sum +
                item.total,
            0
        );

    totals.forEach(
        item => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "category-row";

            const label =
                document.createElement(
                    "div"
                );

            label.className =
                "category-row-top";

            const name =
                document.createElement(
                    "span"
                );

            name.textContent =
                item.name;

            const value =
                document.createElement(
                    "strong"
                );

            value.textContent =
                formatCurrency(
                    item.total,
                    businessCurrency()
                );

            label.append(
                name,
                value
            );

            const track =
                document.createElement(
                    "div"
                );

            track.className =
                "progress-track";

            const fill =
                document.createElement(
                    "div"
                );

            fill.className =
                "progress-fill";

            fill.style.width =
                total
                    ? `${clamp(
                        item.total /
                        total *
                        100,
                        0,
                        100
                    )}%`
                    : "0%";

            track.appendChild(
                fill
            );

            row.append(
                label,
                track
            );

            container.appendChild(
                row
            );
        }
    );
}

function resetExpenseForm() {

    $("expenseForm")
        ?.reset();

    if (
        $("expenseDate")
    ) {
        $("expenseDate").value =
            today();
    }

    setFormStatus(
        "expenseFormStatus",
        "",
        false
    );
}

async function createExpense() {

    const path =
        expensesApiPath();

    if (!path) {

        setFormStatus(
            "expenseFormStatus",
            "Select a business first.",
            true
        );

        return;
    }

    const date =
        $("expenseDate")?.value ||
        today();

    const category =
        $("expenseCategory")?.value.trim();

    const description =
        $("expenseDescription")?.value.trim() ||
        null;

    const vendor =
        $("expenseVendor")?.value.trim() ||
        null;

    const note =
        $("expenseNote")?.value.trim() ||
        null;

    const amount =
        number(
            $("expenseAmount")?.value
        );

    const status =
        lower(
            $("expenseStatus")?.value ||
            "posted"
        );

    const currency =
        businessCurrency();

    if (
        !validDate(date)
    ) {

        setFormStatus(
            "expenseFormStatus",
            "Enter a valid date.",
            true
        );

        return;
    }

    if (
        !category
    ) {

        setFormStatus(
            "expenseFormStatus",
            "Enter an expense category.",
            true
        );

        return;
    }

    if (
        amount < 0
    ) {

        setFormStatus(
            "expenseFormStatus",
            "Amount cannot be negative.",
            true
        );

        return;
    }

    const button =
        $("expenseSubmitButton");

    setBusy(
        button,
        true,
        "Creating..."
    );

    setFormStatus(
        "expenseFormStatus",
        "",
        false
    );

    try {

        const payload = {
            date,
            category,
            description,
            vendor,
            note,
            status,
            currency,
            amountMinor:
                toMinor(
                    amount,
                    currency
                )
        };

        const response =
            await apiRequest(
                path,
                {
                    method: "POST",
                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        const expense =
            extractEntity(
                response,
                [
                    "expense",
                    "item"
                ]
            );

        if (
            expense?.id
        ) {

            state.expenses.push(
                expense
            );

        } else {

            await reloadExpensesOnly();
        }

        closeModal(
            "expenseModal"
        );

        resetExpenseForm();

        renderExpenses();

        renderDashboard();

        refreshAnalyticsForPeriod();

        toast(
            "Expense created."
        );

    } catch (error) {

        console.error(
            "Create expense failed:",
            error
        );

        setFormStatus(
            "expenseFormStatus",
            error.message ||
                "Unable to create expense.",
            true
        );

    } finally {

        setBusy(
            button,
            false
        );
    }
}

async function reloadExpensesOnly() {

    const path =
        expensesApiPath();

    if (!path) {
        return;
    }

    const response =
        await apiRequest(
            path
        );

    const data =
        unwrap(response);

    state.expenses =
        extractArray(
            data,
            [
                "expenses",
                "items",
                "results"
            ]
        );

    state.expenseCategories =
        extractArray(
            data,
            [
                "categories",
                "expenseCategories"
            ]
        );
}


/* ============================================================
   33. GOALS RENDER / CREATE
   ============================================================ */

function updateGoalTargetUI() {

    const type =
        goalType({
            type:
                $("goalType")?.value ||
                "revenue"
        });

    const currencyField =
        $("goalCurrencyField");

    const target =
        $("goalTarget");

    if (
        [
            "margin",
            "roi"
        ].includes(type)
    ) {

        show(
            currencyField
        );

        if (target) {
            target.step =
                "0.1";
            target.placeholder =
                "0";
        }

    } else if (
        type ===
        "sales_count"
    ) {

        hide(
            currencyField
        );

        if (target) {
            target.step =
                "1";
            target.placeholder =
                "0";
        }

    } else {

        show(
            currencyField
        );

        if (target) {
            target.step =
                "0.01";
            target.placeholder =
                "0.00";
        }
    }
}

function renderGoals() {

    const grid =
        $("goalsGrid");

    const empty =
        $("goalsEmpty");

    if (
        !grid ||
        !empty
    ) {
        return;
    }

    grid.replaceChildren();

    const goals =
        state.goals;

    const activeGoals =
        goals.filter(
            goal =>
                goalIsActive(goal)
        );

    if (
        !goals.length
    ) {

        show(empty);

    } else {

        hide(empty);

        goals
            .slice()
            .sort(
                (
                    a,
                    b
                ) =>
                    goalProgress(a) -
                    goalProgress(b)
            )
            .forEach(
                goal =>
                    grid.appendChild(
                        createGoalCard(
                            goal
                        )
                    )
            );
    }

    renderGoalHighlight(
        activeGoals
    );
}

function createGoalCard(
    goal
) {

    const article =
        document.createElement(
            "article"
        );

    article.className =
        "goal-card";

    article.dataset.goalId =
        String(
            goal.id
        );

    const type =
        goalType(goal);

    const current =
        goalCurrent(goal);

    const target =
        goalTarget(goal);

    const progress =
        goalProgress(goal);

    const bounds =
        goalBounds(goal);

    article.innerHTML = `
        <div class="goal-card-top">
            <div>
                <span class="goal-card-type">
                    ${escapeHTML(
                        titleCase(type)
                    )}
                </span>

                <h3 class="goal-card-name">
                    ${escapeHTML(
                        goal.name ||
                        titleCase(type)
                    )}
                </h3>
            </div>

            <button
                class="icon-button goal-menu-button"
                type="button"
                aria-label="Goal options"
                data-action="goal-menu"
                data-id="${escapeHTML(
                    goal.id
                )}"
            >
                •••
            </button>
        </div>

        <div class="goal-card-values">
            <strong class="goal-card-current">
                ${escapeHTML(
                    formatGoalValue(
                        goal,
                        current
                    )
                )}
            </strong>

            <span>/</span>

            <span class="goal-card-target">
                ${escapeHTML(
                    formatGoalValue(
                        goal,
                        target
                    )
                )}
            </span>
        </div>

        <div class="progress-track">
            <div
                class="progress-fill goal-card-progress"
                style="width:${clamp(
                    progress,
                    0,
                    100
                )}%"
            ></div>
        </div>

        <div class="goal-card-footer">
            <span class="goal-card-progress-label">
                ${escapeHTML(
                    formatPercent(
                        progress,
                        0
                    )
                )}
            </span>

            <span class="goal-card-period">
                ${escapeHTML(
                    formatGoalDateRange(
                        bounds
                    )
                )}
            </span>
        </div>
    `;

    return article;
}

function renderGoalHighlight(
    goals
) {

    const title =
        $("goalHighlightTitle");

    const description =
        $("goalHighlightDescription");

    const progressLabel =
        $("goalHighlightProgress");

    const progressBar =
        $("goalHighlightProgressBar");

    if (
        !title ||
        !description ||
        !progressLabel ||
        !progressBar
    ) {
        return;
    }

    if (
        !goals.length
    ) {

        setText(
            title,
            "No active goal"
        );

        setText(
            description,
            "Create a financial goal to start tracking progress."
        );

        setText(
            progressLabel,
            "0%"
        );

        progressBar.style.width =
            "0%";

        return;
    }

    const next =
        goals
            .slice()
            .sort(
                (
                    a,
                    b
                ) =>
                    goalProgress(a) -
                    goalProgress(b)
            )[0];

    const progress =
        goalProgress(
            next
        );

    setText(
        title,
        next.name ||
            titleCase(
                goalType(next)
            )
    );

    setText(
        description,
        `${formatGoalValue(
            next,
            goalCurrent(next)
        )} of ${formatGoalValue(
            next,
            goalTarget(next)
        )}`
    );

    setText(
        progressLabel,
        formatPercent(
            progress,
            0
        )
    );

    progressBar.style.width =
        `${clamp(
            progress,
            0,
            100
        )}%`;
}

function formatGoalDateRange(
    bounds
) {

    if (
        !bounds.from &&
        !bounds.to
    ) {
        return "Current period";
    }

    if (
        bounds.from &&
        bounds.to
    ) {
        return (
            `${formatDate(
                bounds.from,
                {
                    month: "short",
                    day: "numeric"
                }
            )} — ` +
            `${formatDate(
                bounds.to,
                {
                    month: "short",
                    day: "numeric"
                }
            )}`
        );
    }

    if (bounds.to) {
        return `Until ${formatDate(
            bounds.to
        )}`;
    }

    return `From ${formatDate(
        bounds.from
    )}`;
}

async function createGoal() {

    const path =
        goalsApiPath();

    if (!path) {

        setFormStatus(
            "goalFormStatus",
            "Select a business first.",
            true
        );

        return;
    }

    const name =
        $("goalName")?.value.trim();

    const type =
        lower(
            $("goalType")?.value ||
            "revenue"
        );

    const target =
        number(
            $("goalTarget")?.value
        );

    const periodDays =
        integer(
            $("goalPeriod")?.value,
            30
        );

    const currency =
        supportedCurrency(
            $("goalCurrency")?.value ||
            businessCurrency()
        );

    if (!name) {

        setFormStatus(
            "goalFormStatus",
            "Enter a goal name.",
            true
        );

        return;
    }

    if (
        target <= 0
    ) {

        setFormStatus(
            "goalFormStatus",
            "Target must be greater than zero.",
            true
        );

        return;
    }

    const from =
        dateToISODate(
            getDateDaysAgo(
                periodDays
            )
        );

    const to =
        today();

    const button =
        $("goalSubmitButton");

    setBusy(
        button,
        true,
        "Creating..."
    );

    setFormStatus(
        "goalFormStatus",
        "",
        false
    );

    try {

        const payload = {
            name,
            type,
            target:
                [
                    "margin",
                    "roi",
                    "sales_count"
                ].includes(type)
                    ? target
                    : undefined,

            targetMinor:
                [
                    "margin",
                    "roi",
                    "sales_count"
                ].includes(type)
                    ? undefined
                    : toMinor(
                        target,
                        currency
                    ),

            currency:
                [
                    "margin",
                    "roi",
                    "sales_count"
                ].includes(type)
                    ? null
                    : currency,

            startDate:
                from,

            endDate:
                to
        };

        removeUndefined(
            payload
        );

        const response =
            await apiRequest(
                path,
                {
                    method: "POST",
                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        const goal =
            extractEntity(
                response,
                [
                    "goal",
                    "item"
                ]
            );

        if (
            goal?.id
        ) {

            state.goals.push(
                goal
            );

        } else {

            await reloadGoalsOnly();
        }

        closeModal(
            "goalModal"
        );

        resetGoalForm();

        renderGoals();

        refreshAnalyticsForPeriod();

        toast(
            "Goal created."
        );

    } catch (error) {

        console.error(
            "Create goal failed:",
            error
        );

        setFormStatus(
            "goalFormStatus",
            error.message ||
                "Unable to create goal.",
            true
        );

    } finally {

        setBusy(
            button,
            false
        );
    }
}

async function reloadGoalsOnly() {

    const path =
        goalsApiPath();

    if (!path) {
        return;
    }

    const response =
        await apiRequest(
            path
        );

    state.goals =
        extractArray(
            response,
            [
                "goals",
                "items",
                "results"
            ]
        );
}

function resetGoalForm() {

    $("goalForm")
        ?.reset();

    setFormStatus(
        "goalFormStatus",
        "",
        false
    );

    updateGoalTargetUI();

    if (
        $("goalCurrency")
    ) {
        $("goalCurrency").value =
            businessCurrency();
    }
}


/* ============================================================
   34. REPORTS
   ============================================================ */

function renderReports() {

    const stats =
        dashboardStats();

    const currency =
        businessCurrency();

    setText(
        "reportRevenue",
        formatCurrency(
            stats.revenue,
            currency
        )
    );

    setText(
        "reportGrossProfit",
        formatCurrency(
            stats.grossProfit,
            currency
        )
    );

    setText(
        "reportNetProfit",
        formatCurrency(
            stats.netProfit,
            currency
        )
    );

    setText(
        "reportExpenses",
        formatCurrency(
            stats.expenses,
            currency
        )
    );

    renderReportComparison(
        stats
    );

    renderReportProducts();
}

function renderReportComparison(
    stats
) {

    const container =
        $("reportComparison");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const server =
        normalizeAnalyticsSummary();

    const rows = [
        {
            label:
                "Revenue change",
            value:
                getChange(
                    stats.revenue,
                    server?.previousRevenue
                )
        },
        {
            label:
                "Profit change",
            value:
                getChange(
                    stats.netProfit,
                    server?.previousProfit
                )
        },
        {
            label:
                "Expense change",
            value:
                getChange(
                    stats.expenses,
                    server?.previousExpenses
                )
        },
        {
            label:
                "Gross margin",
            value:
                stats.margin
        },
        {
            label:
                "ROI",
            value:
                stats.roi
        }
    ];

    rows.forEach(
        row => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "comparison-row";

            const label =
                document.createElement(
                    "span"
                );

            label.textContent =
                row.label;

            const value =
                document.createElement(
                    "strong"
                );

            if (
                [
                    "Gross margin",
                    "ROI"
                ].includes(
                    row.label
                )
            ) {
                value.textContent =
                    row.value === null
                        ? "—"
                        : formatPercent(
                            row.value
                        );
            } else {

                value.textContent =
                    row.value === null
                        ? "—"
                        : formatChangePercent(
                            row.value
                        );

                if (
                    row.value !== null
                ) {
                    value.classList.add(
                        row.value >= 0
                            ? "value-positive"
                            : "value-negative"
                    );
                }
            }

            item.append(
                label,
                value
            );

            container.appendChild(
                item
            );
        }
    );
}

function renderReportProducts() {

    const container =
        $("reportProductPerformance");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const products =
        activeProducts()
            .map(
                product => ({
                    product,
                    metrics:
                        productMetrics(
                            product
                        )
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.metrics.profit -
                    a.metrics.profit
            )
            .slice(
                0,
                8
            );

    if (
        !products.length
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "mini-list-empty";

        empty.innerHTML = `
            <strong>No product performance yet</strong>
            <span>Product results appear from real posted transactions.</span>
        `;

        container.appendChild(
            empty
        );

        return;
    }

    products.forEach(
        entry => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "report-product-row";

            const copy =
                document.createElement(
                    "div"
                );

            const name =
                document.createElement(
                    "strong"
                );

            name.textContent =
                entry.product.name ||
                "Unnamed product";

            const units =
                document.createElement(
                    "small"
                );

            units.textContent =
                `${formatNumber(
                    entry.metrics.units
                )} units`;

            copy.append(
                name,
                units
            );

            const profit =
                document.createElement(
                    "strong"
                );

            profit.textContent =
                formatCurrency(
                    entry.metrics.profit,
                    entry.product.currency ||
                        businessCurrency()
                );

            applyFinancialTone(
                profit,
                entry.metrics.profit
            );

            row.append(
                copy,
                profit
            );

            container.appendChild(
                row
            );
        }
    );
}


/* ============================================================
   35. ANALYTICS RENDER
   ============================================================ */

function renderAnalytics() {

    const summary =
        normalizeAnalyticsSummary();

    const currency =
        businessCurrency();

    const stats =
        summary ||
        calculateStats(
            rangeBounds().from,
            rangeBounds().to
        );

    setText(
        "analyticsRevenue",
        formatCurrency(
            stats.revenue,
            currency
        )
    );

    setText(
        "analyticsProfit",
        formatCurrency(
            stats.netProfit ??
                stats.grossProfit ??
                0,
            currency
        )
    );

    setText(
        "analyticsMargin",
        stats.margin === null ||
        stats.margin === undefined
            ? "—"
            : formatPercent(
                stats.margin
            )
    );

    setText(
        "analyticsRoi",
        stats.roi === null ||
        stats.roi === undefined
            ? "—"
            : formatPercent(
                stats.roi
            )
    );

    setChange(
        "analyticsRevenueChange",
        getChange(
            stats.revenue,
            summary?.previousRevenue
        )
    );

    setChange(
        "analyticsProfitChange",
        getChange(
            stats.netProfit,
            summary?.previousProfit
        )
    );

    setChange(
        "analyticsMarginChange",
        null
    );

    setChange(
        "analyticsRoiChange",
        null
    );

    renderAnalyticsChart();

    renderAnalyticsInsights(
        stats
    );

    renderUnitEconomics(
        stats
    );

    renderAnalyticsRankings();
}

function renderAnalyticsChart() {

    const series =
        analyticsSeries();

    const empty =
        $("analyticsChartEmpty");

    const svg =
        $("analyticsChartSvg");

    if (
        !empty ||
        !svg
    ) {
        return;
    }

    if (
        !series.length
    ) {

        show(empty);

        setAttributeSafe(
            $("analyticsRevenuePath"),
            "d",
            ""
        );

        setAttributeSafe(
            $("analyticsProfitPath"),
            "d",
            ""
        );

        setAttributeSafe(
            $("analyticsExpensesPath"),
            "d",
            ""
        );

        return;
    }

    hide(empty);

    const width =
        1200;

    const height =
        460;

    const left =
        63;

    const right =
        24;

    const top =
        24;

    const bottom =
        49;

    const chartWidth =
        width -
        left -
        right;

    const chartHeight =
        height -
        top -
        bottom;

    const domain =
        chartDomain(
            series
        );

    const xStep =
        series.length <= 1
            ? chartWidth / 2
            : chartWidth /
                (
                    series.length -
                    1
                );

    const y =
        value =>
            top +
            chartHeight *
            (
                1 -
                (
                    number(value) -
                    domain.min
                ) /
                (
                    domain.max -
                    domain.min
                )
            );

    const make =
        key =>
            series.map(
                (
                    point,
                    index
                ) => ({
                    x:
                        left +
                        index *
                        xStep,
                    y:
                        y(
                            point[key]
                        ),
                    value:
                        number(
                            point[key]
                        )
                })
            );

    setAttributeSafe(
        $("analyticsRevenuePath"),
        "d",
        linePath(
            make("revenue")
                .map(
                    (
                        point,
                        index
                    ) => ({
                        ...point,
                        date:
                            series[
                                index
                            ].date
                    })
                )
        )
    );

    setAttributeSafe(
        $("analyticsProfitPath"),
        "d",
        linePath(
            make("profit")
                .map(
                    (
                        point,
                        index
                    ) => ({
                        ...point,
                        date:
                            series[
                                index
                            ].date
                    })
                )
        )
    );

    setAttributeSafe(
        $("analyticsExpensesPath"),
        "d",
        linePath(
            make("expenses")
                .map(
                    (
                        point,
                        index
                    ) => ({
                        ...point,
                        date:
                            series[
                                index
                            ].date
                    })
                )
        )
    );

    renderAnalyticsGrid(
        domain,
        series
    );
}

function renderAnalyticsGrid(
    domain,
    series
) {

    const grid =
        $("analyticsChartGrid");

    const labels =
        $("analyticsChartLabels");

    if (
        !grid ||
        !labels
    ) {
        return;
    }

    grid.replaceChildren();
    labels.replaceChildren();

    const width =
        1200;

    const height =
        460;

    const left =
        63;

    const right =
        24;

    const top =
        24;

    const bottom =
        49;

    const chartWidth =
        width -
        left -
        right;

    const chartHeight =
        height -
        top -
        bottom;

    for (
        let i = 0;
        i <= 5;
        i++
    ) {

        const y =
            top +
            chartHeight *
            (
                i / 5
            );

        const line =
            document.createElementNS(
                "http://www.w3.org/2000/svg",
                "line"
            );

        line.setAttribute(
            "x1",
            String(left)
        );

        line.setAttribute(
            "x2",
            String(
                width -
                right
            )
        );

        line.setAttribute(
            "y1",
            String(y)
        );

        line.setAttribute(
            "y2",
            String(y)
        );

        line.setAttribute(
            "class",
            "chart-grid-line"
        );

        grid.appendChild(
            line
        );

        const value =
            domain.max -
            (
                domain.max -
                domain.min
            ) *
            (
                i / 5
            );

        const label =
            document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text"
            );

        label.setAttribute(
            "x",
            String(
                left -
                11
            )
        );

        label.setAttribute(
            "y",
            String(
                y + 4
            )
        );

        label.setAttribute(
            "text-anchor",
            "end"
        );

        label.setAttribute(
            "class",
            "chart-axis-label"
        );

        label.textContent =
            compactMoney(
                value,
                businessCurrency()
            );

        labels.appendChild(
            label
        );
    }

    const indexes =
        chooseChartLabelIndexes(
            series.length,
            7
        );

    indexes.forEach(
        index => {

            const point =
                series[
                    index
                ];

            const x =
                left +
                (
                    series.length <= 1
                        ? chartWidth / 2
                        : chartWidth /
                            (
                                series.length -
                                1
                            ) *
                            index
                );

            const label =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "text"
                );

            label.setAttribute(
                "x",
                String(x)
            );

            label.setAttribute(
                "y",
                String(
                    height -
                    13
                )
            );

            label.setAttribute(
                "text-anchor",
                "middle"
            );

            label.setAttribute(
                "class",
                "chart-axis-label"
            );

            label.textContent =
                formatChartDate(
                    point.date ||
                    point.label
                );

            labels.appendChild(
                label
            );
        }
    );
}

function renderAnalyticsInsights(
    stats
) {

    const container =
        $("analyticsInsights");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const insights = [];

    if (
        stats.revenue >
        0
    ) {

        insights.push({
            title:
                "Revenue is being tracked",
            text:
                `${formatCurrency(
                    stats.revenue,
                    businessCurrency()
                )} is recorded for the selected period.`,
            tone:
                "positive"
        });

    } else {

        insights.push({
            title:
                "No revenue data",
            text:
                "Post real sales transactions to generate revenue analytics.",
            tone:
                "neutral"
        });
    }

    if (
        stats.expenses >
        0
    ) {

        insights.push({
            title:
                "Expenses are visible",
            text:
                `${formatCurrency(
                    stats.expenses,
                    businessCurrency()
                )} of posted expenses are included in the selected period.`,
            tone:
                "neutral"
        });

    } else {

        insights.push({
            title:
                "No posted expenses",
            text:
                "Expense analytics will appear when real expenses are posted.",
            tone:
                "neutral"
        });
    }

    if (
        stats.margin !== null &&
        stats.margin !== undefined
    ) {

        insights.push({
            title:
                "Gross margin",
            text:
                `Gross margin for the selected period is ${formatPercent(
                    stats.margin
                )}.`,
            tone:
                stats.margin >= 0
                    ? "positive"
                    : "negative"
        });

    } else {

        insights.push({
            title:
                "Margin unavailable",
            text:
                "A margin can be calculated once revenue exists in the selected period.",
            tone:
                "neutral"
        });
    }

    insights.forEach(
        insight => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                `insight-item ${insight.tone}`;

            const marker =
                document.createElement(
                    "span"
                );

            marker.className =
                "insight-marker";

            const copy =
                document.createElement(
                    "div"
                );

            const title =
                document.createElement(
                    "strong"
                );

            title.textContent =
                insight.title;

            const text =
                document.createElement(
                    "p"
                );

            text.textContent =
                insight.text;

            copy.append(
                title,
                text
            );

            item.append(
                marker,
                copy
            );

            container.appendChild(
                item
            );
        }
    );
}

function renderUnitEconomics(
    stats
) {

    const container =
        $("unitEconomics");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const sales =
        Math.max(
            0,
            number(
                stats.sales
            )
        );

    const averageRevenue =
        sales > 0
            ? stats.revenue /
                sales
            : null;

    const averageProfit =
        sales > 0
            ? stats.netProfit /
                sales
            : null;

    const items = [
        [
            "Average revenue / sale",
            averageRevenue === null
                ? "—"
                : formatCurrency(
                    averageRevenue,
                    businessCurrency()
                )
        ],
        [
            "Average profit / sale",
            averageProfit === null
                ? "—"
                : formatCurrency(
                    averageProfit,
                    businessCurrency()
                )
        ],
        [
            "Gross margin",
            stats.margin === null
                ? "—"
                : formatPercent(
                    stats.margin
                )
        ],
        [
            "ROI",
            stats.roi === null
                ? "—"
                : formatPercent(
                    stats.roi
                )
        ]
    ];

    items.forEach(
        ([label, value]) => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "unit-economics-row";

            const labelElement =
                document.createElement(
                    "span"
                );

            labelElement.textContent =
                label;

            const valueElement =
                document.createElement(
                    "strong"
                );

            valueElement.textContent =
                value;

            row.append(
                labelElement,
                valueElement
            );

            container.appendChild(
                row
            );
        }
    );
}

function renderAnalyticsRankings() {

    const container =
        $("analyticsProductRankings");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const ranking =
        state.analyticsRanking;

    const rows =
        activeProducts()
            .map(
                product => ({
                    product,
                    metrics:
                        productMetrics(
                            product
                        )
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    rankingValue(
                        b,
                        ranking
                    ) -
                    rankingValue(
                        a,
                        ranking
                    )
            );

    if (
        !rows.length
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "mini-list-empty";

        empty.innerHTML = `
            <strong>No product ranking yet</strong>
            <span>Rankings are based on actual posted transaction data.</span>
        `;

        container.appendChild(
            empty
        );

        return;
    }

    rows.slice(
        0,
        10
    ).forEach(
        (
            row,
            index
        ) => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "ranking-item";

            const numberElement =
                document.createElement(
                    "span"
                );

            numberElement.className =
                "ranking-index";

            numberElement.textContent =
                String(
                    index + 1
                );

            const copy =
                document.createElement(
                    "div"
                );

            copy.className =
                "ranking-copy";

            const name =
                document.createElement(
                    "strong"
                );

            name.textContent =
                row.product.name ||
                "Unnamed product";

            const units =
                document.createElement(
                    "small"
                );

            units.textContent =
                `${formatNumber(
                    row.metrics.units
                )} units`;

            copy.append(
                name,
                units
            );

            const value =
                document.createElement(
                    "strong"
                );

            value.textContent =
                rankingDisplayValue(
                    row,
                    ranking
                );

            if (
                ranking !==
                "units"
            ) {
                applyFinancialTone(
                    value,
                    ranking ===
                        "margin"
                        ? row.metrics.margin
                        : row.metrics[
                            ranking
                        ]
                );
            }

            item.append(
                numberElement,
                copy,
                value
            );

            container.appendChild(
                item
            );
        }
    );
}

function rankingValue(
    entry,
    ranking
) {

    if (
        ranking ===
        "margin"
    ) {
        return number(
            entry.metrics.margin,
            0
        );
    }

    if (
        ranking ===
        "revenue"
    ) {
        return number(
            entry.metrics.revenue
        );
    }

    if (
        ranking ===
        "units"
    ) {
        return number(
            entry.metrics.units
        );
    }

    return number(
        entry.metrics.profit
    );
}

function rankingDisplayValue(
    entry,
    ranking
) {

    if (
        ranking ===
        "margin"
    ) {
        return entry.metrics.margin ===
            null
            ? "—"
            : formatPercent(
                entry.metrics.margin
            );
    }

    if (
        ranking ===
        "units"
    ) {
        return formatNumber(
            entry.metrics.units
        );
    }

    return formatCurrency(
        ranking ===
            "revenue"
            ? entry.metrics.revenue
            : entry.metrics.profit,
        entry.product.currency ||
            businessCurrency()
    );
}


/* ============================================================
   36. SETTINGS / PROFILE
   ============================================================ */

function updateProfileUI() {

    const user =
        state.user ||
        {};

    const account =
        state.account ||
        {};

    const displayName =
        user.displayName ||
        user.name ||
        "User";

    const username = user.username
        ? `@${String(user.username).replace(/^@/, "")}`
        : "Add username";

    const bio =
        user.bio ||
        "Add a short bio.";

    const level =
        integer(
            user.level ||
            account.level ||
            1,
            1
        );

    const xp =
        integer(
            user.xp ||
            account.xp ||
            0,
            0
        );

    setText(
        "sidebarProfileName",
        displayName
    );

    setText(
        "sidebarProfileUsername",
        username
    );

    setText(
        "sidebarProfileLevel",
        `L${level}`
    );

    setText(
        "settingsProfileName",
        displayName
    );

    setText(
        "settingsProfileUsername",
        username
    );

    setText(
        "settingsProfileBio",
        bio
    );

    setText(
        "settingsProfileLevel",
        level
    );

    setText(
        "settingsProfileXp",
        `${formatNumber(
            xp
        )} XP`
    );

    const avatarText =
        initials(
            displayName
        );

    const avatarUrl =
        typeof user.avatarUrl === "string" &&
        /^https:\/\//i.test(user.avatarUrl)
            ? user.avatarUrl
            : null;

    [
        "sidebarProfileAvatar",
        "settingsProfileAvatar"
    ].forEach(
        id => {
            const avatar = $(id);

            if (!avatar) {
                return;
            }

            avatar.classList.toggle(
                "has-image",
                Boolean(avatarUrl)
            );

            avatar.replaceChildren();

            if (avatarUrl) {
                const image =
                    document.createElement("img");

                image.alt = "";
                image.addEventListener(
                    "error",
                    () => {
                        avatar.classList.remove(
                            "has-image"
                        );
                        avatar.replaceChildren();
                        avatar.textContent =
                            avatarText;
                    },
                    { once: true }
                );
                image.src = avatarUrl;
                avatar.appendChild(image);
            } else {
                avatar.textContent =
                    avatarText;
            }
        }
    );
}

async function loadCurrentUser() {

    const payload =
        await apiRequest(
            "/users/me"
        );

    const user =
        extractEntity(
            payload,
            ["user"]
        );

    if (!user?.id) {
        throw new Error(
            "Profile response did not include a user."
        );
    }

    state.user = user;

    renderSettings();
}

async function saveSettingsProfile() {

    const form =
        $("settingsProfileForm");

    const button =
        form?.querySelector(
            'button[type="submit"]'
        );

    setFormStatus(
        "settingsProfileStatus",
        "",
        false
    );

    setBusy(
        button,
        true,
        "Saving..."
    );

    try {
        const payload =
            await apiRequest(
                "/users/me",
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        displayName:
                            $("settingsDisplayName")?.value.trim(),
                        username:
                            $("settingsUsername")?.value.trim() || null,
                        avatarUrl:
                            $("settingsAvatarUrl")?.value.trim() || null,
                        bio:
                            $("settingsBio")?.value.trim() || null
                    })
                }
            );

        const user =
            extractEntity(
                payload,
                ["user"]
            );

        if (!user?.id) {
            throw new Error(
                "Profile was saved but no user was returned."
            );
        }

        state.user = user;

        if (form) {
            form.dataset.userId =
                String(user.id);
        }

        updateProfileUI();

        toast(
            "Profile saved."
        );

    } catch (error) {
        console.error(
            "Save profile failed:",
            error
        );

        setFormStatus(
            "settingsProfileStatus",
            error.message ||
                "Unable to save profile.",
            true
        );

    } finally {
        setBusy(
            button,
            false
        );
    }
}

async function saveSettingsPassword() {

    const form =
        $("settingsPasswordForm");

    const button =
        form?.querySelector(
            'button[type="submit"]'
        );

    const currentPassword =
        $("settingsCurrentPassword")?.value || "";

    const newPassword =
        $("settingsNewPassword")?.value || "";

    if (newPassword.length < 8) {
        setFormStatus(
            "settingsPasswordStatus",
            "New password must contain at least 8 characters.",
            true
        );

        return;
    }

    setBusy(
        button,
        true,
        "Updating..."
    );

    setFormStatus(
        "settingsPasswordStatus",
        "",
        false
    );

    try {
        await apiRequest(
            "/users/me/password",
            {
                method: "POST",
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            }
        );

        form?.reset();
        clearSession();
        showAuthScreen("login");
        toast(
            "Password updated. Log in with your new password."
        );

    } catch (error) {
        console.error(
            "Change password failed:",
            error
        );

        setFormStatus(
            "settingsPasswordStatus",
            error.message ||
                "Unable to update password.",
            true
        );

    } finally {
        setBusy(
            button,
            false
        );
    }
}

async function saveSettingsBusiness() {

    const business =
        selectedBusiness();

    const form =
        $("settingsBusinessForm");

    const button =
        form?.querySelector(
            'button[type="submit"]'
        );

    if (!business) {
        setFormStatus(
            "settingsBusinessStatus",
            "Select a business first.",
            true
        );

        return;
    }

    setBusy(
        button,
        true,
        "Saving..."
    );

    setFormStatus(
        "settingsBusinessStatus",
        "",
        false
    );

    try {
        const payload =
            await apiRequest(
                `/businesses/${encodeURIComponent(
                    business.id
                )}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        name:
                            $("settingsBusinessName")?.value.trim(),
                        legalName:
                            $("settingsBusinessLegalName")?.value.trim() || null,
                        baseCurrency:
                            $("settingsBusinessCurrency")?.value,
                        timezone:
                            $("settingsBusinessTimezone")?.value
                    })
                }
            );

        const updated =
            extractEntity(
                payload,
                ["business"]
            );

        if (!updated?.id) {
            throw new Error(
                "Business was saved but no business was returned."
            );
        }

        state.businesses =
            state.businesses.map(
                item =>
                    String(item.id) ===
                    String(updated.id)
                        ? { ...item, ...updated }
                        : item
            );

        if (form) {
            form.dataset.businessId =
                String(updated.id);
        }

        renderBusinesses();
        updateCurrencyUI();
        renderAllBusinessData();
        refreshAnalyticsForPeriod();

        toast(
            "Business settings saved."
        );

    } catch (error) {
        console.error(
            "Save business settings failed:",
            error
        );

        setFormStatus(
            "settingsBusinessStatus",
            error.message ||
                "Unable to save business settings.",
            true
        );

    } finally {
        setBusy(
            button,
            false
        );
    }
}

function renderSettings() {

    const soundToggle =
        $("settingsSoundToggle");

    const reducedToggle =
        $("reducedMotionToggle");

    const volume =
        $("soundVolume");

    const volumeValue =
        $("soundVolumeValue");

    const languageSelect =
        $("settingsLanguage");

    if (soundToggle) {
        soundToggle.checked =
            state.soundEnabled;
    }

    if (reducedToggle) {
        reducedToggle.checked =
            state.reducedMotion;
    }

    if (languageSelect) {
        languageSelect.value =
            normalizeLanguage(
                state.language
            );
    }

    if (volume) {
        volume.value =
            String(
                state.soundVolume
            );
    }

    if (volumeValue) {
        volumeValue.textContent =
            `${Math.round(
                state.soundVolume *
                100
            )}%`;
    }

    const profileForm =
        $("settingsProfileForm");

    if (
        profileForm &&
        state.user &&
        profileForm.dataset.userId !==
            String(state.user.id)
    ) {
        $("settingsDisplayName").value =
            state.user.displayName || "";
        $("settingsUsername").value =
            state.user.username || "";
        $("settingsEmail").value =
            state.user.email || "";
        $("settingsAvatarUrl").value =
            state.user.avatarUrl || "";
        $("settingsBio").value =
            state.user.bio || "";

        profileForm.dataset.userId =
            String(state.user.id);
    }

    const businessForm =
        $("settingsBusinessForm");

    if (businessForm) {
        const business =
            selectedBusiness();

        const hasBusiness =
            Boolean(business);

        businessForm
            .querySelectorAll(
                "input, select, button"
            )
            .forEach(
                element => {
                    element.disabled =
                        !hasBusiness;
                }
            );

        if (business) {
            if (
                businessForm.dataset.businessId !==
                    String(business.id)
            ) {
                $("settingsBusinessName").value =
                    business.name || "";
                $("settingsBusinessLegalName").value =
                    business.legalName || "";

                const currentCurrency =
                    String(
                        business.baseCurrency ||
                        business.currency ||
                        "USD"
                    ).toUpperCase();

                const currencySelect =
                    $("settingsBusinessCurrency");

                if (
                    currencySelect &&
                    !Array.from(
                        currencySelect.options
                    ).some(
                        option =>
                            option.value ===
                            currentCurrency
                    )
                ) {
                    const option =
                        document.createElement("option");

                    option.value =
                        currentCurrency;
                    option.textContent =
                        `${currentCurrency} — Current`;
                    currencySelect.appendChild(
                        option
                    );
                }

                if (currencySelect) {
                    currencySelect.value =
                        currentCurrency;
                }

                const currentTimezone =
                    business.timezone || "UTC";

                const timezoneSelect =
                    $("settingsBusinessTimezone");

                if (
                    timezoneSelect &&
                    !Array.from(
                        timezoneSelect.options
                    ).some(
                        option =>
                            option.value ===
                            currentTimezone
                    )
                ) {
                    const option =
                        document.createElement("option");

                    option.value =
                        currentTimezone;
                    option.textContent =
                        `${currentTimezone} — Current`;
                    timezoneSelect.appendChild(
                        option
                    );
                }

                if (timezoneSelect) {
                    timezoneSelect.value =
                        currentTimezone;
                }

                businessForm.dataset.businessId =
                    String(business.id);
            }

            setFormStatus(
                "settingsBusinessStatus",
                "",
                false
            );
        } else {
            setFormStatus(
                "settingsBusinessStatus",
                "Select a business to edit its settings.",
                false
            );
        }
    }

    updateProfileUI();

    syncSettingsTabs();
}

function syncSettingsTabs() {

    $$(".settings-tab")
        .forEach(
            button => {

                const active =
                    button.dataset.settingsTab ===
                    state.activeSettingsTab;

                button.classList.toggle(
                    "active",
                    active
                );
            }
        );

    $$(".settings-panel")
        .forEach(
            panel => {

                const active =
                    panel.dataset.settingsPanel ===
                    state.activeSettingsTab;

                panel.hidden =
                    !active;

                panel.classList.toggle(
                    "active",
                    active
                );
            }
        );
}


/* ============================================================
   37. NAVIGATION
   ============================================================ */

function normalizeSection(
    section
) {

    const normalized =
        lower(
            section
        ).replace(
            /^section-/,
            ""
        );

    return Object.prototype.hasOwnProperty.call(
        SECTION_TITLES,
        normalized
    )
        ? normalized
        : "overview";
}

function getSectionFromHash() {

    const raw =
        window.location.hash
            .replace(
                /^#/,
                ""
            );

    return normalizeSection(
        raw
    );
}

function openSection(
    section,
    pushHash = true
) {

    const target =
        normalizeSection(
            section
        );

    state.activeSection =
        target;

    $$(".app-section")
        .forEach(
            sectionElement => {

                const active =
                    sectionElement.dataset.view ===
                    target;

                sectionElement.hidden =
                    !active;

                sectionElement.classList.toggle(
                    "active",
                    active
                );
            }
        );

    $$(".app-nav-item[data-section]")
        .forEach(
            item => {

                item.classList.toggle(
                    "active",
                    item.dataset.section ===
                    target
                );
            }
        );

    setText(
        "topbarCurrentSection",
        SECTION_TITLES[target]
    );

    if (
        pushHash
    ) {
        const desired =
            `#${target}`;

        if (
            window.location.hash !==
            desired
        ) {
            history.replaceState(
                null,
                "",
                desired
            );
        }
    }

    closeBusinessDropdown();
    closePeriodDropdown();
    closeLandingMobileMenu();
    closeMobileAppMenu();
    closeSearch();

    if (
        target ===
        "overview"
    ) {
        renderDashboard();
    }

    if (
        target ===
        "transactions"
    ) {
        renderTransactions();
    }

    if (
        target ===
        "products"
    ) {
        renderProducts();
    }

    if (
        target ===
        "expenses"
    ) {
        renderExpenses();
    }

    if (
        target ===
        "analytics"
    ) {
        renderAnalytics();

        if (
            resourceStatus(
                "analytics"
            ) !==
            "ready"
        ) {
            refreshAnalyticsForPeriod();
        }
    }

    if (
        target ===
        "goals"
    ) {
        renderGoals();
    }

    if (
        target ===
        "reports"
    ) {
        renderReports();
    }

    if (
        target ===
        "settings"
    ) {
        renderSettings();
    }

    window.scrollTo({
        top: 0,
        behavior:
            state.reducedMotion
                ? "auto"
                : "smooth"
    });
}


/* ============================================================
   38. PERIOD HANDLING
   ============================================================ */

function periodLabel() {

    if (
        state.customRange?.from &&
        state.customRange?.to
    ) {
        return (
            `${formatDate(
                state.customRange.from,
                {
                    month: "short",
                    day: "numeric"
                }
            )} — ${formatDate(
                state.customRange.to,
                {
                    month: "short",
                    day: "numeric"
                }
            )}`
        );
    }

    return (
        PERIODS[
            state.periodDays
        ] ||
        `Last ${state.periodDays} days`
    );
}

function syncPeriodButtons() {

    setText(
        "periodButtonLabel",
        periodLabel()
    );

    $$("#periodDropdown button[data-period]")
        .forEach(
            button => {

                button.classList.toggle(
                    "active",
                    Number(
                        button.dataset.period
                    ) ===
                    Number(
                        state.periodDays
                    ) &&
                    !state.customRange
                );
            }
        );

    $$(
        "[data-analytics-period]"
    ).forEach(
        button => {

            button.classList.toggle(
                "active",
                Number(
                    button.dataset.analyticsPeriod
                ) ===
                Number(
                    state.periodDays
                ) &&
                !state.customRange
            );
        }
    );
}

function setPeriod(
    days
) {

    const value =
        Number(days);

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {
        return;
    }

    state.periodDays =
        Math.trunc(
            value
        );

    state.customRange =
        null;

    syncPeriodButtons();

    renderDashboard();
    renderExpenses();
    renderGoals();
    renderReports();
    renderAnalytics();

    refreshAnalyticsForPeriod();
}

function openCustomPeriod() {

    const {
        from,
        to
    } =
        getActiveBounds();

    if (
        $("customPeriodFrom")
    ) {
        $("customPeriodFrom").value =
            from ||
            dateToISODate(
                getDateDaysAgo(30)
            );
    }

    if (
        $("customPeriodTo")
    ) {
        $("customPeriodTo").value =
            to ||
            today();
    }

    setFormStatus(
        "customPeriodStatus",
        "",
        false
    );

    openModal(
        "customPeriodModal"
    );
}

function applyCustomPeriod() {

    const from =
        $("customPeriodFrom")?.value;

    const to =
        $("customPeriodTo")?.value;

    if (
        !validDate(from) ||
        !validDate(to)
    ) {

        setFormStatus(
            "customPeriodStatus",
            "Enter both dates.",
            true
        );

        return;
    }

    if (
        localDateKey(from) >
        localDateKey(to)
    ) {

        setFormStatus(
            "customPeriodStatus",
            "The start date must be before the end date.",
            true
        );

        return;
    }

    state.customRange = {
        from,
        to
    };

    closeModal(
        "customPeriodModal"
    );

    syncPeriodButtons();

    renderDashboard();
    renderExpenses();
    renderGoals();
    renderReports();
    renderAnalytics();

    refreshAnalyticsForPeriod();
}


/* ============================================================
   39. DROPDOWNS
   ============================================================ */

function openBusinessDropdown() {

    const dropdown =
        $("businessDropdown");

    const button =
        $("businessSwitcherButton");

    if (!dropdown) {
        return;
    }

    state.businessDropdownOpen =
        true;

    show(dropdown);

    button?.setAttribute(
        "aria-expanded",
        "true"
    );
}

function closeBusinessDropdown() {

    const dropdown =
        $("businessDropdown");

    const button =
        $("businessSwitcherButton");

    state.businessDropdownOpen =
        false;

    hide(dropdown);

    button?.setAttribute(
        "aria-expanded",
        "false"
    );
}

function toggleBusinessDropdown() {

    if (
        state.businessDropdownOpen
    ) {
        closeBusinessDropdown();
    } else {
        openBusinessDropdown();
    }
}

function openPeriodDropdown() {

    const dropdown =
        $("periodDropdown");

    const button =
        $("periodButton");

    if (!dropdown) {
        return;
    }

    state.periodDropdownOpen =
        true;

    show(dropdown);

    button?.setAttribute(
        "aria-expanded",
        "true"
    );
}

function closePeriodDropdown() {

    const dropdown =
        $("periodDropdown");

    const button =
        $("periodButton");

    state.periodDropdownOpen =
        false;

    hide(dropdown);

    button?.setAttribute(
        "aria-expanded",
        "false"
    );
}

function togglePeriodDropdown() {

    if (
        state.periodDropdownOpen
    ) {
        closePeriodDropdown();
    } else {
        openPeriodDropdown();
    }
}


/* ============================================================
    39.1 NATIVE SELECT ENHANCER (custom Profitly dropdowns)
   ============================================================ */

const fxSelects = new Map();

let fxMenu = null;

let fxHandle = null;

let fxFocusIndex = -1;

let fxItems = [];

function fxEnsureMenu() {

    if (fxMenu) {
        return fxMenu;
    }

    fxMenu = document.createElement("div");

    fxMenu.className = "fx-menu";

    fxMenu.setAttribute("role", "listbox");

    fxMenu.setAttribute("aria-hidden", "true");

    document.body.appendChild(fxMenu);

    return fxMenu;
}

function fxLabelFor(option) {

    const text =
        option?.textContent?.trim();

    return text || option?.value || "";
}

function fxPlaceholder(select) {

    const placeholder =
        [...select.options]
        .find(
            option =>
                !option.value
        );

    if (
        select.selectedIndex === -1 ||
        !select.value
    ) {
        return fxLabelFor(placeholder);
    }

    return "";
}

function fxRefreshTrigger(select) {

    const handle =
        fxSelects.get(select);

    if (!handle) {
        return;
    }

    const trigger =
        handle.trigger;

    const valueElement =
        handle.valueElement;

    const selected =
        select.selectedIndex >= 0
            ? select.options[select.selectedIndex]
            : null;

    const hasValue =
        Boolean(select.value);

    const placeholder =
        fxLabelFor(
            [...select.options]
            .find(
                option =>
                    !option.value
            )
        ) || "Select...";

    valueElement.textContent =
        hasValue
            ? fxLabelFor(selected)
            : placeholder;

    trigger.classList.toggle(
        "is-placeholder",
        !hasValue
    );

    trigger.classList.toggle(
        "is-disabled",
        select.disabled
    );

    trigger.setAttribute(
        "aria-valuetext",
        hasValue ? valueElement.textContent : ""
    );
}

function fxHookSelect(select, handle) {

    if (select.__fxHooked) {
        return;
    }

    select.__fxHooked = true;

    try {

        const originalDescriptor =
            Object.getOwnPropertyDescriptor(
                HTMLSelectElement.prototype,
                "value"
            );

        if (originalDescriptor?.set) {
            Object.defineProperty(
                select,
                "value",
                {
                    configurable: true,

                    get() {
                        return originalDescriptor.get.call(this);
                    },

                    set(next) {
                        originalDescriptor.set.call(this, next);

                        fxRefreshTrigger(select);
                    }
                }
            );
        }

    } catch {
        /* property hook unavailable, mutation observer still covers label */
    }

    handle.observer = new MutationObserver(() => {
        fxRefreshTrigger(select);
    });

    handle.observer.observe(
        select,
        {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        }
    );
}

function fxSnapshotOptions(select) {

    return [...select.options]
        .filter(
            option =>
                !option.hidden
        )
        .map(
            (option, index) => (
                {
                    element: option,
                    value: option.value,
                    text: fxLabelFor(option),
                    disabled:
                        option.disabled ||
                        option.value === "" &&
                        select.selectedIndex !== -1 &&
                        select.value !== ""
                }
            )
        );
}

function fxCloseMenu() {

    if (!fxHandle || !fxMenu) {
        return;
    }

    const handle =
        fxHandle;

    fxHandle = null;

    fxMenu.classList.remove("is-open", "is-above");

    fxMenu.setAttribute("aria-hidden", "true");

    handle.trigger.classList.remove("is-open");

    handle.trigger.setAttribute("aria-expanded", "false");

    handle.trigger.setAttribute("aria-activedescendant", "");

    if (
        handle.menuFocusOnly
    ) {
        return;
    }

    handle.trigger.focus({
        preventScroll: true
    });
}

function fxPositionMenu() {

    if (!fxHandle || !fxMenu) {
        return;
    }

    const rect =
        fxHandle.trigger.getBoundingClientRect();

    const menuHeight =
        fxMenu.scrollHeight;

    const viewportHeight =
        window.innerHeight;

    const spaceBelow =
        viewportHeight - rect.bottom - 12;

    const spaceAbove =
        rect.top - 12;

    const width =
        Math.max(
            rect.width,
            176
        );

    let top;

    if (
        spaceBelow < Math.min(menuHeight, 260) &&
        spaceAbove > spaceBelow
    ) {
        top =
            Math.max(
                8,
                rect.top -
                Math.min(menuHeight, spaceAbove) -
                6
            );

        fxMenu.classList.add("is-above");
    } else {
        top =
            rect.bottom +
            6;

        fxMenu.classList.remove("is-above");
    }

    fxMenu.style.left =
        `${Math.max(8, rect.left)}px`;

    fxMenu.style.top =
        `${top}px`;

    fxMenu.style.width =
        `${width}px`;
}

function fxScrollActiveIntoView() {

    const active =
        fxMenu?.querySelector(".fx-option.is-active");

    active?.scrollIntoView({
        block: "nearest"
    });
}

function fxSetActive(index, scroll = true) {

    if (!fxMenu) {
        return;
    }

    const options =
        fxMenu.querySelectorAll(".fx-option");

    options.forEach(
        option =>
            option.classList.remove("is-active")
    );

    const next =
        options[index];

    if (!next) {
        fxHandle?.trigger.setAttribute("aria-activedescendant", "");

        fxFocusIndex = -1;

        return;
    }

    next.classList.add("is-active");

    fxFocusIndex = index;

    next.id =
        next.id ||
        `fx-option-${Math.random().toString(36).slice(2, 8)}`;

    fxHandle?.trigger.setAttribute(
        "aria-activedescendant",
        next.id
    );

    if (scroll) {
        fxScrollActiveIntoView();
    }
}

function fxCommit(index) {

    if (!fxHandle) {
        return;
    }

    const item =
        fxItems[index];

    if (
        !item ||
        item.disabled
    ) {
        return;
    }

    const select =
        fxHandle.select;

    const previous =
        select.value;

    select.value =
        item.value;

    if (
        select.value !== previous
    ) {
        select.dispatchEvent(
            new Event(
                "change",
                {
                    bubbles: true
                }
            )
        );
    }

    fxRefreshTrigger(select);

    fxCloseMenu();
}

function fxRenderItems(select, filter = "") {

    const list =
        fxMenu.querySelector(".fx-options");

    const searchInput =
        fxMenu.querySelector(".fx-search");

    if (filter && searchInput) {
        filter =
            filter.toLowerCase().trim();

        fxItems =
            fxItems
            .filter(
                item =>
                    item.text
                    .toLowerCase()
                    .includes(filter)
            );
    }

    list.innerHTML = "";

    if (!fxItems.length) {

        const empty =
            document.createElement("div");

        empty.className = "fx-empty";

        empty.textContent =
            filter ? "No matches" : "No options";

        list.appendChild(empty);

        return;
    }

    fxItems
        .forEach(
            (item, index) => {

                const option =
                    document.createElement("div");

                option.className =
                    "fx-option";

                option.setAttribute("role", "option");

                option.innerHTML =
                    `<span class="fx-option-label"></span>`;

                option.querySelector(".fx-option-label")
                    .textContent =
                    item.text;

                option._fxIndex = index;

                if (item.disabled) {
                    option.classList.add("is-disabled");

                    option.setAttribute("aria-disabled", "true");
                }

                if (
                    !item.disabled &&
                    item.value === select.value
                ) {
                    option.classList.add("is-selected");
                }

                list.appendChild(option);
            }
        );
}

function fxOpenMenu(select) {

    const handle =
        fxSelects.get(select);

    if (!handle || select.disabled) {
        return;
    }

    if (
        fxHandle &&
        fxHandle.select !== select
    ) {
        fxHandle.menuFocusOnly = true;

        fxCloseMenu();
    }

    fxHandle = handle;

    fxItems =
        fxSnapshotOptions(select);

    const needsSearch =
        fxItems.length > 8;

    fxEnsureMenu();

    fxMenu.innerHTML = needsSearch
        ? `<input class="fx-search" type="text" placeholder="Search..." aria-hidden="true"><div class="fx-options" role="group"></div>`
        : `<div class="fx-options" role="group"></div>`;

    fxRenderItems(select);

    fxMenu.style.visibility = "hidden";

    fxMenu.classList.add("is-open");

    fxMenu.setAttribute("aria-hidden", "false");

    fxPositionMenu();

    fxMenu.style.visibility = "";

    handle.trigger.classList.add("is-open");

    handle.trigger.setAttribute("aria-expanded", "true");

    const startIndex =
        fxItems.findIndex(
            item =>
                item.value === select.value
        );

    fxSetActive(
        startIndex >= 0 ? startIndex : 0
    );

    if (needsSearch) {

        const search =
            fxMenu.querySelector(".fx-search");

        search._fxSelect = select;

        setTimeout(
            search.focus.bind(search),
            0
        );
    }
}

function fxHandleKeydown(select, event) {

    const isOpen =
        Boolean(
            fxHandle &&
            fxHandle.select === select
        );

    if (
        event.key === "Escape"
    ) {
        if (isOpen) {
            fxCaptureEvent(event);

            fxCloseMenu();
        }

        return;
    }

    if (!isOpen) {

        if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Enter" ||
            event.key === " "
        ) {
            fxCaptureEvent(event);

            fxOpenMenu(select);
        }

        return;
    }

    const currentIndex =
        fxFocusIndex;

    const max =
        fxItems.length - 1;

    let next = currentIndex;

    switch (event.key) {

        case "ArrowDown":
            next =
                currentIndex >= max ? 0 : currentIndex + 1;
            break;

        case "ArrowUp":
            next =
                currentIndex <= 0 ? max : currentIndex - 1;
            break;

        case "Home":
            next = 0;
            break;

        case "End":
            next = max;
            break;

        case "Enter":
            fxCaptureEvent(event);

            fxCommit(currentIndex);
            return;

        case "Tab":
            fxCloseMenu();
            return;

        default:
            return;
    }

    fxCaptureEvent(event);

    fxHandle.menuFocusOnly = true;

    fxSetActive(next);

    fxHandle.menuFocusOnly = false;
}

function fxCaptureEvent(event) {

    event.preventDefault();

    event.stopImmediatePropagation();
}

function fxWireMenuInteractions() {

    fxMenu.addEventListener(
        "pointerdown",
        event =>
            event.stopPropagation()
    );

    fxMenu.addEventListener(
        "click",
        event => {

            const option =
                event.target
                .closest(".fx-option");

            if (option) {
                fxCommit(option._fxIndex);
            }
        }
    );

    fxMenu.addEventListener(
        "input",
        event => {

            if (
                event.target.classList.contains("fx-search")
            ) {
                fxRenderItems(
                    event.target._fxSelect,
                    event.target.value
                );

                fxSetActive(0);
            }
        }
    );

    fxMenu.addEventListener(
        "keydown",
        event => {

            const handle =
                fxHandle;

            if (!handle) {
                return;
            }

            if (
                event.key === "Escape"
            ) {
                fxCaptureEvent(event);

                fxCloseMenu();

                return;
            }

            if (
                event.target.classList.contains("fx-search") &&
                ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
            ) {
                fxCaptureEvent(event);

                if (event.key !== "Enter") {
                    fxHandleKeydown(handle.select, event);

                    return;
                }

                fxCommit(fxFocusIndex);
            }
        }
    );
}

function enhanceNativeSelects(root = document) {

    root.querySelectorAll("select")
        .forEach(
            select => {

                if (select.dataset.fxEnhanced) {
                    return;
                }

                select.dataset.fxEnhanced = "true";

                const trigger =
                    document.createElement("div");

                trigger.tabIndex = 0;

                trigger.setAttribute("role", "combobox");

                trigger.setAttribute("aria-haspopup", "listbox");

                trigger.setAttribute("aria-expanded", "false");

                trigger.setAttribute("autocapitalize", "off");

                trigger.setAttribute("spellcheck", "false");

                trigger.dataset.fxTrigger = "";

                trigger.innerHTML =
                    `<span class="fx-select-value"></span>
                     <span class="fx-select-chevron" aria-hidden="true">
                         <svg width="10" height="10" viewBox="0 0 10 10">
                             <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                         </svg>
                     </span>`;

                const handle =
                    {
                        select,
                        trigger,
                        valueElement:
                            trigger.querySelector(".fx-select-value")
                    };

                select.classList.add("fx-hidden-select");

                select.setAttribute("tabindex", "-1");

                select.setAttribute("aria-hidden", "true");

                select.insertAdjacentElement(
                    "afterend",
                    trigger
                );

                fxSelects.set(
                    select,
                    handle
                );

                fxHookSelect(
                    select,
                    handle
                );

                fxRefreshTrigger(select);

                trigger.addEventListener(
                    "keydown",
                    event =>
                        fxHandleKeydown(select, event)
                );

                trigger.addEventListener(
                    "click",
                    () => {

                        if (
                            fxHandle &&
                            fxHandle.select === select
                        ) {
                            fxCloseMenu();
                        } else {
                            fxOpenMenu(select);
                        }
                    }
                );

                select.addEventListener(
                    "change",
                    () =>
                        fxRefreshTrigger(select)
                );
            }
        );
}

function wireOutsideClicksFx() {

    document.addEventListener(
        "pointerdown",
        event => {

            if (!fxHandle) {
                return;
            }

            if (
                !event.target
                .closest(
                    ".fx-menu, [data-fx-trigger]"
                )
            ) {
                fxCloseMenu();
            }
        },
        true
    );

    window.addEventListener(
        "scroll",
        () => {

            if (fxHandle) {
                fxPositionMenu();
            }
        },
        {
            passive: true,
            capture: true
        }
    );

    window.addEventListener(
        "resize",
        () => {

            if (fxHandle) {
                fxPositionMenu();
            }
        }
    );

    window.addEventListener(
        "keydown",
        event => {

            if (
                fxHandle &&
                event.key === "Escape"
            ) {
                fxCaptureEvent(event);

                fxCloseMenu();
            }
        },
        true
    );
}


/* ============================================================
   40. SEARCH
   ============================================================ */

function buildSearchIndex() {

    const entries = [
        {
            type: "section",
            key: "overview",
            title: "Overview",
            description:
                "Revenue, profit, sales, expenses and financial performance.",
            action:
                () =>
                    openSection(
                        "overview"
                    )
        },
        {
            type: "section",
            key: "transactions",
            title: "Transactions",
            description:
                "Sales, refunds, adjustments and ledger.",
            action:
                () =>
                    openSection(
                        "transactions"
                    )
        },
        {
            type: "section",
            key: "products",
            title: "Products",
            description:
                "Catalog, prices, costs, margins and product profit.",
            action:
                () =>
                    openSection(
                        "products"
                    )
        },
        {
            type: "section",
            key: "expenses",
            title: "Expenses",
            description:
                "Business expenses and category breakdown.",
            action:
                () =>
                    openSection(
                        "expenses"
                    )
        },
        {
            type: "section",
            key: "analytics",
            title: "Analytics",
            description:
                "Trends, product rankings, margins and insights.",
            action:
                () =>
                    openSection(
                        "analytics"
                    )
        },
        {
            type: "section",
            key: "goals",
            title: "Goals",
            description:
                "Financial goals and automatic progress.",
            action:
                () =>
                    openSection(
                        "goals"
                    )
        },
        {
            type: "section",
            key: "reports",
            title: "Reports",
            description:
                "Financial reporting and product performance.",
            action:
                () =>
                    openSection(
                        "reports"
                    )
        },
        {
            type: "section",
            key: "settings",
            title: "Settings",
            description:
                "Account, appearance, sound and security.",
            action:
                () =>
                    openSection(
                        "settings"
                    )
        }
    ];

    state.searchIndex =
        entries;

    state.products.forEach(
        product => {

            entries.push({
                type: "product",
                key:
                    `product-${product.id}`,
                title:
                    product.name ||
                    "Unnamed product",
                description:
                    `Product · ${
                        product.sku ||
                        "No SKU"
                    }`,
                action:
                    () => {

                        openSection(
                            "products"
                        );

                        setTimeout(
                            () =>
                                focusProductRow(
                                    product.id
                                ),
                            50
                        );
                    }
            });
        }
    );

    state.transactions
        .slice(
            0,
            100
        )
        .forEach(
            transaction => {

                entries.push({
                    type: "transaction",
                    key:
                        `transaction-${transaction.id}`,
                    title:
                        transactionProductName(
                            transaction
                        ),
                    description:
                        `Transaction · ${
                            formatDate(
                                transactionDate(
                                    transaction
                                )
                            )
                        }`,
                    action:
                        () => {

                            openSection(
                                "transactions"
                            );

                            state.transactionSearch =
                                String(
                                    transaction.id
                                );

                            const search =
                                $("transactionSearch");

                            if (search) {
                                search.value =
                                    state.transactionSearch;
                            }

                            renderTransactions();

                        }
                });
            }
        );
}

function openSearch() {

    buildSearchIndex();

    state.searchOpen =
        true;

    openModal(
        "searchModal"
    );

    const input =
        $("searchInput");

    if (input) {

        input.value =
            state.currentSearchQuery;

        setTimeout(
            () =>
                input.focus(),
            40
        );
    }

    filterSearchResults(
        state.currentSearchQuery
    );
}

function closeSearch() {

    if (
        !state.searchOpen &&
        $("searchModal")?.hidden !==
            false
    ) {
        return;
    }

    state.searchOpen =
        false;

    state.currentSearchQuery =
        "";

    closeModal(
        "searchModal"
    );
}

function filterSearchResults(
    query
) {

    state.currentSearchQuery =
        String(
            query ?? ""
        );

    const container =
        $("searchResults");

    if (!container) {
        return;
    }

    const q =
        lower(
            state.currentSearchQuery
        );

    const results =
        q
            ? state.searchIndex.filter(
                entry => {
                    const haystack =
                        lower(
                            `${entry.title} ${entry.description} ${entry.type}`
                        );

                    return haystack.includes(
                        q
                    );
                }
            )
            : state.searchIndex.slice(
                0,
                8
            );

    container.replaceChildren();

    if (
        !results.length
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "search-empty";

        empty.textContent =
            "No matching results.";

        container.appendChild(
            empty
        );

        return;
    }

    results
        .slice(
            0,
            14
        )
        .forEach(
            entry => {

                const button =
                    document.createElement(
                        "button"
                    );

                button.type =
                    "button";

                button.className =
                    "search-result-item";

                const icon =
                    document.createElement(
                        "span"
                    );

                icon.className =
                    "search-result-icon";

                icon.textContent =
                    entry.type === "section"
                        ? "↗"
                        : entry.type === "product"
                            ? "○"
                            : "◇";

                const copy =
                    document.createElement(
                        "span"
                    );

                copy.className =
                    "search-result-copy";

                const title =
                    document.createElement(
                        "strong"
                    );

                title.textContent =
                    entry.title;

                const description =
                    document.createElement(
                        "small"
                    );

                description.textContent =
                    entry.description;

                copy.append(
                    title,
                    description
                );

                button.append(
                    icon,
                    copy
                );

                button.addEventListener(
                    "click",
                    () => {

                        closeSearch();

                        entry.action();
                    }
                );

                container.appendChild(
                    button
                );
            }
        );
}

function focusProductRow(
    productId
) {

    const row =
        document.querySelector(
            `[data-product-id="${CSS.escape(
                String(productId)
            )}"]`
        );

    if (!row) {
        return;
    }

    row.scrollIntoView({
        behavior:
            state.reducedMotion
                ? "auto"
                : "smooth",
        block: "center"
    });

    row.classList.add(
        "row-highlight"
    );

    setTimeout(
        () =>
            row.classList.remove(
                "row-highlight"
            ),
        1600
    );
}


/* ============================================================
   41. MODALS
   ============================================================ */

function openModal(
    modalId
) {

    const modal =
        $(modalId);

    if (!modal) {
        return;
    }

    state.lastKnownFocusedElement =
        document.activeElement;

    state.modalStack.push(
        modalId
    );

    show(modal);

    document.body.classList.add(
        "modal-open"
    );

    requestAnimationFrame(
        () => {
            modal.classList.add(
                "is-open"
            );

            const initialFocus =
                modal.querySelector(
                    "[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
                );

            initialFocus?.focus();
        }
    );
}

function closeModal(
    modalId
) {

    const modal =
        $(modalId);

    if (!modal) {
        return;
    }

    modal.classList.remove(
        "is-open"
    );

    setTimeout(
        () => {

            hide(modal);

            state.modalStack =
                state.modalStack.filter(
                    id =>
                        id !==
                        modalId
                );

            if (
                state.modalStack.length ===
                0
            ) {
                document.body.classList.remove(
                    "modal-open"
                );
            }

            if (
                state.lastKnownFocusedElement &&
                document.contains(
                    state.lastKnownFocusedElement
                )
            ) {
                state.lastKnownFocusedElement.focus();
            }

        },
        state.reducedMotion
            ? 0
            : 160
    );
}

function closeAllModals() {

    $$(".modal")
        .forEach(
            modal => {

                modal.classList.remove(
                    "is-open"
                );

                hide(
                    modal
                );
            }
        );

    state.modalStack =
        [];

    document.body.classList.remove(
        "modal-open"
    );
}

function requestConfirmation({
    title,
    message,
    confirmLabel = "Confirm",
    tone = "danger",
    action
}) {

    state.pendingConfirmation =
        {
            title,
            message,
            confirmLabel,
            tone,
            action
        };

    setText(
        "confirmationTitle",
        title
    );

    setText(
        "confirmationMessage",
        message
    );

    setText(
        "confirmationConfirmButton",
        confirmLabel
    );

    const icon =
        $("confirmationIcon");

    if (icon) {
        icon.className =
            `confirmation-icon ${tone}`;
    }

    openModal(
        "confirmationModal"
    );
}

async function runPendingConfirmation() {

    const pending =
        state.pendingConfirmation;

    if (!pending) {
        return;
    }

    const button =
        $("confirmationConfirmButton");

    setBusy(
        button,
        true,
        "Working..."
    );

    try {

        await pending.action();

        state.pendingConfirmation =
            null;

        closeModal(
            "confirmationModal"
        );

    } catch (error) {

        console.error(
            "Confirmation action failed:",
            error
        );

        toast(
            error.message ||
                "Action failed."
        );

    } finally {

        setBusy(
            button,
            false
        );
    }
}

function modalForTrigger(
    trigger
) {

    const key =
        trigger?.dataset?.modalTrigger;

    const map = {
        business:
            "businessModal",
        transaction:
            "transactionModal",
        product:
            "productModal",
        expense:
            "expenseModal",
        goal:
            "goalModal",
        search:
            "searchModal"
    };

    return map[key] ||
        null;
}

function prepareModal(
    modalId
) {

    if (
        modalId ===
        "transactionModal"
    ) {
        resetTransactionForm();
    }

    if (
        modalId ===
        "productModal"
    ) {
        resetProductForm();
    }

    if (
        modalId ===
        "expenseModal"
    ) {
        resetExpenseForm();
    }

    if (
        modalId ===
        "goalModal"
    ) {
        resetGoalForm();
    }

    if (
        modalId ===
        "businessModal"
    ) {
        resetBusinessForm();
    }
}


/* ============================================================
   42. BUSINESS FORM
   ============================================================ */

function resetBusinessForm() {

    $("businessForm")
        ?.reset();

    if (
        $("businessCurrency")
    ) {
        $("businessCurrency").value =
            businessCurrency();
    }

    if (
        $("businessTimezone")
    ) {
        $("businessTimezone").value =
            "UTC";
    }

    setFormStatus(
        "businessFormStatus",
        "",
        false
    );
}


/* ============================================================
   43. CALCULATOR
   ============================================================ */

function calculateProfitSimulator() {

    const product =
        $("simulatorProduct")?.value.trim();

    const sale =
        number(
            $("simulatorSalePrice")?.value
        );

    const cost =
        number(
            $("simulatorCostPrice")?.value
        );

    const quantity =
        number(
            $("simulatorSales")?.value
        );

    if (
        !product
    ) {
        toast(
            "Enter a product name."
        );
        return;
    }

    if (
        sale <= 0 ||
        cost < 0 ||
        quantity <= 0
    ) {
        toast(
            "Enter valid simulator values."
        );
        return;
    }

    const revenue =
        sale *
        quantity;

    const expenses =
        cost *
        quantity;

    const profit =
        revenue -
        expenses;

    const output =
        $("simulatorProfit");

    if (output) {

        output.textContent =
            formatCurrency(
                profit,
                businessCurrency()
            );

        applyValueTone(
            output,
            profit
        );
    }

    const result =
        $("simulatorResult");

    result?.classList.add(
        "is-updated"
    );

    setTimeout(
        () =>
            result?.classList.remove(
                "is-updated"
            ),
        600
    );
}

function applyValueTone(
    element,
    value
) {

    if (!element) {
        return;
    }

    element.classList.remove(
        "positive",
        "negative",
        "neutral"
    );

    const numeric =
        number(value);

    if (
        numeric > 0
    ) {

        element.classList.add(
            "positive"
        );

    } else if (
        numeric < 0
    ) {

        element.classList.add(
            "negative"
        );

    } else {

        element.classList.add(
            "neutral"
        );
    }
}


/* ============================================================
   44. SETTINGS
   ============================================================ */

function wireSettingsTabs() {

    $$(".settings-tab")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        state.activeSettingsTab =
                            button.dataset.settingsTab ||
                            "account";

                        syncSettingsTabs();
                    }
                );
            }
        );
}

function setSoundEnabled(
    enabled
) {

    state.soundEnabled =
        Boolean(enabled);

    localStorage.setItem(
        STORAGE_KEYS.sound,
        state.soundEnabled
            ? "on"
            : "off"
    );

    updateSoundButton();

    renderSettings();
}

function setReducedMotion(
    enabled
) {

    state.reducedMotion =
        Boolean(enabled);

    localStorage.setItem(
        STORAGE_KEYS.reducedMotion,
        state.reducedMotion
            ? "on"
            : "off"
    );

    document.body.classList.toggle(
        "reduced-motion",
        state.reducedMotion
    );
}

function setLanguage(language) {
    const normalized =
        normalizeLanguage(language);

    state.language = normalized;

    localStorage.setItem(
        STORAGE_KEYS.language,
        normalized
    );

    applyLanguagePreference();
    renderSettings();
}

function setSoundVolume(
    volume
) {

    state.soundVolume =
        clamp(
            volume,
            0,
            1
        );

    localStorage.setItem(
        STORAGE_KEYS.soundVolume,
        String(
            state.soundVolume
        )
    );

    renderSettings();
}


/* ============================================================
   45. AUDIO / BANKNOTE SOUND
============================================================= */

function getAudioContext() {

    if (
        state.audioContext
    ) {
        return state.audioContext;
    }

    const AudioContextClass =
        window.AudioContext ||
        window.webkitAudioContext;

    if (
        !AudioContextClass
    ) {
        return null;
    }

    try {

        state.audioContext =
            new AudioContextClass();

        return state.audioContext;

    } catch (
        error
    ) {

        console.warn(
            "Web Audio unavailable:",
            error
        );

        return null;
    }
}

async function ensureAudioContext() {

    const context =
        getAudioContext();

    if (!context) {
        return null;
    }

    if (
        context.state ===
        "suspended"
    ) {

        try {
            await context.resume();
        } catch {
            return null;
        }
    }

    return context;
}


function updateSoundButton() {

    const button =
        $("soundButton");

    if (!button) {
        return;
    }

    const muted =
        $("soundIconMuted");

    const on =
        $("soundIconOn");

    button.setAttribute(
        "aria-pressed",
        state.soundEnabled
            ? "true"
            : "false"
    );

    if (muted) {
        muted.style.display =
            state.soundEnabled
                ? "none"
                : "block";
    }

    if (on) {
        on.style.display =
            state.soundEnabled
                ? "block"
                : "none";
    }

    button.title =
        state.soundEnabled
            ? "Mute interaction sound"
            : "Enable interaction sound";
}


/* ============================================================
   47. LANDING PAGE THREE.JS ENVIRONMENT
   ------------------------------------------------------------
   The environment stays intentionally subtle.
   Financial data is NOT fabricated.
   These are purely visual atmospheric primitives.
   ============================================================ */

function initLandingEnvironment() {

    if (
        state.landingEnvironment.initialized
    ) {
        return;
    }

    const canvas =
        $("environmentCanvas");

    if (
        !canvas ||
        typeof THREE ===
            "undefined"
    ) {
        return;
    }

    const reduced =
        state.reducedMotion;

    const environment =
        state.landingEnvironment;

    try {

        const renderer =
            new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference:
                    "high-performance"
            });

        renderer.setPixelRatio(
            Math.min(
                window.devicePixelRatio ||
                    1,
                1.65
            )
        );

        renderer.setClearColor(
            0x000000,
            0
        );

        const scene =
            new THREE.Scene();

        const camera =
            new THREE.PerspectiveCamera(
                38,
                window.innerWidth /
                    Math.max(
                        1,
                        window.innerHeight
                    ),
                0.1,
                100
            );

        camera.position.set(
            0,
            0,
            7
        );

        /*
           Very subtle particles. This is environmental atmosphere,
           not financial data.
        */

        const particleCount =
            reduced
                ? 220
                : 540;

        const positions =
            new Float32Array(
                particleCount * 3
            );

        for (
            let i = 0;
            i < particleCount;
            i++
        ) {

            positions[
                i * 3
            ] =
                (
                    Math.random() -
                    0.5
                ) *
                16;

            positions[
                i * 3 + 1
            ] =
                (
                    Math.random() -
                    0.5
                ) *
                9;

            positions[
                i * 3 + 2
            ] =
                (
                    Math.random() -
                    0.5
                ) *
                11;
        }

        const geometry =
            new THREE.BufferGeometry();

        geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(
                positions,
                3
            )
        );

        const material =
            new THREE.PointsMaterial({
                color:
                    0xbfa463,
                size:
                    0.025,
                transparent:
                    true,
                opacity:
                    reduced
                        ? 0.22
                        : 0.3,
                depthWrite:
                    false,
                blending:
                    THREE.AdditiveBlending
            });

        const points =
            new THREE.Points(
                geometry,
                material
            );

        scene.add(
            points
        );

        /*
           Abstract financial trace.
           This is decorative and must not imply numerical data.
        */

        const linePoints =
            [];

        for (
            let i = 0;
            i < 90;
            i++
        ) {

            const x =
                (
                    i /
                    89 -
                    0.5
                ) *
                13;

            const y =
                Math.sin(
                    i *
                    0.22
                ) *
                0.22 +
                Math.sin(
                    i *
                    0.071
                ) *
                0.34;

            linePoints.push(
                new THREE.Vector3(
                    x,
                    y,
                    -1.7
                )
            );
        }

        const lineGeometry =
            new THREE.BufferGeometry()
                .setFromPoints(
                    linePoints
                );

        const lineMaterial =
            new THREE.LineBasicMaterial({
                color:
                    0x8f7540,
                transparent:
                    true,
                opacity:
                    reduced
                        ? 0.045
                        : 0.08
            });

        const line =
            new THREE.Line(
                lineGeometry,
                lineMaterial
            );

        scene.add(
            line
        );

        environment.renderer =
            renderer;

        environment.scene =
            scene;

        environment.camera =
            camera;

        environment.points =
            points;

        environment.line =
            line;

        environment.initialized =
            true;

        resizeLandingEnvironment();

        const resize =
            () =>
                resizeLandingEnvironment();

        window.addEventListener(
            "resize",
            resize,
            {
                passive: true
            }
        );

        environment.resizeObserver =
            resize;

        if (
            reduced
        ) {

            renderer.render(
                scene,
                camera
            );

            return;
        }

        let time =
            0;

        function animate() {

            if (
                $("landingPage")?.hidden
            ) {

                environment.raf =
                    requestAnimationFrame(
                        animate
                    );

                return;
            }

            time +=
                0.0022;

            points.rotation.y =
                time *
                0.07;

            points.rotation.x =
                Math.sin(
                    time *
                    0.7
                ) *
                0.015;

            line.rotation.y =
                Math.sin(
                    time *
                    0.8
                ) *
                0.035;

            camera.position.x =
                Math.sin(
                    time *
                    0.32
                ) *
                0.08;

            camera.position.y =
                Math.cos(
                    time *
                    0.24
                ) *
                0.045;

            renderer.render(
                scene,
                camera
            );

            environment.raf =
                requestAnimationFrame(
                    animate
                );
        }

        environment.raf =
            requestAnimationFrame(
                animate
            );

    } catch (error) {

        console.warn(
            "Three.js environment initialization failed:",
            error
        );
    }
}

function resizeLandingEnvironment() {

    const environment =
        state.landingEnvironment;

    if (
        !environment.initialized ||
        !environment.renderer ||
        !environment.camera
    ) {
        return;
    }

    const width =
        window.innerWidth;

    const height =
        Math.max(
            1,
            window.innerHeight
        );

    environment.renderer.setSize(
        width,
        height,
        false
    );

    environment.camera.aspect =
        width /
        height;

    environment.camera.updateProjectionMatrix();
}


/* ============================================================
   48. LANDING MOBILE MENU
   ============================================================ */

function openLandingMobileMenu() {

    const menu =
        $("landingMobileMenu");

    const button =
        $("landingMobileMenuButton");

    if (!menu) {
        return;
    }

    state.landingMobileMenuOpen =
        true;

    menu.classList.add(
        "is-open"
    );

    menu.removeAttribute(
        "aria-hidden"
    );

    button?.setAttribute(
        "aria-expanded",
        "true"
    );
}

function closeLandingMobileMenu() {

    const menu =
        $("landingMobileMenu");

    const button =
        $("landingMobileMenuButton");

    state.landingMobileMenuOpen =
        false;

    menu?.classList.remove(
        "is-open"
    );

    menu?.setAttribute(
        "aria-hidden",
        "true"
    );

    button?.setAttribute(
        "aria-expanded",
        "false"
    );
}

function toggleLandingMobileMenu() {

    if (
        state.landingMobileMenuOpen
    ) {
        closeLandingMobileMenu();
    } else {
        openLandingMobileMenu();
    }
}


/* ============================================================
   49. MOBILE APPLICATION NAV
   ============================================================ */

function openMobileAppMenu() {

    const sidebar =
        $("appSidebar");

    const backdrop =
        $("mobileNavBackdrop");

    const button =
        $("mobileMenuButton");

    if (!sidebar) {
        return;
    }

    sidebar.classList.add(
        "is-mobile-open"
    );

    backdrop?.classList.add(
        "is-visible"
    );

    button?.setAttribute(
        "aria-expanded",
        "true"
    );

    state.mobileMenuOpen =
        true;
}

function closeMobileAppMenu() {

    const sidebar =
        $("appSidebar");

    const backdrop =
        $("mobileNavBackdrop");

    const button =
        $("mobileMenuButton");

    sidebar?.classList.remove(
        "is-mobile-open"
    );

    backdrop?.classList.remove(
        "is-visible"
    );

    button?.setAttribute(
        "aria-expanded",
        "false"
    );

    state.mobileMenuOpen =
        false;
}

function toggleMobileAppMenu() {

    if (
        state.mobileMenuOpen
    ) {
        closeMobileAppMenu();
    } else {
        openMobileAppMenu();
    }
}


/* ============================================================
   50. TOAST
   ============================================================ */

function toast(
    message
) {

    const root =
        $("toastRoot");

    const element =
        $("toast");

    if (
        !root ||
        !element
    ) {
        return;
    }

    setText(
        element,
        message
    );

    root.classList.add(
        "is-visible"
    );

    if (
        state.toastTimer
    ) {
        clearTimeout(
            state.toastTimer
        );
    }

    state.toastTimer =
        setTimeout(
            () =>
                root.classList.remove(
                    "is-visible"
                ),
            3200
        );
}


/* ============================================================
   51. SOUND BUTTON
   ============================================================ */

function toggleSound() {

    setSoundEnabled(
        !state.soundEnabled
    );

    if (
        state.soundEnabled
    ) {
        ensureAudioContext();

        toast(
            "Interaction sound enabled."
        );
    } else {

        toast(
            "Interaction sound muted."
        );
    }
}


/* ============================================================
   52. GLOBAL CLICK WIRING
   ============================================================ */

function wireGlobalClicks() {

    document.addEventListener(
        "click",
        event => {

            const navItem =
                event.target.closest(
                    "[data-section]"
                );

            if (
                navItem &&
                !navItem.matches(
                    ".app-nav-item"
                )
            ) {
                const section =
                    navItem.dataset.section;

                if (
                    section
                ) {
                    openSection(
                        section
                    );
                }
            }

            const authAction =
                event.target.closest(
                    "[data-auth-action]"
                );

            if (
                authAction
            ) {

                event.preventDefault();

                const mode =
                    authAction.dataset.authAction;

                if (
                    mode ===
                    "login"
                ) {

                    showAuthScreen(
                        "login"
                    );

                } else if (
                    mode ===
                    "register"
                ) {

                    showAuthScreen(
                        "register"
                    );
                }
            }

            const modalTrigger =
                event.target.closest(
                    "[data-modal-trigger]"
                );

            if (
                modalTrigger
            ) {

                const modalId =
                    modalForTrigger(
                        modalTrigger
                    );

                if (
                    modalId
                ) {

                    prepareModal(
                        modalId
                    );

                    openModal(
                        modalId
                    );
                }
            }

            const close =
                event.target.closest(
                    "[data-modal-close]"
                );

            if (
                close
            ) {

                const modal =
                    close.closest(
                        ".modal"
                    );

                if (
                    modal
                ) {
                    closeModal(
                        modal.id
                    );
                }
            }

            const action =
                event.target.closest(
                    "[data-action]"
                );

            if (
                action
            ) {
                handleDelegatedAction(
                    action
                );
            }

            const businessItem =
                event.target.closest(
                    "[data-business-id]"
                );

            if (
                businessItem &&
                $("businessList")
                    ?.contains(
                        businessItem
                    )
            ) {

                switchBusiness(
                    businessItem.dataset.businessId
                );
            }

            const settingsButton =
                event.target.closest(
                    "[data-settings-tab]"
                );

            if (
                settingsButton
            ) {

                state.activeSettingsTab =
                    settingsButton.dataset.settingsTab ||
                    "account";

                syncSettingsTabs();
            }
        }
    );
}

async function handleDelegatedAction(
    element
) {

    const action =
        element.dataset.action;

    const id =
        element.dataset.id;

    if (
        action ===
        "void-transaction"
    ) {

        await voidTransaction(
            id
        );

        return;
    }

    if (
        action ===
        "void-expense"
    ) {

        await voidExpense(
            id
        );

        return;
    }

    if (
        action ===
        "edit-product"
    ) {

        openProductModal(
            id
        );

        return;
    }

    if (
        action ===
        "archive-product"
    ) {

        await archiveProduct(
            id
        );

        return;
    }

    if (
        action ===
        "goal-menu"
    ) {

        handleGoalMenu(
            id,
            element
        );
    }
}

function handleGoalMenu(
    goalId,
    anchor
) {

    const goal =
        state.goals.find(
            item =>
                String(item.id) ===
                String(goalId)
        );

    if (!goal) {
        return;
    }

    requestConfirmation({
        title:
            "Archive goal?",
        message:
            `Archive "${goal.name || titleCase(goalType(goal))}"?`,
        confirmLabel:
            "Archive",
        tone:
            "danger",
        action:
            async () => {

                const path =
                    goalsApiPath();

                await apiRequest(
                    `${path}/${encodeURIComponent(
                        goalId
                    )}`,
                    {
                        method:
                            "PATCH",
                        body:
                            JSON.stringify({
                                status:
                                    "archived"
                            })
                    }
                );

                state.goals =
                    state.goals.map(
                        item =>
                            String(
                                item.id
                            ) ===
                            String(
                                goalId
                            )
                                ? {
                                    ...item,
                                    status:
                                        "archived"
                                }
                                : item
                    );

                renderGoals();

                toast(
                    "Goal archived."
                );
            }
    });
}


/* ============================================================
   53. OAUTH
   ============================================================ */

function oauthURL(
    provider
) {

    const normalized =
        lower(
            provider
        );

    /*
       The backend may expose OAuth routes such as:
         /auth/google
         /auth/github
       but credentials/authorization configuration belongs
       to the backend. We do not hard-code client secrets.
    */

    const candidates = [
        `/auth/${normalized}`,
        `/auth/${normalized}/start`,
        `/auth/oauth/${normalized}`
    ];

    /*
       We cannot reliably know which route your backend has unless
       it is explicitly defined. Therefore the first configured
       public route can be supplied through window.PROFITLY_OAUTH.
    */

    const configured =
        window.PROFITLY_OAUTH?.[
            normalized
        ];

    if (
        configured &&
        typeof configured ===
            "string"
    ) {
        return configured;
    }

    return candidates[0];
}

function startOAuth(
    provider
) {

    const apiUrl = API_URL.replace(/\/api\/v1$/, "");
    const oauthStartUrl = `${apiUrl}/api/v1/auth/${provider}/start`;

    window.location.href = oauthStartUrl;

}
/* ============================================================
   OAUTH CALLBACK
============================================================ */

function handleOAuthCallback() {

    const hash = window.location.hash;

    if (!hash || !hash.includes("access_token")) {
        return null;
    }

    const queryStart = hash.indexOf("?");

    if (queryStart === -1) {
        return null;
    }

    const queryString = hash.slice(queryStart + 1);
    const params = new URLSearchParams(queryString);

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const isNewUser = params.get("is_new_user") === "true";

    if (!accessToken || !refreshToken) {
        return null;
    }

    return {
        accessToken,
        refreshToken,
        isNewUser,
    };
}


/* ============================================================
   54. HASH / URL
   ============================================================ */

function wireHashNavigation() {

    window.addEventListener(
        "hashchange",
        () => {

            if (
                state.token
            ) {
                openSection(
                    getSectionFromHash(),
                    false
                );
            }
        }
    );
}


/* ============================================================
   55. KEYBOARD SHORTCUTS
   ============================================================ */

function wireKeyboardShortcuts() {

    document.addEventListener(
        "keydown",
        event => {

            const target =
                event.target;

            const typing =
                target instanceof
                HTMLInputElement ||
                target instanceof
                HTMLTextAreaElement ||
                target instanceof
                HTMLSelectElement ||
                target?.isContentEditable;

            if (
                event.key ===
                    "Escape"
            ) {

                if (
                    state.modalStack.length
                ) {

                    const last =
                        state.modalStack[
                            state.modalStack.length -
                            1
                        ];

                    closeModal(
                        last
                    );

                    return;
                }

                closeBusinessDropdown();
                closePeriodDropdown();
                closeSearch();
                closeLandingMobileMenu();
                closeMobileAppMenu();

                return;
            }

            if (
                event.key ===
                    "/" &&
                !typing
            ) {

                event.preventDefault();

                if (
                    state.token &&
                    !state.searchOpen
                ) {
                    openSearch();
                }

                return;
            }

            if (
                event.key ===
                    "n" &&
                !typing &&
                state.token
            ) {

                event.preventDefault();

                prepareModal(
                    "transactionModal"
                );

                openModal(
                    "transactionModal"
                );
            }
        }
    );
}


/* ============================================================
   56. AUTH FORM EVENTS
   ============================================================ */

function wireAuth() {

    $$("#authLoginTab, #authRegisterTab")
        .forEach(
            button => {

                button?.addEventListener(
                    "click",
                    () => {

                        state.authMode =
                            button.dataset.authMode ===
                            "register"
                                ? "register"
                                : "login";

                        syncAuthMode();

                    }
                );
            }
        );

    $("authForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                if (
                    state.authMode ===
                    "register"
                ) {
                    register();
                } else {
                    login();
                }
            }
        );

    $("authBackToLanding")
        ?.addEventListener(
            "click",
            () => {

                showLanding();
            }
        );

    $("authBrandHome")
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();

                showLanding();
            }
        );

    $$("#authGoogleButton, #heroGoogleButton")
        .forEach(
            button => {

                button?.addEventListener(
                    "click",
                    () =>
                        startOAuth(
                            "google"
                        )
                );
            }
        );

    $$("#authGithubButton, #heroGithubButton")
        .forEach(
            button => {

                button?.addEventListener(
                    "click",
                    () =>
                        startOAuth(
                            "github"
                        )
                );
            }
        );

    $("forgotPasswordButton")
        ?.addEventListener(
            "click",
            () => {

                toast(
                    "Password recovery requires the configured backend recovery endpoint."
                );
            }
        );
}


/* ============================================================
   57. BUSINESS / TOPBAR EVENTS
   ============================================================ */

function wireBusinessControls() {

    $("businessSwitcherButton")
        ?.addEventListener(
            "click",
            event => {

                event.stopPropagation();

                toggleBusinessDropdown();
            }
        );

    $("openBusinessModalFromDropdown")
        ?.addEventListener(
            "click",
            () => {

                closeBusinessDropdown();

                prepareModal(
                    "businessModal"
                );

                openModal(
                    "businessModal"
                );
            }
        );

    $("businessForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                createBusiness();
            }
        );
}


/* ============================================================
   58. PERIOD EVENTS
   ============================================================ */

function wirePeriodControls() {

    $("periodButton")
        ?.addEventListener(
            "click",
            event => {

                event.stopPropagation();

                togglePeriodDropdown();
            }
        );

    $$("#periodDropdown button[data-period]")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        setPeriod(
                            Number(
                                button.dataset.period
                            )
                        );

                        closePeriodDropdown();
                    }
                );
            }
        );

    $("openCustomPeriodButton")
        ?.addEventListener(
            "click",
            () => {

                closePeriodDropdown();

                openCustomPeriod();
            }
        );

    $("customPeriodForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                applyCustomPeriod();
            }
        );

    $$("[data-analytics-period]")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        if (
                            button.id ===
                            "analyticsCustomPeriodButton"
                        ) {

                            openCustomPeriod();

                            return;
                        }

                        setPeriod(
                            Number(
                                button.dataset.analyticsPeriod
                            )
                        );
                    }
                );
            }
        );

    $("analyticsCustomPeriodButton")
        ?.addEventListener(
            "click",
            openCustomPeriod
        );
}


/* ============================================================
   59. FORM EVENTS
   ============================================================ */

function wireForms() {

    $("productForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                saveProduct();
            }
        );

    $("expenseForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                createExpense();
            }
        );

    $("goalForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                createGoal();
            }
        );

    $("transactionForm")
        ?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                createTransaction();
            }
        );

    $("goalType")
        ?.addEventListener(
            "change",
            updateGoalTargetUI
        );

    [
        "transactionProduct",
        "transactionQuantity",
        "transactionUnitPrice",
        "transactionUnitCost"
    ].forEach(
        id => {

            const field =
                $(id);

            field?.addEventListener(
                "input",
                updateTransactionPreview
            );

            field?.addEventListener(
                "change",
                () => {

                    if (
                        id ===
                        "transactionProduct"
                    ) {
                        syncSelectedProduct();
                    }

                    updateTransactionPreview();
                }
            );
        }
    );

    const unitCost =
        $("transactionUnitCost");

    unitCost?.addEventListener(
        "focus",
        () => {
            if (
                number(unitCost.value) === 0
            ) {
                unitCost.value = "";
            }
        }
    );

    unitCost?.addEventListener(
        "blur",
        () => {
            if (!unitCost.value.trim()) {
                unitCost.value = "0";
                updateTransactionPreview();
            }
        }
    );

    $("transactionType")
        ?.addEventListener(
            "change",
            updateTransactionPreview
        );

    $("simulatorProduct")
        ?.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {

                    event.preventDefault();

                    calculateProfitSimulator();
                }
            }
        );

    $$("#simulatorSalePrice, #simulatorCostPrice, #simulatorSales")
        .forEach(
            field => {

                field?.addEventListener(
                    "keydown",
                    event => {

                        if (
                            event.key ===
                            "Enter"
                        ) {

                            event.preventDefault();

                            calculateProfitSimulator();
                        }
                    }
                );
            }
        );

    $("calculateProfitButton")
        ?.addEventListener(
            "click",
            calculateProfitSimulator
        );
}


/* ============================================================
   60. FILTERS / SEARCH EVENTS
   ============================================================ */

function wireFilters() {

    $("transactionSearch")
        ?.addEventListener(
            "input",
            event => {

                state.transactionSearch =
                    event.target.value;

                renderTransactions();
            }
        );

    $("transactionTypeFilter")
        ?.addEventListener(
            "change",
            event => {

                state.transactionFilter =
                    event.target.value;

                renderTransactions();
            }
        );

    $("globalSearchButton")
        ?.addEventListener(
            "click",
            openSearch
        );

    $("searchInput")
        ?.addEventListener(
            "input",
            event =>
                filterSearchResults(
                    event.target.value
                )
        );

    $("analyticsRankingSelect")
        ?.addEventListener(
            "change",
            event => {

                state.analyticsRanking =
                    event.target.value;

                renderAnalyticsRankings();
            }
        );
}


/* ============================================================
   61. SETTINGS EVENTS
   ============================================================ */

function wireSettings() {

    $("settingsProfileForm")
        ?.addEventListener(
            "submit",
            event => {
                event.preventDefault();
                saveSettingsProfile();
            }
        );

    $("settingsPasswordForm")
        ?.addEventListener(
            "submit",
            event => {
                event.preventDefault();
                saveSettingsPassword();
            }
        );

    $("settingsBusinessForm")
        ?.addEventListener(
            "submit",
            event => {
                event.preventDefault();
                saveSettingsBusiness();
            }
        );

    $("logoutButton")
        ?.addEventListener(
            "click",
            () => {

                requestConfirmation({
                    title:
                        "Log out of Profitly?",
                    message:
                        "Your server-side financial data remains untouched.",
                    confirmLabel:
                        "Log out",
                    tone:
                        "danger",
                    action:
                        logout
                });
            }
        );

    $("settingsSoundToggle")
        ?.addEventListener(
            "change",
            event =>
                setSoundEnabled(
                    event.target.checked
                )
        );

    $("reducedMotionToggle")
        ?.addEventListener(
            "change",
            event =>
                setReducedMotion(
                    event.target.checked
                )
        );

    $("settingsLanguage")
        ?.addEventListener(
            "change",
            event =>
                setLanguage(
                    event.target.value
                )
        );

    $("soundVolume")
        ?.addEventListener(
            "input",
            event =>
                setSoundVolume(
                    Number(
                        event.target.value
                    )
                )
        );

    $("sidebarProfileButton")
        ?.addEventListener(
            "click",
            () => {

                openSection(
                    "settings"
                );

                state.activeSettingsTab =
                    "account";

                syncSettingsTabs();
            }
        );

    $("settingsNavButton")
        ?.addEventListener(
            "click",
            () => {

                openSection(
                    "settings"
                );
            }
        );
}


/* ============================================================
   62. MOBILE / NAV EVENTS
   ============================================================ */

function wireNavigation() {

    $$(".app-nav-item[data-section]")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        openSection(
                            button.dataset.section
                        );

                        closeMobileAppMenu();
                    }
                );
            }
        );

    $("mobileMenuButton")
        ?.addEventListener(
            "click",
            toggleMobileAppMenu
        );

    $("mobileNavBackdrop")
        ?.addEventListener(
            "click",
            closeMobileAppMenu
        );

    $("landingMobileMenuButton")
        ?.addEventListener(
            "click",
            toggleLandingMobileMenu
        );

    $$(".landing-mobile-link")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () =>
                        closeLandingMobileMenu()
                );
            }
        );

    $("soundButton")
        ?.addEventListener(
            "click",
            toggleSound
        );
}


/* ============================================================
   63. OUTSIDE-CLICK EVENTS
   ============================================================ */

function wireOutsideClicks() {

    document.addEventListener(
        "click",
        event => {

            if (
                state.businessDropdownOpen &&
                !event.target.closest(
                    ".sidebar-business-switcher"
                )
            ) {
                closeBusinessDropdown();
            }

            if (
                state.periodDropdownOpen &&
                !event.target.closest(
                    ".period-control"
                )
            ) {
                closePeriodDropdown();
            }
        }
    );
}


/* ============================================================
   64. CHART EVENTS
   ============================================================ */

function wireCharts() {

    const chart =
        $("performanceChart");

    chart?.addEventListener(
        "pointermove",
        handlePerformancePointer
    );

    chart?.addEventListener(
        "pointerleave",
        () =>
            hide(
                "performanceChartTooltip"
            )
    );

    const analyticsChart =
        $("analyticsChart");

    analyticsChart?.addEventListener(
        "pointermove",
        handleAnalyticsPointer
    );

    analyticsChart?.addEventListener(
        "pointerleave",
        () =>
            hide(
                "analyticsTooltip"
            )
    );
}

function handleAnalyticsPointer(
    event
) {

    const chart =
        $("analyticsChart");

    const tooltip =
        $("analyticsTooltip");

    const series =
        analyticsSeries();

    if (
        !chart ||
        !tooltip ||
        !series.length
    ) {
        return;
    }

    const rect =
        chart.getBoundingClientRect();

    const x =
        clamp(
            event.clientX -
            rect.left,
            0,
            rect.width
        );

    const ratio =
        rect.width
            ? x /
                rect.width
            : 0;

    const index =
        Math.round(
            ratio *
            (
                series.length -
                1
            )
        );

    const point =
        series[
            clamp(
                index,
                0,
                series.length - 1
            )
        ];

    if (!point) {
        return;
    }

    tooltip.innerHTML = `
        <div class="chart-tooltip-title">
            ${escapeHTML(
                formatDate(
                    point.date ||
                    point.label
                )
            )}
        </div>

        <div class="chart-tooltip-row">
            <span>Revenue</span>
            <strong>
                ${escapeHTML(
                    formatCurrency(
                        point.revenue,
                        businessCurrency()
                    )
                )}
            </strong>
        </div>

        <div class="chart-tooltip-row">
            <span>Profit</span>
            <strong>
                ${escapeHTML(
                    formatCurrency(
                        point.profit,
                        businessCurrency()
                    )
                )}
            </strong>
        </div>

        <div class="chart-tooltip-row">
            <span>Expenses</span>
            <strong>
                ${escapeHTML(
                    formatCurrency(
                        point.expenses,
                        businessCurrency()
                    )
                )}
            </strong>
        </div>
    `;

    const tooltipWidth =
        tooltip.offsetWidth ||
        190;

    let left =
        x + 14;

    if (
        left +
        tooltipWidth >
        rect.width -
        8
    ) {
        left =
            x -
            tooltipWidth -
            14;
    }

    tooltip.style.left =
        `${Math.round(
            left
        )}px`;

    tooltip.style.top =
        `${Math.round(
            event.clientY -
            rect.top -
            15
        )}px`;

    show(
        tooltip
    );
}


/* ============================================================
   65. APPLICATION RENDER
   ============================================================ */

function renderAllBusinessData() {

    renderDashboard();

    renderTransactions();

    renderProducts();

    renderExpenses();

    renderGoals();

    renderAnalytics();

    renderReports();

    renderSettings();

    updateBusinessSwitcher();

    syncPeriodButtons();
}

function renderAll() {

    renderBusinesses();

    updateProfileUI();

    renderAllBusinessData();

    renderSettings();

    updateSoundButton();
}


/* ============================================================
   66. PROFILE / ACCOUNT DATA
   ============================================================ */

async function reloadCurrentAccount() {

    if (!state.accountId) {
        return;
    }

    /*
       The current backend context may expose account information
       through authentication/session only. We intentionally do not
       invent a GET /accounts/:id route unless the current API uses it.
    */

    if (
        state.account
    ) {
        updateProfileUI();
    }
}


/* ============================================================
   67. GLOBAL MODAL CLICK / FOCUS
   ============================================================ */

function wireModalBehavior() {

    $$(".modal")
        .forEach(
            modal => {

                modal.addEventListener(
                    "click",
                    event => {

                        if (
                            event.target !==
                            modal
                        ) {
                            return;
                        }

                        closeModal(
                            modal.id
                        );
                    }
                );
            }
        );

    $("confirmationCancelButton")
        ?.addEventListener(
            "click",
            () => {

                state.pendingConfirmation =
                    null;

                closeModal(
                    "confirmationModal"
                );
            }
        );

    $("confirmationConfirmButton")
        ?.addEventListener(
            "click",
            runPendingConfirmation
        );
}


/* ============================================================
   68. TOP-LEVEL CLICK / SCROLL BEHAVIOR
   ============================================================ */

function wireLandingBehavior() {

    document.addEventListener(
        "click",
        event => {

            const scrollLink =
                event.target.closest(
                    'a[href^="#"]'
                );

            if (
                !scrollLink
            ) {
                return;
            }

            const href =
                scrollLink.getAttribute(
                    "href"
                );

            if (
                !href ||
                href === "#"
            ) {
                return;
            }

            const target =
                document.querySelector(
                    href
                );

            if (
                target &&
                !state.token
            ) {

                event.preventDefault();

                target.scrollIntoView({
                    behavior:
                        state.reducedMotion
                            ? "auto"
                            : "smooth"
                });
            }
        }
    );

    let ticking =
        false;

    window.addEventListener(
        "scroll",
        () => {

            if (
                ticking
            ) {
                return;
            }

            ticking =
                true;

            requestAnimationFrame(
                () => {

                    const nav =
                        $("landingNav");

                    if (nav) {

                        nav.classList.toggle(
                            "scrolled",
                            window.scrollY >
                                24
                        );
                    }

                    ticking =
                        false;
                }
            );
        },
        {
            passive: true
        }
    );
}


/* ============================================================
   69. IMAGE FALLBACKS
   ============================================================ */

function wireImageFallbacks() {

    document.addEventListener(
        "error",
        event => {

            const image =
                event.target;

            if (
                !(
                    image instanceof
                    HTMLImageElement
                )
            ) {
                return;
            }

            if (
                image.dataset.fallbackApplied
            ) {
                return;
            }

            image.dataset.fallbackApplied =
                "true";

            const parent =
                image.closest(
                    ".luxury-scene, .lifestyle-image, .auth-luxury-image"
                );

            parent?.classList.add(
                "asset-missing"
            );

            /*
               We deliberately do not generate fake substitute imagery.
               CSS can provide a restrained dark fallback surface.
            */
        },
        true
    );
}


/* ============================================================
   70. ACCESSIBILITY
   ============================================================ */

function wireAccessibility() {

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !==
                "Tab"
            ) {
                return;
            }

            const modal =
                state.modalStack.length
                    ? $(
                        state.modalStack[
                            state.modalStack.length -
                            1
                        ]
                    )
                    : null;

            if (!modal) {
                return;
            }

            const focusable =
                modal.querySelectorAll(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
                );

            if (
                !focusable.length
            ) {
                return;
            }

            const first =
                focusable[0];

            const last =
                focusable[
                    focusable.length -
                    1
                ];

            if (
                event.shiftKey &&
                document.activeElement ===
                    first
            ) {

                event.preventDefault();

                last.focus();

            } else if (
                !event.shiftKey &&
                document.activeElement ===
                    last
            ) {

                event.preventDefault();

                first.focus();
            }
        }
    );
}


/* ============================================================
   71. DATE INITIALIZATION
   ============================================================ */

function initDateFields() {

    if (
        $("transactionDate")
    ) {
        $("transactionDate").value =
            today();
    }

    if (
        $("expenseDate")
    ) {
        $("expenseDate").value =
            today();
    }

    if (
        $("customPeriodFrom") &&
        !$("customPeriodFrom").value
    ) {
        $("customPeriodFrom").value =
            dateToISODate(
                getDateDaysAgo(30)
            );
    }

    if (
        $("customPeriodTo") &&
        !$("customPeriodTo").value
    ) {
        $("customPeriodTo").value =
            today();
    }

    if (
        $("goalCurrency")
    ) {
        $("goalCurrency").value =
            businessCurrency();
    }
}


/* ============================================================
   72. APPLICATION INITIALIZATION
   ============================================================ */

function wire() {

    wireGlobalClicks();

    wireAuth();

    wireBusinessControls();

    wirePeriodControls();

    wireForms();

    wireFilters();

    wireSettings();

    wireNavigation();

    wireOutsideClicks();

    wireCharts();

    wireKeyboardShortcuts();

    wireHashNavigation();

    wireModalBehavior();

    wireLandingBehavior();

    wireImageFallbacks();

    wireAccessibility();

    wireSettingsTabs();

    enhanceNativeSelects();

    fxEnsureMenu();

    fxWireMenuInteractions();

    wireOutsideClicksFx();

    initDateFields();

    updateGoalTargetUI();

    updateSoundButton();

    document.body.classList.toggle(
        "reduced-motion",
        state.reducedMotion
    );
}

async function init() {

    applyLanguagePreference();

    wire();

    /* ============================================================
       OAUTH CALLBACK HANDLING
    ============================================================ */

    const oauthResult = handleOAuthCallback();

    if (oauthResult) {
        state.token = oauthResult.accessToken;
        state.refreshToken = oauthResult.refreshToken;

        localStorage.setItem(STORAGE_KEYS.token, oauthResult.accessToken);
        localStorage.setItem(STORAGE_KEYS.refreshToken, oauthResult.refreshToken);

        window.history.replaceState(null, "", window.location.pathname);

        showApp();

        try {
            await reloadCurrentAccount();
            await loadCurrentUser();
            await loadBusinesses();

            const requested = getSectionFromHash();

            openSection(requested || "overview", false);

        } catch (error) {
            console.error("OAuth init failed:", error);
            showAuthScreen("login");
        }

        return;
    }

    syncAuthMode();

    syncPeriodButtons();

    initLandingEnvironment();

    renderSettings();

    renderAll();

    if (
        state.token &&
        state.accountId
    ) {

        showApp();

        try {

            await reloadCurrentAccount();

            await loadCurrentUser();

            await loadBusinesses();

            const requested =
                getSectionFromHash();

            openSection(
                requested ||
                    "overview",
                false
            );

        } catch (error) {

            console.error(
                "Profitly initialization failed:",
                error
            );

            if (
                state.refreshToken
            ) {

                try {

                    await refreshSession();

                    await loadBusinesses();

                } catch {

                    clearSession();

                    showAuthScreen(
                        "login"
                    );
                }

            } else {

                clearSession();

                showAuthScreen(
                    "login"
                );
            }
        }

    } else {

        showLanding();

        renderAll();

        if (
            window.location.hash &&
            getSectionFromHash() !==
                "overview"
        ) {

            /*
               Landing page hashes point to actual landing sections,
               so application navigation is only used after auth.
            */
            window.history.replaceState(
                null,
                "",
                window.location.pathname +
                window.location.search
            );
        }
    }
}


/* ============================================================
   73. DEFENSIVE HELPERS
   ============================================================ */

function removeUndefined(
    object
) {

    Object.keys(
        object
    ).forEach(
        key => {

            if (
                object[key] ===
                undefined
            ) {

                delete object[key];
            }
        }
    );

    return object;
}

function setDefaultIfEmpty(
    element,
    value
) {

    if (!element) {
        return;
    }

    if (
        !element.value
    ) {
        element.value =
            value;
    }
}


/* ============================================================
   74. VISUAL UI STATE
   ============================================================ */

function applyInitialVisualState() {

    document.body.classList.toggle(
        "reduced-motion",
        state.reducedMotion
    );

    const landing =
        $("landingPage");

    if (
        landing &&
        !state.token
    ) {
        landing.classList.add(
            "is-ready"
        );
    }
}

function prepareLandingAssets() {

    const images =
        $$(".landing-page img");

    images.forEach(
        image => {

            if (
                image.complete
            ) {
                image.classList.add(
                    "is-loaded"
                );

                return;
            }

            image.addEventListener(
                "load",
                () =>
                    image.classList.add(
                        "is-loaded"
                    ),
                {
                    once: true
                }
            );
        }
    );
}


/* ============================================================
   75. NETWORK / PAGE VISIBILITY
   ============================================================ */

function wireVisibility() {

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState ===
                "hidden"
            ) {
                return;
            }

            if (
                state.token &&
                state.selectedBusinessId
            ) {

                /*
                   Refresh analytics only when returning to the
                   application. We do not fabricate fresh data.
                */

                if (
                    state.activeSection ===
                    "analytics"
                ) {
                    refreshAnalyticsForPeriod();
                }
            }
        }
    );
}


/* ============================================================
   76. API CONNECTION WATCH
   ============================================================ */

function wireConnectionEvents() {

    window.addEventListener(
        "online",
        () => {

            toast(
                "Connection restored."
            );

            if (
                state.token &&
                state.selectedBusinessId
            ) {
                loadBusinessData();
            }
        }
    );

    window.addEventListener(
        "offline",
        () => {

            toast(
                "You're offline. Financial data remains server-backed and cannot be written until the connection returns."
            );
        }
    );
}


/* ============================================================
   77. CLEANUP
   ============================================================ */

window.addEventListener(
    "beforeunload",
    () => {

        const environment =
            state.landingEnvironment;

        if (
            environment.raf
        ) {
            cancelAnimationFrame(
                environment.raf
            );
        }

        if (
            state.audioContext &&
            typeof state.audioContext.close ===
                "function"
        ) {

            state.audioContext.close()
                .catch(
                    () => {}
                );
        }
    }
);


/* ============================================================
   78. FINAL STARTUP
   ============================================================ */

applyInitialVisualState();

prepareLandingAssets();

wireVisibility();

wireConnectionEvents();

init().catch(
    error => {

        console.error(
            "Fatal Profitly startup error:",
            error
        );

        clearSession();

        showLanding();

        toast(
            "Profitly could not initialize correctly."
        );
    }
);
