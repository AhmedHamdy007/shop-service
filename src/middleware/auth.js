const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const config = require("../config");

function readRequiredKey(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`JWT public key file not found at ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

const publicKey = readRequiredKey(config.jwtPublicKeyPath);
const AUTH_LOOKUP_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_LOOKUP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCurrentUser(req) {
  const upstream = await fetchWithTimeout(`${config.authServiceUrl}/users/me`, {
    method: "GET",
    headers: {
      authorization: req.headers.authorization || "",
      "x-request-id": req.id || "",
    },
  });

  if (upstream.status !== 200) return null;
  const body = await upstream.json();
  return body?.data || null;
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Missing bearer token",
      request_id: req.id,
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    });
    req.auth = payload;
    req.user = {
      id: payload.sub,
      role: payload.role || null,
    };
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired token",
      request_id: req.id,
    });
  }
}

function requireOwner(req, res, next) {
  return (async () => {
    if (!req.auth || !req.auth.sub) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        request_id: req.id,
      });
    }

    const user = await fetchCurrentUser(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Unable to verify user role",
        request_id: req.id,
      });
    }

    if (req.auth.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "Owner role required",
        request_id: req.id,
      });
    }

    req.user = { ...user, role: req.auth.role || null };
    return next();
  })().catch(() =>
    res.status(503).json({
      success: false,
      error: "Auth service unavailable for role check",
      request_id: req.id,
    })
  );
}

function requireStylist(req, res, next) {
  return (async () => {
    if (!req.auth || !req.auth.sub) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        request_id: req.id,
      });
    }

    const user = await fetchCurrentUser(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Unable to verify user role",
        request_id: req.id,
      });
    }

    if (req.auth.role !== "stylist") {
      return res.status(403).json({
        success: false,
        error: "Stylist role required",
        request_id: req.id,
      });
    }

    req.user = { ...user, role: req.auth.role || null };
    return next();
  })().catch(() =>
    res.status(503).json({
      success: false,
      error: "Auth service unavailable for role check",
      request_id: req.id,
    })
  );
}

function requireCustomer(req, res, next) {
  return (async () => {
    if (!req.auth || !req.auth.sub) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        request_id: req.id,
      });
    }

    const user = await fetchCurrentUser(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Unable to verify user role",
        request_id: req.id,
      });
    }

    if (req.auth.role !== "customer") {
      req.logger?.warn("Forbidden request blocked by shop-service RBAC", {
        request_id: req.id,
        user_id: user.id,
        role: req.auth.role || null,
        allowed_roles: ["customer"],
        method: req.method,
        path: req.originalUrl,
      });
      return res.status(403).json({
        success: false,
        error: "Access denied: insufficient role",
        request_id: req.id,
      });
    }

    req.user = { ...user, role: req.auth.role || null };
    return next();
  })().catch(() =>
    res.status(503).json({
      success: false,
      error: "Auth service unavailable for role check",
      request_id: req.id,
    })
  );
}

module.exports = { requireAuth, requireOwner, requireStylist, requireCustomer };
