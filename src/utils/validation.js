class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

const { isValidServiceCatalogKey } = require("../catalog/serviceCatalog");

const STAFF_LEVELS = ["stylist", "senior_stylist"];
const STAFF_STATUSES = ["active", "inactive"];

function validateString(name, value, { required = false, maxLength = 255 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`${name} is required`, name);
    return null;
  }

  if (typeof value !== "string") {
    throw new ValidationError(`${name} must be a string`, name);
  }

  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw new ValidationError(`${name} is required`, name);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${name} exceeds max length ${maxLength}`, name);
  }
  return trimmed;
}

function validateOptionalString(name, value, { maxLength = 255 } = {}) {
  return validateString(name, value, { required: false, maxLength });
}

function validatePrice(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new ValidationError("price must be a non-negative number", "price");
  }
  return Number(value.toFixed(2));
}

function validateEmail(value) {
  const email = validateString("email", value, { required: true, maxLength: 255 })?.toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
  if (!valid) throw new ValidationError("email is invalid", "email");
  return email;
}

function validateStaffLevel(value) {
  if (!value || typeof value !== "string") {
    throw new ValidationError("staffLevel is required", "staffLevel");
  }
  const normalized = value.trim().toLowerCase();
  if (!STAFF_LEVELS.includes(normalized)) {
    throw new ValidationError(`staffLevel must be one of: ${STAFF_LEVELS.join(", ")}`, "staffLevel");
  }
  return normalized;
}

function validateStaffStatus(value) {
  if (!value || typeof value !== "string") {
    throw new ValidationError("status is required", "status");
  }
  const normalized = value.trim().toLowerCase();
  if (!STAFF_STATUSES.includes(normalized)) {
    throw new ValidationError(`status must be one of: ${STAFF_STATUSES.join(", ")}`, "status");
  }
  return normalized;
}

function validateInviteToken(value) {
  const token = validateString("token", value, { required: true, maxLength: 255 });
  if (!token || token.length < 20) {
    throw new ValidationError("token is invalid", "token");
  }
  return token;
}

function validateUrl(value, field = "url") {
  const raw = validateString(field, value, { required: true, maxLength: 2000 });
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("invalid protocol");
    }
    return raw;
  } catch {
    throw new ValidationError(`${field} must be a valid http/https URL`, field);
  }
}

function validateImageSource(value, field = "imageUrl") {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, field);
  }

  const trimmed = value.trim();
  if (trimmed.length > 3000000) {
    throw new ValidationError(`${field} exceeds max length`, field);
  }

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(trimmed)) {
    return trimmed;
  }

  return validateUrl(trimmed, field);
}

function validateMediaUrls(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("mediaUrls must be a non-empty array", "mediaUrls");
  }
  if (value.length > 10) {
    throw new ValidationError("mediaUrls cannot exceed 10 items", "mediaUrls");
  }
  return value.map((url, index) => validateUrl(url, `mediaUrls[${index}]`));
}

function validateOptionalNumber(name, value, { min = 0, max = 100000 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ValidationError(`${name} must be a number`, name);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}`, name);
  }
  return value;
}

function validateOptionalInteger(name, value, { min = 0, max = 32767 } = {}) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${name} must be an integer`, name);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}`, name);
  }
  return value;
}

function validateRequiredInteger(name, value, { min = 0, max = 32767 } = {}) {
  const normalized = validateOptionalInteger(name, value, { min, max });
  if (normalized === null) {
    throw new ValidationError(`${name} is required`, name);
  }
  return normalized;
}

function validateOptionalMediaUrls(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("photoUrls must be an array", "photoUrls");
  }
  if (value.length === 0) return [];
  if (value.length > 10) {
    throw new ValidationError("photoUrls cannot exceed 10 items", "photoUrls");
  }
  return value.map((url, index) => validateImageSource(url, `photoUrls[${index}]`));
}

function validateOptionalBoolean(name, value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new ValidationError(`${name} must be a boolean`, name);
  }
  return value;
}

function validateDuration(value) {
  if (!Number.isInteger(value) || value < 5 || value > 480) {
    throw new ValidationError("durationMinutes must be an integer between 5 and 480", "durationMinutes");
  }
  return value;
}

function validateCatalogServiceKey(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new ValidationError("catalogServiceKey is required", "catalogServiceKey");
    }
    return null;
  }

  if (typeof value !== "string") {
    throw new ValidationError("catalogServiceKey must be a string", "catalogServiceKey");
  }

  const normalized = value.trim().toLowerCase();
  if (!isValidServiceCatalogKey(normalized)) {
    throw new ValidationError("catalogServiceKey is not supported", "catalogServiceKey");
  }

  return normalized;
}

function normalizeShopPayload(body) {
  return {
    name: validateString("name", body.name, { required: true, maxLength: 160 }),
    slug: validateString("slug", body.slug, { required: true, maxLength: 180 })?.toLowerCase(),
    addressLine1: validateString("addressLine1", body.addressLine1, { required: true, maxLength: 255 }),
    city: validateString("city", body.city, { required: true, maxLength: 120 }),
    country: validateString("country", body.country, { required: true, maxLength: 120 }),
    phone: validateString("phone", body.phone, { required: false, maxLength: 30 }),
    email: validateString("email", body.email, { required: false, maxLength: 255 }),
    description: validateString("description", body.description, { required: false, maxLength: 2000 }),
    imageUrl: validateImageSource(body.imageUrl, "imageUrl"),
  };
}

function normalizeServicePayload(body) {
  return {
    catalogServiceKey: validateCatalogServiceKey(body.catalogServiceKey, { required: false }),
    name: validateString("name", body.name, { required: true, maxLength: 140 }),
    description: validateString("description", body.description, { required: false, maxLength: 1000 }),
    category: validateString("category", body.category, { required: false, maxLength: 80 }),
    durationMinutes: validateDuration(body.durationMinutes),
    price: validatePrice(body.price),
  };
}

module.exports = {
  ValidationError,
  validateEmail,
  validateStaffLevel,
  validateStaffStatus,
  validateInviteToken,
  validateMediaUrls,
  validateImageSource,
  validateOptionalBoolean,
  validateOptionalNumber,
  validateOptionalInteger,
  validateRequiredInteger,
  validateOptionalMediaUrls,
  validateOptionalString,
  validateCatalogServiceKey,
  normalizeShopPayload,
  normalizeServicePayload,
};
