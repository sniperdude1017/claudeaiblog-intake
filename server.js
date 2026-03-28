const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const DEFAULT_GOOGLE_TAG_ID = "AW-18041225391";
const DEFAULT_GOOGLE_ADS_CONVERSION_LABEL = "non1CMLJt5AcEK-B3ZpD";
const PORT = process.env.PORT || 3030;
const HOST = resolveHost(process.env.HOST);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const REQUESTED_DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const DATA_DIR = resolveWritableDataDir(REQUESTED_DATA_DIR);
const JSON_PATH = path.join(DATA_DIR, "leads.json");
const CSV_PATH = path.join(DATA_DIR, "leads.csv");
const NOTES_PATH = path.join(DATA_DIR, "notes-export.txt");
const CREDS_PATH = path.join(DATA_DIR, "admin-credentials.json");
const WEBHOOK_QUEUE_PATH = path.join(DATA_DIR, "webhook-queue.ndjson");
const ALLOW_LEAD_READS = process.env.ALLOW_LEAD_READS === "true";
const LEAD_WEBHOOK_URL = String(process.env.LEAD_WEBHOOK_URL || "").trim();
const LEAD_WEBHOOK_TOKEN = String(process.env.LEAD_WEBHOOK_TOKEN || "").trim();
const LEAD_WEBHOOK_TIMEOUT_MS = cleanTimeout(
  process.env.LEAD_WEBHOOK_TIMEOUT_MS,
  4000
);
const TELEGRAM_FORWARD_TOKEN = cleanTrackingValue(
  process.env.TELEGRAM_FORWARD_TOKEN,
  200
);
const TELEGRAM_FORWARD_CHAT_ID = cleanTrackingValue(
  process.env.TELEGRAM_FORWARD_CHAT_ID,
  64
);
const TELEGRAM_FORWARD_TIMEOUT_MS = cleanTimeout(
  process.env.TELEGRAM_FORWARD_TIMEOUT_MS,
  4000
);
const GTM_CONTAINER_ID = cleanTrackingValue(process.env.GTM_CONTAINER_ID, 64);
const GA_MEASUREMENT_ID = resolveGoogleTagId(process.env.GA_MEASUREMENT_ID);
const GOOGLE_ADS_CONVERSION_LABEL = cleanTrackingValue(
  process.env.GOOGLE_ADS_CONVERSION_LABEL || DEFAULT_GOOGLE_ADS_CONVERSION_LABEL,
  120
);
const META_PIXEL_ID = cleanTrackingValue(process.env.META_PIXEL_ID, 64);
const GOOGLE_MAPS_API_KEY = cleanTrackingValue(
  process.env.GOOGLE_MAPS_API_KEY,
  160
);
const THANK_YOU_PATH = "/thanks.html";
const DEFAULT_SEGMENT = "consumer-us";
const LEGACY_JOIN_PATHS = new Set([
  "/consumer-ca.html",
  "/consumer-ga.html",
]);
const CLIENT_CONFIG = {
  gtmContainerId: GTM_CONTAINER_ID,
  gaMeasurementId: GTM_CONTAINER_ID ? "" : GA_MEASUREMENT_ID,
  googleAdsConversionLabel: GOOGLE_ADS_CONVERSION_LABEL,
  metaPixelId: META_PIXEL_ID,
  googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  thankYouPath: THANK_YOU_PATH,
};
const credentials = ensureCredentials();
const CSV_HEADER =
  "timestamp,lead_id,name,phone,email,address,market,state,segment,consent_source,owns_phone,phone_verification_status,best_time_start,best_time_end,source_channel,priority,lead_score,routing_lane,follow_up_channel,follow_up_deadline,repeat_submission,submission_index,landing_path,submission_path,referrer_url,utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid,fbclid,msclkid,tracking_session_id,webhook_delivery_status\n";
const PUBLIC_PATHS = new Set([
  "/",
  "/index.html",
  "/join.html",
  "/thanks.html",
  "/privacy.html",
  "/robots.txt",
  "/config.js",
  "/app.js",
  "/styles.css",
  "/healthz",
]);

