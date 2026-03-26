const SITE_CONFIG = window.LEAD_SITE_CONFIG || {};
const THANK_YOU_PATH = SITE_CONFIG.thankYouPath || "/thanks.html";
const ATTRIBUTION_STORAGE_KEY = "lead-site:attribution";
const CONVERSION_STORAGE_KEY = "lead-site:conversion";
const TRACKING_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "msclkid",
];

bootstrapTracking();
captureAttributionSnapshot();
handleThankYouPage();
bindLeadForms();

function bindLeadForms() {
  const forms = document.querySelectorAll(".lead-form");

  for (const form of forms) {
    const status = form.querySelector(".form-status");
    const submitButton = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (status) status.textContent = "Submitting...";
      if (submitButton) submitButton.disabled = true;

      const formData = new FormData(form);
      const payload = {
        segment: form.dataset.segment,
        name: formData.get("name"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        address: formData.get("address"),
        bestTimeStart: formData.get("bestTimeStart"),
        bestTimeEnd: formData.get("bestTimeEnd"),
        attribution: buildLeadAttribution(),
      };

      try {
        const response = await fetch("/api/leads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Submission failed");
        }

        writeStorage(CONVERSION_STORAGE_KEY, {
          leadId: result.leadId || "",
          priority: result.priority || "",
          routingLane: result.routingLane || "",
          repeatSubmission: Boolean(result.repeatSubmission),
          webhookDeliveryStatus: result.webhookDeliveryStatus || "",
          segment: result.segment || payload.segment,
          state: stateFromSegment(result.segment || payload.segment),
          attribution: payload.attribution,
        });

        form.reset();
        window.location.assign(
          `${THANK_YOU_PATH}?segment=${encodeURIComponent(
            result.segment || payload.segment || ""
          )}`
        );
      } catch (error) {
        if (status) {
          status.textContent =
            error && error.message ? error.message : "Submission failed";
        }
        if (submitButton) submitButton.disabled = false;
      }
    });
  }
}

function bootstrapTracking() {
  window.dataLayer = window.dataLayer || [];

  if (SITE_CONFIG.gtmContainerId) {
    loadGtm(SITE_CONFIG.gtmContainerId);
  } else if (SITE_CONFIG.gaMeasurementId) {
    loadGtag(SITE_CONFIG.gaMeasurementId);
  }

  if (SITE_CONFIG.metaPixelId) {
    loadMetaPixel(SITE_CONFIG.metaPixelId);
  }
}

