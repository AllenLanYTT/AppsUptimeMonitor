const STORAGE_KEY = "site-pulse-dashboard-sites";
const PROXY_PREF_KEY = "site-pulse-proxy-preference";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const DOWN_PILL_FLASH_MS = 2000;
const DOWN_PILL_FLASH_HOLD_MS = 650;
const TAB_TITLE_ALERT_INTERVAL_MS = 2000;
const RETRYABLE_PROXY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SITES_FILE_PATH = "sites.json";
const BUILD_NUMBER = "2d1ed5a";
const BUILD_TIMESTAMP = "Thu, 14 May 2026 23:11:57 GMT";

const PROXY_PROVIDERS = [
  {
    name: "AllOrigins",
    buildUrl: (targetUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
  },
  {
    name: "CorsProxy",
    buildUrl: (targetUrl) => `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
  },
  {
    name: "CodeTabs",
    buildUrl: (targetUrl) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
  }
];

const state = {
  sites: loadSitesFromStorage(),
  results: {},
  isCheckingAll: false,
  preferredProxy: loadPreferredProxy(),
  nextCheckAt: Date.now() + CHECK_INTERVAL_MS
};

const els = {
  cards: document.getElementById("cards"),
  countdown: document.getElementById("countdown"),
  checkNowBtn: document.getElementById("checkNowBtn"),
  siteForm: document.getElementById("siteForm"),
  siteName: document.getElementById("siteName"),
  siteUrl: document.getElementById("siteUrl"),
  proxyPreference: document.getElementById("proxyPreference"),
  enableNotificationsBtn: document.getElementById("enableNotificationsBtn"),
  formMessage: document.getElementById("formMessage"),
  debugDetails: document.getElementById("debugDetails"),
  buildNumber: document.getElementById("buildNumber"),
  buildTimestamp: document.getElementById("buildTimestamp"),
  cardTemplate: document.getElementById("cardTemplate")
};

const BASE_PAGE_TITLE = document.title;

let tabTitleAlertIntervalId = null;
let tabTitleAlertShowPing = false;

function renderBuildMeta() {
  if (els.buildNumber) {
    els.buildNumber.textContent = `Build ${BUILD_NUMBER}`;
  }

  if (els.buildTimestamp) {
    els.buildTimestamp.textContent = `Timestamp ${BUILD_TIMESTAMP}`;
  }
}

function loadPreferredProxy() {
  try {
    const raw = localStorage.getItem(PROXY_PREF_KEY);
    const exists = PROXY_PROVIDERS.some((provider) => provider.name === raw);
    return exists ? raw : PROXY_PROVIDERS[0].name;
  } catch {
    return PROXY_PROVIDERS[0].name;
  }
}

function savePreferredProxy(proxyName) {
  try {
    localStorage.setItem(PROXY_PREF_KEY, proxyName);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

function getOrderedProviders() {
  const preferred = PROXY_PROVIDERS.find((provider) => provider.name === state.preferredProxy);
  if (!preferred) {
    return [...PROXY_PROVIDERS];
  }

  return [
    preferred,
    ...PROXY_PROVIDERS.filter((provider) => provider.name !== preferred.name)
  ];
}

function syncProxyPreferenceUi() {
  if (!els.proxyPreference) {
    return;
  }

  els.proxyPreference.innerHTML = "";
  for (const provider of PROXY_PROVIDERS) {
    const option = document.createElement("option");
    option.value = provider.name;
    option.textContent = provider.name;
    els.proxyPreference.appendChild(option);
  }
  els.proxyPreference.value = state.preferredProxy;
}

function toSiteModel(item) {
  if (!item || !item.url) {
    return null;
  }

  const nameValue = item.name ?? item.label;
  const normalizedName = String(nameValue ?? "").trim();
  const normalizedUrl = parseWebsiteUrl(String(item.url));

  if (!normalizedName || !normalizedUrl) {
    return null;
  }

  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id : crypto.randomUUID(),
    name: normalizedName,
    url: normalizedUrl,
    comment: typeof item.comment === "string" ? item.comment.trim() : ""
  };
}

function loadSitesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(toSiteModel).filter((item) => item !== null);
  } catch {
    return [];
  }
}

async function loadSitesFromFile() {
  const response = await fetch(SITES_FILE_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`sites.json returned ${response.status}`);
  }

  const parsed = await response.json();
  if (!Array.isArray(parsed)) {
    throw new Error("sites.json must contain an array.");
  }

  return parsed.map(toSiteModel).filter((item) => item !== null);
}

function saveSites() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sites));
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

function getErrorText(error) {
  if (!error) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function canUseBrowserNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function isBrowserNotificationPermissionGranted() {
  return canUseBrowserNotifications() && Notification.permission === "granted";
}

async function requestBrowserNotificationPermission() {
  if (!canUseBrowserNotifications()) {
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

function sendBrowserNotification(title, options = {}) {
  if (!isBrowserNotificationPermissionGranted()) {
    return false;
  }

  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

function getResultStatus(result) {
  if (!result) {
    return "unknown";
  }

  if (result.inFlight && typeof result.ok !== "boolean") {
    return "unknown";
  }

  return result.ok ? "up" : "down";
}

function notifySiteStatusChange(site, previousResult, currentResult) {
  const previousStatus = getResultStatus(previousResult);
  const currentStatus = getResultStatus(currentResult);

  if (currentStatus === "down") {
    const body = `${site.url}\n${currentResult.message ?? "Site is unreachable."}`;
    sendBrowserNotification(`${site.name} is down`, {
      body,
      tag: site.id,
      renotify: true
    });
    return;
  }

  if (previousStatus === "down" && currentStatus === "up") {
    const body = `${site.url}\n${currentResult.message ?? "Site is back online."}`;
    sendBrowserNotification(`${site.name} is back up`, {
      body,
      tag: site.id
    });
  }
}

function setDebugDetails(source, error) {
  const text = `${source}\n${getErrorText(error)}`;
  els.debugDetails.textContent = text;
  els.debugDetails.hidden = false;
}

function clearDebugDetails() {
  els.debugDetails.textContent = "";
  els.debugDetails.hidden = true;
}

function normalizeUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function parseWebsiteUrl(rawInput) {
  const normalized = normalizeUrl(rawInput);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function setFormMessage(message, kind = "") {
  els.formMessage.textContent = message;
  els.formMessage.classList.remove("error", "success");
  if (kind) {
    els.formMessage.classList.add(kind);
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "Never";
  }

  return new Date(timestamp).toLocaleTimeString();
}

function getStatusLabel(result) {
  if (!result) {
    return { text: "Unknown", className: "unknown" };
  }

  if (result.inFlight && typeof result.ok !== "boolean") {
    return { text: "Unknown", className: "unknown" };
  }

  if (result.ok) {
    return { text: "Up", className: "up" };
  }

  return { text: "Down", className: "down" };
}

function isResultConclusivelyDown(result) {
  if (!result) {
    return false;
  }

  if (result.inFlight && typeof result.ok !== "boolean") {
    return false;
  }

  return result.ok === false;
}

function hasAnyDownSite() {
  return state.sites.some((site) => isResultConclusivelyDown(state.results[site.id]));
}

function stopTabTitleAlert() {
  if (tabTitleAlertIntervalId !== null) {
    clearInterval(tabTitleAlertIntervalId);
    tabTitleAlertIntervalId = null;
  }

  document.title = BASE_PAGE_TITLE;
}

function tickTabTitleAlert() {
  tabTitleAlertShowPing = !tabTitleAlertShowPing;
  document.title = tabTitleAlertShowPing ? `[DOWN] ${BASE_PAGE_TITLE}` : BASE_PAGE_TITLE;
}

function startTabTitleAlert() {
  if (tabTitleAlertIntervalId !== null) {
    return;
  }

  tabTitleAlertShowPing = false;
  tickTabTitleAlert();
  tabTitleAlertIntervalId = window.setInterval(tickTabTitleAlert, TAB_TITLE_ALERT_INTERVAL_MS);
}

function syncTabTitleAlert() {
  if (!hasAnyDownSite()) {
    stopTabTitleAlert();
    return;
  }

  startTabTitleAlert();
}

function renderCards() {
  els.cards.innerHTML = "";

  for (const site of state.sites) {
    const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
    const result = state.results[site.id];
    const status = getStatusLabel(result);

    card.querySelector(".site-name").textContent = site.name;
    card.querySelector(".site-url").textContent = site.url;

    const siteComment = card.querySelector(".site-comment");
    const commentText = site.comment?.trim();
    if (commentText) {
      siteComment.textContent = commentText;
      siteComment.hidden = false;
    } else {
      siteComment.textContent = "";
      siteComment.hidden = true;
    }

    const pill = card.querySelector(".pill");
    pill.textContent = status.text;
    pill.classList.add(status.className);
    pill.setAttribute("aria-label", status.text);

    card.querySelector(".latency").textContent = result?.latencyMs ? `${result.latencyMs} ms` : "-";
    card.querySelector(".code").textContent = result?.statusCode ?? "-";
    card.querySelector(".checked").textContent = formatTime(result?.checkedAt);
    card.querySelector(".provider").textContent = result?.provider ?? "-";
    card.querySelector(".message").textContent = result?.message ?? "Waiting for first check.";

    const refreshBtn = card.querySelector(".refresh");
    refreshBtn.disabled = !!result?.inFlight;
    refreshBtn.addEventListener("click", () => checkSingleSite(site.id));

    const removeBtn = card.querySelector(".remove");
    removeBtn.addEventListener("click", () => removeSite(site.id));

    els.cards.appendChild(card);
  }

  queueMicrotask(() => flashDownStatusPills());
  syncTabTitleAlert();
}

function flashDownStatusPills() {
  const root = els.cards;
  if (!root) {
    return;
  }

  const pills = root.querySelectorAll(".pill.down");
  for (const pill of pills) {
    pill.classList.remove("pill-down-flash-hit");
    void pill.offsetWidth;
    pill.classList.add("pill-down-flash-hit");
    window.setTimeout(() => {
      if (pill.isConnected) {
        pill.classList.remove("pill-down-flash-hit");
      }
    }, DOWN_PILL_FLASH_HOLD_MS);
  }
}

function updateCountdown() {
  const remaining = state.nextCheckAt - Date.now();
  els.countdown.textContent = formatCountdown(remaining);
}

async function fetchViaProxyWithFallback(url) {
  let lastError = null;

  for (const provider of getOrderedProviders()) {
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(provider.buildUrl(url), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      clearTimeout(timeout);
      const latencyMs = Math.round(performance.now() - start);

      // Retry with next proxy when the current proxy is timing out, rate-limited, or unhealthy.
      if (RETRYABLE_PROXY_STATUS.has(response.status)) {
        lastError = new Error(`${provider.name}: HTTP ${response.status}`);
        continue;
      }

      return { response, latencyMs, provider: provider.name };
    } catch (error) {
      clearTimeout(timeout);
      lastError = new Error(`${provider.name}: ${getErrorText(error)}`);
    }
  }

  throw lastError ?? new Error("All proxy providers failed.");
}

async function checkSite(site) {
  const previousResult = state.results[site.id];

  state.results[site.id] = {
    ...(previousResult ?? {}),
    inFlight: true,
    message: "Checking..."
  };
  renderCards();

  try {
    const { response, latencyMs, provider } = await fetchViaProxyWithFallback(site.url);

    const updatedResult = {
      ok: response.ok,
      statusCode: response.status,
      latencyMs,
      provider,
      checkedAt: Date.now(),
      inFlight: false,
      message: response.ok
        ? `Endpoint reachable via ${provider}.`
        : `${provider} responded with ${response.status}.`
    };

    state.results[site.id] = updatedResult;
    notifySiteStatusChange(site, previousResult, updatedResult);
  } catch (error) {
    const updatedResult = {
      ok: false,
      statusCode: "ERR",
      latencyMs: null,
      checkedAt: Date.now(),
      inFlight: false,
      message: `All proxy attempts failed: ${getErrorText(error)}`
    };

    state.results[site.id] = updatedResult;
    notifySiteStatusChange(site, previousResult, updatedResult);
  } finally {
    renderCards();
  }
}

async function runAllChecks() {
  if (state.isCheckingAll || state.sites.length === 0) {
    return;
  }

  state.isCheckingAll = true;
  els.checkNowBtn.disabled = true;

  try {
    await Promise.all(state.sites.map((site) => checkSite(site)));
    state.nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
    updateCountdown();
  } finally {
    state.isCheckingAll = false;
    els.checkNowBtn.disabled = false;
  }
}

async function checkSingleSite(siteId) {
  const site = state.sites.find((entry) => entry.id === siteId);
  if (!site) {
    return;
  }

  await checkSite(site);
}

function removeSite(siteId) {
  state.sites = state.sites.filter((site) => site.id !== siteId);
  delete state.results[siteId];
  const persisted = saveSites();
  renderCards();
  if (!persisted.ok) {
    setFormMessage("Removed from this session, but browser storage is blocked.", "error");
    setDebugDetails("saveSites() failed while removing site", persisted.error);
    return;
  }

  clearDebugDetails();
}

function handleAddSite(event) {
  event.preventDefault();

  try {
    const name = els.siteName.value.trim();
    const url = parseWebsiteUrl(els.siteUrl.value);

    if (!name || !url) {
      setFormMessage("Please enter a valid site label and URL.", "error");
      setDebugDetails("Validation failed in handleAddSite", `name='${name}', url='${els.siteUrl.value.trim()}'`);
      return;
    }

    const alreadyExists = state.sites.some((site) => site.url.toLowerCase() === url.toLowerCase());
    if (alreadyExists) {
      setFormMessage("That URL is already being monitored.", "error");
      setDebugDetails("Duplicate URL rejected", url);
      return;
    }

    state.sites.unshift({
      id: crypto.randomUUID(),
      name,
      url,
      comment: ""
    });

    renderCards();
    els.siteForm.reset();

    const persisted = saveSites();
    if (!persisted.ok) {
      setFormMessage(`Added ${name} for now, but browser storage is blocked.`, "error");
      setDebugDetails("saveSites() failed while adding site", persisted.error);
      return;
    }

    clearDebugDetails();
    setFormMessage(`Added ${name}.`, "success");
  } catch (error) {
    setFormMessage("Unexpected error while adding site.", "error");
    setDebugDetails("Unhandled exception in handleAddSite", error);
  }
}

async function init() {
  renderBuildMeta();
  syncProxyPreferenceUi();

  if (state.sites.length === 0) {
    try {
      state.sites = await loadSitesFromFile();
      const persisted = saveSites();
      if (!persisted.ok) {
        setFormMessage("Loaded default sites, but browser storage is blocked.", "error");
        setDebugDetails("saveSites() failed while caching defaults", persisted.error);
      } else {
        clearDebugDetails();
      }
    } catch (error) {
      setFormMessage("Unable to load default sites from sites.json.", "error");
      setDebugDetails("loadSitesFromFile() failed", error);
    }
  }

  renderCards();

  if (els.proxyPreference) {
    els.proxyPreference.addEventListener("change", (event) => {
      const nextValue = event.target.value;
      const exists = PROXY_PROVIDERS.some((provider) => provider.name === nextValue);
      if (!exists) {
        return;
      }

      state.preferredProxy = nextValue;
      const persisted = savePreferredProxy(nextValue);
      if (!persisted.ok) {
        setFormMessage("Preferred proxy changed for this session only.", "error");
        setDebugDetails("savePreferredProxy() failed", persisted.error);
        return;
      }

      clearDebugDetails();
      setFormMessage(`Preferred proxy set to ${nextValue}.`, "success");
    });
  }

  if (els.enableNotificationsBtn) {
    if (!canUseBrowserNotifications()) {
      els.enableNotificationsBtn.hidden = true;
    } else {
      const updateButtonText = () => {
        els.enableNotificationsBtn.textContent = isBrowserNotificationPermissionGranted()
          ? "Notifications enabled"
          : "Enable notifications";
        els.enableNotificationsBtn.disabled = Notification.permission === "denied";
      };

      updateButtonText();
      els.enableNotificationsBtn.addEventListener("click", async () => {
        const granted = await requestBrowserNotificationPermission();
        updateButtonText();
        if (granted) {
          setFormMessage("OS notifications are enabled.", "success");
        } else {
          setFormMessage(
            "Notifications were denied or are unavailable. Check browser settings.",
            "error"
          );
        }
      });
    }
  }

  els.checkNowBtn.addEventListener("click", runAllChecks);
  els.siteForm.addEventListener("submit", handleAddSite);

  setInterval(() => {
    updateCountdown();

    if (Date.now() >= state.nextCheckAt) {
      runAllChecks();
    }
  }, 1000);

  setInterval(flashDownStatusPills, DOWN_PILL_FLASH_MS);
  window.setTimeout(flashDownStatusPills, 600);

  runAllChecks();
}

init();
