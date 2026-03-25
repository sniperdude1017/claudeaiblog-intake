const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3030;
const HOST = process.env.HOST || "127.0.0.1";
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
const ALLOW_LEAD_READS = process.env.ALLOW_LEAD_READS === "true";
const credentials = ensureCredentials();
const CSV_HEADER =
  "timestamp,name,phone,email,market,state,zip,segment,consent_source,owns_phone,phone_verification_status\n";

const segments = {
  "consumer-ca": {
    market: "California Consumer",
    state: "CA",
    title: "California Consumer Review Request",
  },
  "consumer-ga": {
    market: "Georgia Consumer",
    state: "GA",
    title: "Georgia Consumer Review Request",
  },
};

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  if (!isAuthorized(req)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Inbound Lead Intake"',
      "Cache-Control": "no-store",
    });
    res.end("Authentication required");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

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
      const lead = normalizeLead(payload);
      const leads = readLeads();
      leads.push(lead);
      writeLeads(leads);
      return sendJson(res, 201, {
        ok: true,
        count: leads.length,
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

  if (req.method === "GET" && url.pathname === "/") {
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

function serveFile(res, filePath) {
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendText(res, 404, "Not Found");
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(content);
  });
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

function normalizeLead(payload) {
  const segment = String(payload.segment || "").trim();
  const segmentConfig = segments[segment];
  if (!segmentConfig) {
    throw new Error("Invalid segment");
  }

  const name = cleanText(payload.name, 100);
  const email = cleanEmail(payload.email);
  const phone = cleanPhone(payload.phone);
  const zip = cleanZip(payload.zip);
  const consent = payload.consent === true;
  const ownsPhone = payload.ownsPhone === true;

  if (!name) throw new Error("Name is required");
  if (!email) throw new Error("Valid email is required");
  if (!phone) throw new Error("Valid phone is required");
  if (!zip) throw new Error("Valid ZIP code is required");
  if (!consent) throw new Error("Explicit consent is required");
  if (!ownsPhone) throw new Error("Phone ownership attestation is required");

  return {
    timestamp: new Date().toISOString(),
    name,
    phone,
    email,
    market: segmentConfig.market,
    state: segmentConfig.state,
    zip,
    segment,
    consent_source: segmentConfig.title,
    owns_phone: true,
    phone_verification_status: "self-attested",
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
      lead.name,
      lead.phone,
      lead.email,
      lead.market,
      lead.state,
      lead.zip,
      lead.segment,
      lead.consent_source,
      lead.owns_phone,
      lead.phone_verification_status,
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
    lines.push(
      `${lead.timestamp} | ${lead.name} | ${lead.phone} | ${lead.email} | ${lead.bank} | ${lead.state} | ZIP ${lead.zip}`
        .replace(`| undefined |`, `| ${lead.market} |`) +
        ` | phone ${lead.phone_verification_status}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}
