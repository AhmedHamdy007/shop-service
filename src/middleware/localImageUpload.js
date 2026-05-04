const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { LIMITS } = require("../lib/cloudinary");

const uploadDir = path.join(os.tmpdir(), "salon-platform-image-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${extension}`);
  },
});

const localImageUpload = multer({
  storage,
  limits: {
    fileSize: LIMITS.maxFileSizeMB * 1024 * 1024,
    files: 1,
  },
});

function cleanupTempFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, (error) => {
    if (error && error.code !== "ENOENT") {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: "shop-service",
        level: "ERROR",
        message: "Unable to remove temp upload file",
        path: file.path,
        error: error.message,
      }));
    }
  });
}

module.exports = {
  localImageUpload,
  cleanupTempFile,
};
