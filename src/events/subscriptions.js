const { subscribe } = require("./subscriber");
const { USER_REGISTERED } = require("./eventTypes");
const { upsertByUserId } = require("../repositories/stylistProfileRepository");
const { upsertDefaultUserPreferences } = require("../repositories/userPreferenceRepository");

function displayNameFromEmail(email) {
  return String(email || "").split("@")[0] || null;
}

async function initializeUserProfile(payload) {
  await upsertDefaultUserPreferences({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  });

  if (payload.role === "stylist") {
    await upsertByUserId(payload.userId, {
      display_name: displayNameFromEmail(payload.email),
    });
  }
}

async function initSubscriptions() {
  if (!process.env.RABBITMQ_URL) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "event-subscriber",
      level: "WARN",
      message: "RABBITMQ_URL missing; shop subscriptions disabled",
    }));
    return;
  }

  await subscribe(USER_REGISTERED, "shop-service.users.registered", async (payload, ack, nack) => {
    try {
      await initializeUserProfile(payload);
      ack();
    } catch (error) {
      nack(error);
    }
  });
}

module.exports = { initSubscriptions };