function loadGtm(containerId) {
  if (!containerId || document.querySelector('script[data-analytics="gtm"]')) {
    return;
  }

  window.dataLayer.push({
    "gtm.start": Date.now(),
    event: "gtm.js",
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(
    containerId
  )}`;
  script.dataset.analytics = "gtm";
  document.head.appendChild(script);
}

function loadGtag(measurementId) {
  if (
    !measurementId ||
    document.querySelector('script[data-analytics="gtag"]')
  ) {
    return;
  }

  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
    measurementId
  )}`;
  script.dataset.analytics = "gtag";
  document.head.appendChild(script);
}

function loadMetaPixel(pixelId) {
  if (!pixelId || window.fbq) {
    return;
  }

  (function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      if (n.callMethod) {
        n.callMethod.apply(n, arguments);
      } else {
        n.queue.push(arguments);
      }
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

function captureAttributionSnapshot() {
  const existing = readStorage(ATTRIBUTION_STORAGE_KEY);
  const current = currentAttributionSnapshot(existing);

  if (!existing || hasPaidSignal(current)) {
    writeStorage(ATTRIBUTION_STORAGE_KEY, current);
    return current;
  }

  return existing;
}

function currentAttributionSnapshot(existing) {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  return {
    trackingSessionId:
      (existing && existing.trackingSessionId) || createTrackingSessionId(),
    landingPath: `${url.pathname}${url.search}`,
    submissionPath: url.pathname,
    referrerUrl: normalizeUrl(document.referrer),
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    utmContent: params.get("utm_content") || "",
    utmTerm: params.get("utm_term") || "",
    gclid: params.get("gclid") || "",
    fbclid: params.get("fbclid") || "",
    msclkid: params.get("msclkid") || "",
  };
}

function buildLeadAttribution() {
  const stored = readStorage(ATTRIBUTION_STORAGE_KEY) || captureAttributionSnapshot();
  const url = new URL(window.location.href);

  return {
    trackingSessionId:
      stored.trackingSessionId || createTrackingSessionId(),
    landingPath: stored.landingPath || `${url.pathname}${url.search}`,
    submissionPath: url.pathname,
    referrerUrl: stored.referrerUrl || normalizeUrl(document.referrer),
    utmSource: stored.utmSource || "",
    utmMedium: stored.utmMedium || "",
    utmCampaign: stored.utmCampaign || "",
    utmContent: stored.utmContent || "",
    utmTerm: stored.utmTerm || "",
    gclid: stored.gclid || "",
    fbclid: stored.fbclid || "",
    msclkid: stored.msclkid || "",
  };
}

function handleThankYouPage() {
  if (window.location.pathname !== THANK_YOU_PATH) {
    return;
  }

  const segment =
    new URL(window.location.href).searchParams.get("segment") || "";
  const stateLabel = stateLabelFromSegment(segment);
  const lead = readStorage(CONVERSION_STORAGE_KEY);
  const copy = document.querySelector("[data-thanks-copy]");
  const detail = document.querySelector("[data-thanks-detail]");

  if (copy) {
    copy.textContent = `Thanks for joining the ${stateLabel} waitlist. We saved your request and will use your selected contact channels for updates.`;
  }

  if (detail) {
    detail.textContent =
      "If you came from a paid campaign, this page is the clean conversion destination for tracking and reporting.";
  }

  if (!lead) {
    return;
  }

  const trackingPayload = {
    event: "generate_lead",
    lead_segment: lead.segment || segment,
    lead_state: lead.state || stateFromSegment(segment),
    lead_priority: lead.priority || "",
    routing_lane: lead.routingLane || "",
    source_channel: deriveSourceChannel(lead.attribution || {}),
    utm_source: (lead.attribution && lead.attribution.utmSource) || "",
    utm_medium: (lead.attribution && lead.attribution.utmMedium) || "",
    utm_campaign: (lead.attribution && lead.attribution.utmCampaign) || "",
  };

  window.dataLayer.push(trackingPayload);

  if (typeof window.gtag === "function") {
    window.gtag("event", "generate_lead", {
      segment: trackingPayload.lead_segment,
      lead_state: trackingPayload.lead_state,
      source_channel: trackingPayload.source_channel,
      campaign_name: trackingPayload.utm_campaign,
    });
  }

  if (typeof window.fbq === "function") {
    window.fbq("track", "Lead", {
      content_name: trackingPayload.lead_segment || "waitlist",
    });
  }

  clearStorage(CONVERSION_STORAGE_KEY);
}

function hasPaidSignal(attribution) {
  const referrer = normalizeUrl(attribution.referrerUrl);
  if (referrer) {
    try {
      if (new URL(referrer).origin !== window.location.origin) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return TRACKING_KEYS.some((key) => {
    const property = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    return Boolean(attribution[property]);
  });
}

function deriveSourceChannel(attribution) {
  const medium = String(attribution.utmMedium || "").toLowerCase();
  const paidMediums = new Set([
    "cpc",
    "ppc",
    "paid",
    "paid_social",
    "paid-social",
    "display",
    "affiliate",
  ]);

  if (attribution.gclid || attribution.fbclid || attribution.msclkid) {
    return "paid";
  }
  if (paidMediums.has(medium)) {
    return "paid";
  }
  if (medium === "email" || medium === "sms" || medium === "push") {
    return "owned";
  }
  if (medium === "referral" || attribution.referrerUrl) {
    return "referral";
  }
  if (attribution.utmSource || attribution.utmCampaign) {
    return "campaign";
  }
  return "direct";
}

function stateFromSegment(segment) {
  if (segment === "consumer-ca") return "CA";
  if (segment === "consumer-ga") return "GA";
  return "unknown";
}

function stateLabelFromSegment(segment) {
  if (segment === "consumer-ca") return "California";
  if (segment === "consumer-ga") return "Georgia";
  return "selected";
}

function createTrackingSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function readStorage(key) {
  try {
    const raw = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  const encoded = JSON.stringify(value);
  try {
    if (key === CONVERSION_STORAGE_KEY) {
      window.sessionStorage.setItem(key, encoded);
      return;
    }
    window.localStorage.setItem(key, encoded);
  } catch {
    // Ignore storage failures and keep the form flow moving.
  }
}

function clearStorage(key) {
  try {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}
