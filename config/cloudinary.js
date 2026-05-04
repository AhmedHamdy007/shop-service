const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_PURPOSES = new Set([
  "general",
  "portfolio",
  "profile",
  "shop-cover",
  "review",
]);
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedFormats = ["jpg", "jpeg", "png", "webp"];

function normalizePublicIdPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown";
}

function normalizeUploadPurpose(value) {
  const normalized = String(value || "general").trim().toLowerCase();
  return ALLOWED_UPLOAD_PURPOSES.has(normalized) ? normalized : "general";
}

function getMissingCloudinaryConfig() {
  return ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter(
    (name) => !process.env[name]
  );
}

function isAllowedImageBuffer(file) {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isWebp =
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  if (file.mimetype === "image/jpeg") return isJpeg;
  if (file.mimetype === "image/png") return isPng;
  if (file.mimetype === "image/webp") return isWebp;
  return false;
}

function buildUploadOptions(req) {
  const purpose = normalizeUploadPurpose(req.body?.purpose);
  const uploader = normalizePublicIdPart(req.auth?.sub);
  const uniqueSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  return {
    folder: `salon-platform/${purpose}`,
    allowed_formats: allowedFormats,
    resource_type: "image",
    overwrite: false,
    unique_filename: false,
    use_filename: false,
    transformation: [
      {
        crop: "limit",
        width: 2000,
      },
    ],
    public_id: `${uploader}_${Date.now()}_${uniqueSuffix}`,
    context: {
      upload_purpose: purpose,
      ...(req.id ? { request_id: req.id } : {}),
    },
  };
}

function uploadImageBuffer(file, req) {
  const error = new Error("Generic image uploads are disabled. Use the role-specific image endpoints.");
  error.code = "GENERIC_UPLOAD_DISABLED";
  return Promise.reject(error);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    const error = new Error("Only JPEG, PNG, and WebP images are allowed.");
    error.code = "INVALID_FILE_TYPE";
    cb(error, false);
  },
});

module.exports = {
  cloudinary,
  upload,
  uploadImageBuffer,
  isAllowedImageBuffer,
  normalizeUploadPurpose,
  MAX_IMAGE_SIZE_BYTES,
};
