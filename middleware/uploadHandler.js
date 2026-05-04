const multer = require("multer");
const { upload, uploadImageBuffer } = require("../config/cloudinary");

function uploadHandler(req, res, next) {
  upload.single("image")(req, res, async (err) => {
    if (!err) {
      if (!req.file) {
        next();
        return;
      }

      try {
        const result = await uploadImageBuffer(req.file, req);
        req.file = {
          ...req.file,
          path: result.secure_url,
          filename: result.public_id,
          public_id: result.public_id,
          secure_url: result.secure_url,
          url: result.secure_url,
          cloudinary: result,
        };
      } catch (error) {
        return handleUploadProviderError(error, req, res, next);
      }

      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          error: "File too large. Max size is 5MB.",
          request_id: req.id,
        });
      }

      if (err.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          success: false,
          error: "Only 1 file allowed per upload.",
          request_id: req.id,
        });
      }

      return res.status(400).json({
        success: false,
        error: err.message,
        request_id: req.id,
      });
    }

    if (err.code === "INVALID_FILE_TYPE") {
      return res.status(400).json({
        success: false,
        error: err.message,
        request_id: req.id,
      });
    }

    next(err);
  });
}

function handleUploadProviderError(error, req, res, next) {
  if (error.code === "INVALID_IMAGE_CONTENT") {
    return res.status(400).json({
      success: false,
      error: error.message,
      request_id: req.id,
    });
  }

  if (error.code === "CLOUDINARY_CONFIG_MISSING") {
    req.logger?.error("Cloudinary configuration missing", {
      request_id: req.id,
      missingConfig: error.missingConfig,
    });
    return res.status(503).json({
      success: false,
      error: "Image uploads are not configured.",
      request_id: req.id,
    });
  }

  if (Number.isInteger(error.http_code) && error.http_code >= 400 && error.http_code < 500) {
    return res.status(400).json({
      success: false,
      error: "Image upload was rejected by the media provider.",
      request_id: req.id,
    });
  }

  if (Number.isInteger(error.http_code) && error.http_code >= 500) {
    return res.status(502).json({
      success: false,
      error: "Image upload provider is unavailable.",
      request_id: req.id,
    });
  }

  return next(error);
}

module.exports = uploadHandler;