const segments = {
  [DEFAULT_SEGMENT]: {
    market: "United States Consumer",
    state: "US",
    title: "United States Consumer Review Request",
  },
};

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  res.__requestMethod = req.method;

  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/healthz") {
    return sendText(res, 200, "ok");
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const publicFilePath = resolvePublicFilePath(url.pathname);
  const isPublicStaticRequest =
    (req.method === "GET" || req.method === "HEAD") &&
    publicFilePath &&
    fs.existsSync(publicFilePath);

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/config.js") {
    return sendJavaScript(
      res,
      200,
      `window.LEAD_SITE_CONFIG = ${JSON.stringify(CLIENT_CONFIG, null, 2)};\n`
    );
  }

  if ((req.method === "GET" || req.method === "HEAD") && LEGACY_JOIN_PATHS.has(url.pathname)) {
    return redirect(res, "/join.html");
  }

  if (!isAuthorized(req)) {
    if (
      PUBLIC_PATHS.has(url.pathname) ||
      isPublicStaticRequest ||
      (req.method === "POST" && url.pathname === "/api/leads")
    ) {
      // allow public routes and lead submissions without auth
    } else {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Inbound Lead Intake"',
        "Cache-Control": "no-store",
      });
      res.end("Authentication required");
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/leads") {
    if (!ALLOW_LEAD_READS) {
      return sendJson(res, 403, {
        ok: false,
        error: "Lead read access is disabled",
      });
    }
    return sendJson(res, 200, readLeads());
  }

  if (req.method === "POST" && url.pathname === "/api/leads") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const leads = readLeads();
      const lead = normalizeLead(payload, req, leads);
      leads.push(lead);
      writeLeads(leads);
      const webhookResult = await deliverLeadWebhook(lead);
      lead.webhook_delivery_status = webhookResult.status;
      lead.webhook_response_code = webhookResult.responseCode ?? null;
      lead.webhook_last_error = webhookResult.error || "";
      writeLeads(leads);
      return sendJson(res, 201, {
        ok: true,
        count: leads.length,
        leadId: lead.lead_id,
        segment: lead.segment,
      });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: error.message,
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/notes") {
    const leads = readLeads();
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(renderNotes(leads));
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  const filePath = path.join(PUBLIC_DIR, sanitizePath(url.pathname));
  return serveFile(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`Inbound lead intake running on http://${HOST}:${PORT}`);
  console.log(`Lead data directory: ${DATA_DIR}`);
});

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(JSON_PATH)) {
    fs.writeFileSync(JSON_PATH, "[]\n");
  }
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, CSV_HEADER);
  }
  if (!fs.existsSync(NOTES_PATH)) {
    fs.writeFileSync(
      NOTES_PATH,
      "Inbound lead notes\n\nNo leads captured yet.\n"
    );
  }
  if (!fs.existsSync(WEBHOOK_QUEUE_PATH)) {
    fs.writeFileSync(WEBHOOK_QUEUE_PATH, "");
  }
}

function resolveWritableDataDir(preferredDir) {
  const candidates = [
    preferredDir,
    path.join(os.tmpdir(), "inbound-lead-intake-data"),
  ];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      const testPath = path.join(candidate, ".write-test");
      fs.writeFileSync(testPath, "ok");
      fs.unlinkSync(testPath);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("No writable data directory available");
}

function resolveHost(requestedHost) {
  // Render requires binding to every interface regardless of any stale env value.
  if (
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER ||
    process.env.RENDER_EXTERNAL_URL
  ) {
    return "0.0.0.0";
  }

  return String(requestedHost || "127.0.0.1").trim() || "127.0.0.1";
}

function resolveGoogleTagId(requestedTagId) {
  const cleaned = cleanTrackingValue(requestedTagId, 64);

  if (/^(G|AW)-[A-Z0-9-]+$/i.test(cleaned)) {
    return cleaned;
  }

  return DEFAULT_GOOGLE_TAG_ID;
}

