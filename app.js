const STORAGE_KEY = "site-pulse-dashboard-sites";
const PROXY_PREF_KEY = "site-pulse-proxy-preference";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

const PROXY_PROVIDERS = [
  {
    name: "Direct",
    buildUrl: (targetUrl) => targetUrl
  },
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

const defaultSites = [
  { id: crypto.randomUUID(), name: "GitHub", url: "https://github.com" },
  { id: crypto.randomUUID(), name: "Microsoft", url: "https://www.microsoft.com" },
  { id: crypto.randomUUID(), name: "Cloudflare", url: "https://www.cloudflare.com" }
];

const state = {
  sites: loadSites(),
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
  formMessage: document.getElementById("formMessage"),
  debugDetails: document.getElementById("debugDetails"),
  cardTemplate: document.getElementById("cardTemplate")
};

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

function loadSites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [...defaultSites];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...defaultSites];
    }

    return parsed
      .filter((item) => item && item.id && item.name && item.url)
      .map((item) => ({
        id: item.id,
        name: String(item.name).trim(),
        url: normalizeUrl(String(item.url))
      }));
  } catch {
    return [...defaultSites];
  }
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

  if (result.ok) {
    return { text: "Up", className: "up" };
  }

  return { text: "Down", className: "down" };
}

function renderCards() {
  els.cards.innerHTML = "";

  for (const site of state.sites) {
    const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
    const result = state.results[site.id];
    const status = getStatusLabel(result);

    card.querySelector(".site-name").textContent = site.name;
    card.querySelector(".site-url").textContent = site.url;

    const pill = card.querySelector(".pill");
    pill.textContent = status.text;
    pill.classList.add(status.className);

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
      return { response, latencyMs, provider: provider.name };
    } catch (error) {
      clearTimeout(timeout);
      lastError = new Error(`${provider.name}: ${getErrorText(error)}`);
    }
  }

  throw lastError ?? new Error("All proxy providers failed.");
}

async function checkSite(site) {
  state.results[site.id] = {
    ...(state.results[site.id] ?? {}),
    inFlight: true,
    message: "Checking..."
  };
  renderCards();

  try {
    const { response, latencyMs, provider } = await fetchViaProxyWithFallback(site.url);

    state.results[site.id] = {
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
  } catch (error) {
    state.results[site.id] = {
      ok: false,
      statusCode: "ERR",
      latencyMs: null,
      checkedAt: Date.now(),
      inFlight: false,
      message: `All proxy attempts failed: ${getErrorText(error)}`
    };
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
      url
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

function init() {
  renderCards();
  syncProxyPreferenceUi();

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

  els.checkNowBtn.addEventListener("click", runAllChecks);
  els.siteForm.addEventListener("submit", handleAddSite);

  setInterval(() => {
    updateCountdown();

    if (Date.now() >= state.nextCheckAt) {
      runAllChecks();
    }
  }, 1000);

  runAllChecks();
}

init();
