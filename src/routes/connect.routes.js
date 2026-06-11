const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  clearConnectAccountByStripeAccountId,
  findConnectAccountByStripeAccountId,
  findConnectAccountForPrincipal,
  findStylistConnectAccount,
  updateConnectAccountByStripeAccountId,
  updateConnectAccountForPrincipal,
} = require("../repositories/connectRepository");

const router = express.Router();

function roleAllowed(role) {
  return role === "stylist" || role === "owner";
}

function currentRole(req) {
  return req.auth?.role || req.user?.role;
}

function booleanOrFalse(value) {
  return value === true || value === "true";
}

function connectResponse(account) {
  if (!account) {
    return {
      stripeAccountId: null,
      stripeOnboardingDone: false,
      payoutsEnabled: false,
      chargesEnabled: false,
    };
  }
  return {
    role: account.role,
    userId: account.userId,
    shopId: account.shopId,
    stripeAccountId: account.stripeAccountId,
    stripeOnboardingDone: account.stripeOnboardingDone,
    payoutsEnabled: account.payoutsEnabled,
    chargesEnabled: account.chargesEnabled,
  };
}

router.get("/internal/connect/account", requireAuth, async (req, res) => {
  const role = currentRole(req);
  if (!roleAllowed(role)) {
    return res.status(403).json({
      success: false,
      error: "Stylist or owner role required",
      request_id: req.id,
    });
  }

  const account = await findConnectAccountForPrincipal({
    userId: req.auth.sub,
    role,
  });

  return res.json({
    success: true,
    data: connectResponse(account),
    request_id: req.id,
  });
});

router.put("/internal/connect/account", requireAuth, async (req, res) => {
  const role = currentRole(req);
  if (!roleAllowed(role)) {
    return res.status(403).json({
      success: false,
      error: "Stylist or owner role required",
      request_id: req.id,
    });
  }

  const updated = await updateConnectAccountForPrincipal({
    userId: req.auth.sub,
    role,
    patch: {
      stripe_account_id:
        req.body.stripeAccountId === undefined ? undefined : req.body.stripeAccountId,
      stripe_onboarding_done:
        req.body.stripeOnboardingDone === undefined
          ? undefined
          : booleanOrFalse(req.body.stripeOnboardingDone),
      payouts_enabled:
        req.body.payoutsEnabled === undefined ? undefined : booleanOrFalse(req.body.payoutsEnabled),
      charges_enabled:
        req.body.chargesEnabled === undefined ? undefined : booleanOrFalse(req.body.chargesEnabled),
    },
  });

  if (!updated) {
    return res.status(404).json({
      success: false,
      error: role === "owner" ? "Active shop not found" : "Stylist profile not found",
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: connectResponse(updated),
    request_id: req.id,
  });
});

router.get("/internal/connect/stylists/:stylistId", async (req, res) => {
  const account = await findStylistConnectAccount(req.params.stylistId);
  if (!account || !account.stripeAccountId) {
    return res.status(404).json({
      success: false,
      error: "Stylist payment account not found",
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: connectResponse(account),
    request_id: req.id,
  });
});

router.get("/internal/connect/accounts/:stripeAccountId", async (req, res) => {
  const account = await findConnectAccountByStripeAccountId(req.params.stripeAccountId);
  if (!account) {
    return res.status(404).json({
      success: false,
      error: "Stripe account not found",
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: connectResponse(account),
    request_id: req.id,
  });
});

router.patch("/internal/connect/accounts/:stripeAccountId/status", async (req, res) => {
  const updated = await updateConnectAccountByStripeAccountId(req.params.stripeAccountId, {
    payoutsEnabled: booleanOrFalse(req.body.payoutsEnabled),
    chargesEnabled: booleanOrFalse(req.body.chargesEnabled),
    stripeOnboardingDone: booleanOrFalse(req.body.stripeOnboardingDone),
  });

  if (!updated) {
    return res.status(404).json({
      success: false,
      error: "Stripe account not found",
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: connectResponse(updated),
    request_id: req.id,
  });
});

router.post("/internal/connect/accounts/:stripeAccountId/deauthorize", async (req, res) => {
  const updated = await clearConnectAccountByStripeAccountId(req.params.stripeAccountId);
  if (!updated) {
    return res.status(404).json({
      success: false,
      error: "Stripe account not found",
      request_id: req.id,
    });
  }

  req.logger?.warn("Stripe Connect account deauthorized", {
    request_id: req.id,
    stripe_account_id: req.params.stripeAccountId,
    user_id: updated.userId,
    role: updated.role,
  });

  return res.json({
    success: true,
    data: connectResponse(updated),
    request_id: req.id,
  });
});

module.exports = router;