function ensureCredentials() {
  const usernameFromEnv = process.env.BASIC_AUTH_USERNAME;
  const passwordFromEnv = process.env.BASIC_AUTH_PASSWORD;
  if (usernameFromEnv || passwordFromEnv) {
    if (!usernameFromEnv || !passwordFromEnv) {
      throw new Error(
        "BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD must both be set"
      );
    }
    return {
      username: usernameFromEnv,
      password: passwordFromEnv,
    };
  }

  if (!fs.existsSync(CREDS_PATH)) {
    const generated = {
      username: "admin",
      password: crypto.randomBytes(12).toString("base64url"),
    };
    fs.writeFileSync(CREDS_PATH, JSON.stringify(generated, null, 2) + "\n", {
      mode: 0o600,
    });
    return generated;
  }

  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
}

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;

  const encoded = header.slice(6);
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return (
    safeEqual(username, credentials.username) &&
    safeEqual(password, credentials.password)
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizePath(rawPath) {
  const cleanPath = rawPath === "/" ? "/index.html" : rawPath;
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, "");
  return normalized.startsWith(path.sep) ? normalized.slice(1) : normalized;
}

function resolvePublicFilePath(rawPath) {
  const filePath = path.join(PUBLIC_DIR, sanitizePath(rawPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return filePath;
}

function serveFile(res, filePath) {
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendText(res, 404, "Not Found");
    }

    let body = content;
    if (path.extname(filePath).toLowerCase() === ".html") {
      body = injectTrackingMarkup(content.toString("utf8"));
    }

    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
    });
    if (res.req?.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  });
}

function injectTrackingMarkup(html) {
  const markup = renderTrackingHeadMarkup();
  if (!markup || html.includes('data-analytics="gtag"')) {
    return html;
  }

  return html.replace("</head>", `${markup}\n  </head>`);
}

function renderTrackingHeadMarkup() {
  if (GTM_CONTAINER_ID || !GA_MEASUREMENT_ID) {
    return "";
  }

  const tagId = JSON.stringify(GA_MEASUREMENT_ID);
  return [
    `    <script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
      GA_MEASUREMENT_ID
    )}" data-analytics="gtag"></script>`,
    "    <script>",
    "      window.dataLayer = window.dataLayer || [];",
    "      window.gtag = window.gtag || function gtag(){dataLayer.push(arguments);};",
    "      window.gtag('js', new Date());",
    `      window.gtag('config', ${tagId});`,
    "    </script>",
  ].join("\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeLead(payload, req, existingLeads) {
  const rawSegment = String(payload.segment || "").trim();
  const address = cleanText(payload.address, 160);
  const segment = normalizeSegment(rawSegment) || DEFAULT_SEGMENT;
  const segmentConfig = segments[segment];
  if (!segmentConfig) {
    throw new Error("Lead routing is unavailable");
  }

  const now = new Date().toISOString();
  const name = cleanText(payload.name, 100);
  const email = cleanEmail(payload.email);
  const rawPhone = String(payload.phone || "").trim();
  const phone = cleanPhone(payload.phone);
  const bestTimeStart = cleanTimeValue(
    payload.bestTimeStart || payload.best_time_start
  );
  const bestTimeEnd = cleanTimeValue(
    payload.bestTimeEnd || payload.best_time_end
  );
  const attribution = normalizeAttribution({
    ...(payload && typeof payload === "object" ? payload : {}),
    ...(payload.attribution && typeof payload.attribution === "object"
      ? payload.attribution
      : {}),
  });
  const hasPhone = Boolean(phone);
  const priorMatches = existingLeads.filter(
    (lead) => lead.email === email || (phone && lead.phone === phone)
  );
  const submissionIndex = priorMatches.length + 1;
  const sourceChannel = deriveSourceChannel(attribution);
  const priority = derivePriority(sourceChannel, submissionIndex, hasPhone);
  const leadScore = deriveLeadScore(
    sourceChannel,
    submissionIndex,
    attribution,
    hasPhone
  );
  const followUpDeadline = new Date(
    Date.now() + followUpDelayMinutes(priority) * 60_000
  ).toISOString();

  if (!name) throw new Error("Name is required");
  if (!email) throw new Error("Valid email is required");
  if (!rawPhone) {
    throw new Error("Phone is required");
  }
  if (!phone) {
    throw new Error("Phone must be a valid 10-digit number");
  }
  if ((bestTimeStart && !bestTimeEnd) || (!bestTimeStart && bestTimeEnd)) {
    throw new Error("Choose both callback times or leave both blank");
  }
  if (bestTimeStart && bestTimeEnd && bestTimeStart >= bestTimeEnd) {
    throw new Error("Best time window must end after it starts");
  }

  return {
    timestamp: now,
    lead_id: crypto.randomUUID(),
    name,
    phone,
    email,
    address,
    market: segmentConfig.market,
    state: segmentConfig.state,
    segment,
    consent_source: "join-form",
    owns_phone: hasPhone,
    phone_verification_status: hasPhone ? "user-provided" : "not-provided",
    best_time_start: bestTimeStart,
    best_time_end: bestTimeEnd,
    source_channel: sourceChannel,
    priority,
    lead_score: leadScore,
    routing_lane: `${segmentConfig.state.toLowerCase()}-${priority}-${sourceChannel}`,
    follow_up_channel: hasPhone ? "email-or-phone" : "email-first",
    follow_up_deadline: followUpDeadline,
    repeat_submission: submissionIndex > 1,
    submission_index: submissionIndex,
    tracking_session_id: attribution.tracking_session_id,
    landing_path: attribution.landing_path,
    submission_path: attribution.submission_path,
    referrer_url: attribution.referrer_url,
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    utm_content: attribution.utm_content,
    utm_term: attribution.utm_term,
    gclid: attribution.gclid,
    fbclid: attribution.fbclid,
    msclkid: attribution.msclkid,
    client_ip: extractClientIp(req),
    webhook_delivery_status: LEAD_WEBHOOK_URL ? "pending" : "disabled",
  };
}

function cleanText(value, maxLength) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.length > maxLength) return "";
  return text;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function cleanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 10) return "";
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function cleanZip(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 5) return "";
  return digits;
}

