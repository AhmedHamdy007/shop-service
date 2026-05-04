const { ValidationError } = require("../utils/validation");

function errorHandler(err, req, res, next) {
  req.logger?.error("Shop request failed", {
    request_id: req.id,
    method: req.method,
    path: req.path,
    error: err.message,
  });

  if (err instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      error: err.message,
      field: err.field,
      request_id: req.id,
    });
  }

  if (err.code === "23505") {
    if (err.constraint === "uq_shop_staff_single_active_stylist") {
      return res.status(409).json({
        success: false,
        error: "Stylist already belongs to another active shop",
        request_id: req.id,
      });
    }

    return res.status(409).json({
      success: false,
      error: "Duplicate value violates unique constraint",
      request_id: req.id,
    });
  }

  if (err.code === "22P02") {
    return res.status(400).json({
      success: false,
      error: "Invalid identifier format",
      request_id: req.id,
    });
  }

  return res.status(500).json({
    success: false,
    error: "Internal server error",
    request_id: req.id,
  });
}

module.exports = errorHandler;
