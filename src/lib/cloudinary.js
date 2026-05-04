const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

const FOLDERS = {
  avatars: "salon-platform/avatars",
  portfolio: "salon-platform/portfolio",
  salonCover: "salon-platform/covers",
};

const LIMITS = {
  maxPortfolioPhotos: 30,
  maxFileSizeMB: 10,
  allowedFormats: ["jpg", "jpeg", "png", "webp"],
  avatar: {
    width: 400,
    height: 400,
    crop: "fill",
    gravity: "face",
  },
  portfolio: {
    width: 1400,
    height: 1400,
    crop: "limit",
  },
  cover: {
    width: 1920,
    height: 1920,
    crop: "limit",
  },
};

const CATEGORY_VALUES = new Set(["cut", "colour", "texture", "beard", "other"]);
const MIME_FORMATS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function normalizePublicIdPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown";
}

function getFilePath(file) {
  if (typeof file === "string") return file;
  return file?.path || file?.filepath || null;
}

function getExtension(file) {
  const mimetype = typeof file === "object" ? file.mimetype : null;
  if (mimetype && MIME_FORMATS[mimetype]) return MIME_FORMATS[mimetype];

  const source = typeof file === "object" ? file.originalname || file.path : file;
  return path.extname(String(source || "")).replace(/^\./, "").toLowerCase();
}

function getFileSize(file) {
  if (typeof file === "object" && Number.isFinite(file.size)) return file.size;
  const filePath = getFilePath(file);
  if (!filePath) return 0;
  return fs.statSync(filePath).size;
}

function readFileHeader(file) {
  const filePath = getFilePath(file);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(12);
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function matchesImageSignature(file) {
  const header = readFileHeader(file);
  if (!header || header.length < 12) return false;
  const extension = getExtension(file);
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;
  const isWebp =
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP";

  if (extension === "jpg" || extension === "jpeg") return isJpeg;
  if (extension === "png") return isPng;
  if (extension === "webp") return isWebp;
  return false;
}

function assertCloudinaryConfig() {
  const missing = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter(
    (name) => !process.env[name]
  );
  if (missing.length) {
    throw new Error(`Cloudinary is not configured: ${missing.join(", ")}`);
  }
}

function normalizeCategory(category) {
  const normalized = String(category || "other").trim().toLowerCase();
  return CATEGORY_VALUES.has(normalized) ? normalized : "other";
}

async function uploadAvatar(filePath, userId, role) {
  assertCloudinaryConfig();
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: `${FOLDERS.avatars}/${normalizePublicIdPart(role)}_${normalizePublicIdPart(userId)}`,
    overwrite: true,
    invalidate: true,
    resource_type: "image",
    allowed_formats: LIMITS.allowedFormats,
    transformation: [{ ...LIMITS.avatar, quality: "auto", fetch_format: "auto" }],
  });

  return { url: result.secure_url, publicId: result.public_id };
}

async function deleteImage(publicId) {
  if (publicId === null || publicId === undefined || String(publicId).trim() === "") {
    return null;
  }

  assertCloudinaryConfig();
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });

  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error(`Cloudinary delete failed: ${publicId}`);
  }

  return result;
}

async function uploadPortfolioPhoto(filePath, stylistId, caption, category) {
  assertCloudinaryConfig();
  const photoId = crypto.randomUUID();
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `${FOLDERS.portfolio}/stylist_${normalizePublicIdPart(stylistId)}`,
    public_id: photoId,
    resource_type: "image",
    allowed_formats: LIMITS.allowedFormats,
    transformation: [{ ...LIMITS.portfolio, quality: "auto", fetch_format: "auto" }],
  });

  return {
    id: photoId,
    url: result.secure_url,
    publicId: result.public_id,
    caption: caption || "",
    category: normalizeCategory(category),
    order: 0,
    uploadedAt: new Date(),
  };
}

async function deletePortfolioPhoto(publicId) {
  return deleteImage(publicId);
}

async function replacePortfolioPhoto(filePath, stylistId, oldPublicId) {
  assertCloudinaryConfig();
  const photoId = crypto.randomUUID();
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `${FOLDERS.portfolio}/stylist_${normalizePublicIdPart(stylistId)}`,
    public_id: photoId,
    resource_type: "image",
    allowed_formats: LIMITS.allowedFormats,
    transformation: [{ ...LIMITS.portfolio, quality: "auto", fetch_format: "auto" }],
  });

  await deleteImage(oldPublicId);
  return { url: result.secure_url, publicId: result.public_id };
}

async function uploadSalonCover(filePath, ownerId) {
  assertCloudinaryConfig();
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: `${FOLDERS.salonCover}/owner_${normalizePublicIdPart(ownerId)}`,
    overwrite: true,
    invalidate: true,
    resource_type: "image",
    allowed_formats: LIMITS.allowedFormats,
    transformation: [{ ...LIMITS.cover, quality: "auto", fetch_format: "auto" }],
  });

  return { url: result.secure_url, publicId: result.public_id };
}

async function deleteEntirePortfolio(stylistId) {
  assertCloudinaryConfig();
  return cloudinary.api.delete_resources_by_prefix(
    `${FOLDERS.portfolio}/stylist_${normalizePublicIdPart(stylistId)}`,
    { resource_type: "image", invalidate: true }
  );
}

function validateImageFile(file) {
  if (!file) throw new Error("Image file is required");
  const maxBytes = LIMITS.maxFileSizeMB * 1024 * 1024;
  if (getFileSize(file) > maxBytes) {
    throw new Error("File exceeds 10MB limit");
  }

  const extension = getExtension(file);
  if (!LIMITS.allowedFormats.includes(extension)) {
    throw new Error("Invalid file format. Use JPG, PNG, or WEBP");
  }

  if (getFilePath(file) && !matchesImageSignature(file)) {
    throw new Error("Invalid file format. Use JPG, PNG, or WEBP");
  }

  return true;
}

function getNextPortfolioOrder(portfolioArray) {
  if (!Array.isArray(portfolioArray) || portfolioArray.length === 0) return 1;
  const highest = portfolioArray.reduce((max, item) => {
    const value = Number.parseInt(item?.order ?? item?.displayOrder ?? 0, 10);
    return Number.isInteger(value) && value > max ? value : max;
  }, 0);
  return highest + 1;
}

module.exports = {
  FOLDERS,
  LIMITS,
  uploadAvatar,
  deleteImage,
  uploadPortfolioPhoto,
  deletePortfolioPhoto,
  replacePortfolioPhoto,
  uploadSalonCover,
  deleteEntirePortfolio,
  validateImageFile,
  getNextPortfolioOrder,
  normalizeCategory,
};