function cleanTimeValue(value) {
  const text = String(value || "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) return "";
  return text;
}

function normalizeSegment(value) {
  const segment = String(value || "").trim().toLowerCase();
  if (segment === DEFAULT_SEGMENT || /^consumer-[a-z]{2}$/.test(segment)) {
    return DEFAULT_SEGMENT;
  }
  return "";
}

function cleanTimeout(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 20000) {
    return fallback;
  }
  return parsed;
}

function cleanTrackingValue(value, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function cleanPathValue(value) {
  const text = String(value || "").trim();
  if (!text || !text.startsWith("/")) return "";
  return text.slice(0, 240);
}

function cleanUrlValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function normalizeAttribution(input) {
  const attribution = input && typeof input === "object" ? input : {};
  return {
    tracking_session_id: cleanTrackingValue(
      attribution.trackingSessionId || attribution.tracking_session_id,
      80
    ),
    landing_path: cleanPathValue(
      attribution.landingPath || attribution.landing_path
    ),
    submission_path: cleanPathValue(
      attribution.submissionPath || attribution.submission_path
    ),
    referrer_url: cleanUrlValue(
      attribution.referrerUrl || attribution.referrer_url
    ),
    utm_source: cleanTrackingValue(
      attribution.utmSource || attribution.utm_source
    ),
    utm_medium: cleanTrackingValue(
      attribution.utmMedium || attribution.utm_medium
    ),
    utm_campaign: cleanTrackingValue(
      attribution.utmCampaign || attribution.utm_campaign
    ),
    utm_content: cleanTrackingValue(
      attribution.utmContent || attribution.utm_content
    ),
    utm_term: cleanTrackingValue(attribution.utmTerm || attribution.utm_term),
    gclid: cleanTrackingValue(attribution.gclid),
    fbclid: cleanTrackingValue(attribution.fbclid),
    msclkid: cleanTrackingValue(attribution.msclkid),
  };
}

function deriveSourceChannel(attribution) {
  const paidMediums = new Set([
    "cpc",
    "ppc",
    "paid",
    "paid_social",
    "paid-social",
    "display",
    "affiliate",
  ]);
  const ownedMediums = new Set(["email", "sms", "push"]);
  const medium = attribution.utm_medium.toLowerCase();

  if (attribution.gclid || attribution.fbclid || attribution.msclkid) {
    return "paid";
  }
  if (paidMediums.has(medium)) {
    return "paid";
  }
  if (ownedMediums.has(medium)) {
    return "owned";
  }
  if (medium === "referral" || attribution.referrer_url) {
    return "referral";
  }
  if (attribution.utm_source || attribution.utm_campaign) {
    return "campaign";
  }
  return "direct";
}

function derivePriority(sourceChannel, submissionIndex, hasPhone) {
  if (submissionIndex > 1 || (sourceChannel === "paid" && hasPhone)) {
    return "hot";
  }
  if (
    sourceChannel === "paid" ||
    sourceChannel === "referral" ||
    sourceChannel === "campaign" ||
    hasPhone
  ) {
    return "warm";
  }
  return "new";
}

function deriveLeadScore(sourceChannel, submissionIndex, attribution, hasPhone) {
  let score = 55;
  if (sourceChannel === "paid") score += 20;
  if (sourceChannel === "referral") score += 10;
  if (sourceChannel === "campaign") score += 5;
  if (attribution.utm_campaign) score += 5;
  if (hasPhone) score += 10;
  if (submissionIndex > 1) score += 10;
  return Math.min(score, 100);
}

function followUpDelayMinutes(priority) {
  if (priority === "hot") return 15;
  if (priority === "warm") return 30;
  return 60;
}

function extractClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (forwarded) return forwarded.slice(0, 120);
  return String(req.socket.remoteAddress || "").slice(0, 120);
}

