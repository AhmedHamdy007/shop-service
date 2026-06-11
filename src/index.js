require("express-async-errors");

const express = require("express");
const cors = require("cors");

const config = require("./config");
const {
  createCorsOptions,
  securityHeadersMiddleware,
} = require("../../shared/http/httpSecurity");
const { Logger } = require("./utils/logger");
const requestContext = require("./middleware/requestContext");
const imageRoutes = require("./routes/image.routes");
const connectRoutes = require("./routes/connect.routes");
const shopRoutes = require("./routes/shop.routes");
const stylistRoutes = require("./routes/stylist.routes");
const errorHandler = require("./middleware/errorHandler");
const { initSubscriptions } = require("./events/subscriptions");
const { pool } = require("./db/pool");

const logger = new Logger("shop-service", config.logLevel);
const app = express();
const corsOptions = createCorsOptions({
  nodeEnv: config.nodeEnv,
  corsAllowedOrigins: config.corsAllowedOrigins,
  allowedMethods: ["GET", "POST", "PATCH", "DELETE"],
});

app.use(securityHeadersMiddleware);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(requestContext(logger));
app.use(imageRoutes);
app.use(connectRoutes);
app.use(shopRoutes);
app.use(stylistRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
    request_id: req.id,
  });
});

app.use(errorHandler);

const server = app.listen(config.port, async () => {
  logger.info("Shop service started", {
    port: config.port,
    nodeEnv: config.nodeEnv,
  });
  try {
    await initSubscriptions();
    logger.info("Event subscriptions initialized");
  } catch (error) {
    logger.error("Failed to initialize event subscriptions", { error: error.message });
    process.exit(1);
  }
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("Shutdown signal received", { signal });
  const forceExitTimer = setTimeout(() => {
    logger.error("Forcing shutdown after timeout", { signal });
    process.exit(1);
  }, 10000);
  forceExitTimer.unref?.();

  server.close(async () => {
    try {
      await pool.end();
      logger.info("Database pool closed");
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown", { error: error.message });
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