function readLeads() {
  const raw = fs.readFileSync(JSON_PATH, "utf8");
  const leads = JSON.parse(raw);
  return leads.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function writeLeads(leads) {
  const ordered = [...leads].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  fs.writeFileSync(JSON_PATH, JSON.stringify(ordered, null, 2) + "\n");
  fs.writeFileSync(CSV_PATH, renderCsv(ordered));
  fs.writeFileSync(NOTES_PATH, renderNotes(ordered));
}

function renderCsv(leads) {
  const rows = leads.map((lead) =>
    [
      lead.timestamp,
      lead.lead_id,
      lead.name,
      lead.phone,
      lead.email,
      lead.address,
      lead.market,
      lead.state,
      lead.segment,
      lead.consent_source,
      lead.owns_phone,
      lead.phone_verification_status,
      lead.best_time_start,
      lead.best_time_end,
      lead.source_channel,
      lead.priority,
      lead.lead_score,
      lead.routing_lane,
      lead.follow_up_channel,
      lead.follow_up_deadline,
      lead.repeat_submission,
      lead.submission_index,
      lead.landing_path,
      lead.submission_path,
      lead.referrer_url,
      lead.utm_source,
      lead.utm_medium,
      lead.utm_campaign,
      lead.utm_content,
      lead.utm_term,
      lead.gclid,
      lead.fbclid,
      lead.msclkid,
      lead.tracking_session_id,
      lead.webhook_delivery_status,
    ]
      .map(csvEscape)
      .join(",")
  );
  return CSV_HEADER + rows.join("\n") + (rows.length ? "\n" : "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function renderNotes(leads) {
  if (!leads.length) {
    return "Inbound lead notes\n\nNo leads captured yet.\n";
  }

  const lines = ["Inbound lead notes", ""];
  for (const lead of leads) {
    lines.push(formatLeadNoteLine(lead));
  }
  lines.push("");
  return lines.join("\n");
}

function formatLeadNoteLine(lead) {
  const sourceSummary = [
    lead.source_channel,
    lead.utm_source,
    lead.utm_medium,
    lead.utm_campaign,
  ]
    .filter(Boolean)
    .join("/");
  const repeatSummary = lead.repeat_submission
    ? `repeat #${lead.submission_index}`
    : "new";

  return [
    lead.timestamp,
    lead.priority.toUpperCase(),
    lead.name,
    lead.phone || "no phone",
    lead.email,
    lead.market,
    lead.state,
    lead.address || "no address",
    `best time ${formatTimeWindow(lead.best_time_start, lead.best_time_end)}`,
    `score ${lead.lead_score}`,
    `route ${lead.routing_lane}`,
    `follow up ${lead.follow_up_deadline}`,
    `source ${sourceSummary || "direct"}`,
    repeatSummary,
    `phone ${lead.phone_verification_status}`,
    `webhook ${lead.webhook_delivery_status}`,
  ].join(" | ");
}

function formatTimeWindow(start, end) {
  if (start && end) return `${start}-${end}`;
  return start || end || "not provided";
}

async function deliverLeadWebhook(lead) {
  const hasWebhook = Boolean(LEAD_WEBHOOK_URL);
  const hasTelegram = Boolean(
    TELEGRAM_FORWARD_TOKEN && TELEGRAM_FORWARD_CHAT_ID
  );

  if (!hasWebhook && !hasTelegram) {
    return { status: "disabled" };
  }

  const results = [];

  if (hasWebhook) {
    results.push(await deliverLeadHttpWebhook(lead));
  }

  if (hasTelegram) {
    results.push(await deliverLeadTelegram(lead));
  }

  const failed = results.filter((result) => result.status !== "sent");
  const responseCodes = results
    .map((result) => result.responseCode)
    .filter((code) => Number.isInteger(code));
  const errors = failed
    .map((result) => result.error)
    .filter(Boolean)
    .join(" | ");

  if (!failed.length) {
    return {
      status: "sent",
      responseCode: responseCodes[0] ?? null,
    };
  }

  if (failed.length === results.length) {
    return {
      status: "queued",
      responseCode: responseCodes[0] ?? null,
      error: errors,
    };
  }

  return {
    status: "partial",
    responseCode: responseCodes[0] ?? null,
    error: errors,
  };
}

async function deliverLeadHttpWebhook(lead) {
  try {
    const response = await fetch(LEAD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(LEAD_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${LEAD_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        event: "lead.created",
        sent_at: new Date().toISOString(),
        lead,
      }),
      signal: AbortSignal.timeout(LEAD_WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = `HTTP ${response.status}${body ? ` ${body.slice(0, 240)}` : ""}`;
      queueWebhookFailure(lead, error, response.status, "http_webhook");
      return {
        status: "queued",
        responseCode: response.status,
        error,
      };
    }

    return {
      status: "sent",
      responseCode: response.status,
    };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    queueWebhookFailure(lead, message, null, "http_webhook");
    return {
      status: "queued",
      error: message,
    };
  }
}

async function deliverLeadTelegram(lead) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_FORWARD_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams({
          chat_id: TELEGRAM_FORWARD_CHAT_ID,
          text: formatLeadNoteLine(lead),
        }),
        signal: AbortSignal.timeout(TELEGRAM_FORWARD_TIMEOUT_MS),
      }
    );

    const body = await response.text().catch(() => "");
    if (!response.ok || !/"ok"\s*:\s*true/.test(body)) {
      const error = `HTTP ${response.status}${body ? ` ${body.slice(0, 240)}` : ""}`;
      queueWebhookFailure(lead, error, response.status, "telegram");
      return {
        status: "queued",
        responseCode: response.status,
        error,
      };
    }

    return {
      status: "sent",
      responseCode: response.status,
    };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    queueWebhookFailure(lead, message, null, "telegram");
    return {
      status: "queued",
      error: message,
    };
  }
}

function queueWebhookFailure(lead, error, responseCode, destination = "unknown") {
  fs.appendFileSync(
    WEBHOOK_QUEUE_PATH,
    JSON.stringify({
      queued_at: new Date().toISOString(),
      destination,
      response_code: responseCode,
      error,
      lead,
    }) + "\n"
  );
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (res.__requestMethod === "HEAD") {
    res.end();
    return;
  }
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (res.__requestMethod === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function sendJavaScript(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (res.__requestMethod === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}
