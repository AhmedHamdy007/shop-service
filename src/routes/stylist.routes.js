const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const { requireAuth, requireOwner, requireStylist } = require("../middleware/auth");
const {
  validateStaffLevel,
  ValidationError,
  validateStaffStatus,
  validateEmail,
  validateInviteToken,
  validateImageSource,
  validateMediaUrls,
  validateOptionalBoolean,
  validateOptionalNumber,
  validateOptionalInteger,
  validateOptionalString,
  normalizePayoutProfilePayload,
  normalizeServicePayload,
} = require("../utils/validation");
const { encrypt } = require("../utils/encryption");
const { findShopById } = require("../repositories/shopRepository");
const { createService, findServiceById, updateServiceById } = require("../repositories/serviceRepository");
const {
  listStaffByShop,
  listActiveStylistsByShop,
  findStaffById,
  findStaffByShopAndUser,
  findActiveMembershipByUser,
  createStaffMembership,
  updateStaffById,
  listShopsForStylist,
} = require("../repositories/staffRepository");
const {
  createInvite,
  listInvitesByShop,
  findActiveInviteByShopAndEmail,
  findInviteById,
  findActiveInviteByToken,
  listActiveInvitesByEmail,
  markInviteAccepted,
  revokeInvite,
  rejectInvite,
} = require("../repositories/inviteRepository");
const {
  getByUserId,
  getPublicProfileByIdentifier,
  listPublicProfiles,
  listPublicProfilesByShopId,
  listProfilesByUserIds,
  searchProfilesForInvite,
  upsertByUserId,
} = require("../repositories/stylistProfileRepository");
const {
  createPayoutProfile,
  findPayoutProfileByStylistId,
  updatePayoutProfileByStylistId,
} = require("../repositories/payoutProfileRepository");
const {
  listByStylist,
  findById,
  createPost,
  updatePost,
  replaceMedia,
  deletePost,
} = require("../repositories/portfolioRepository");
const {
  upsertOffering,
  listByShopAndStylist,
  findActiveOfferingByShopStylistAndService,
  deactivate,
} = require("../repositories/offeringRepository");
const { listReviewsByStylist } = require("../repositories/reviewRepository");

const router = express.Router();
const INTER_SERVICE_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTER_SERVICE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAuthJson(req, targetPath) {
  const upstream = await fetchWithTimeout(`${config.authServiceUrl}${targetPath}`, {
    method: "GET",
    headers: {
      authorization: req.headers.authorization || "",
      "x-request-id": req.id || "",
    },
  });

  const body = await upstream.json().catch(() => ({}));
  return { status: upstream.status, body };
}

function parseListLimit(rawValue) {
  if (rawValue === undefined) return 20;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ValidationError("limit must be an integer between 1 and 100", "limit");
  }
  return parsed;
}

function sameUserId(a, b) {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return String(a) === String(b);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function encryptionError(error) {
  if (String(error?.message || "").includes("PAYOUT_ENCRYPTION_KEY")) {
    return httpError(503, "Payout encryption is not configured");
  }
  return error;
}

function payoutProfileResponse(profile) {
  if (!profile) return null;
  return {
    bankName: profile.bankName,
    accountName: profile.accountName,
    accountNumberMasked: profile.accountNumberMasked,
    isVerified: profile.isVerified,
  };
}

async function upsertStripePayoutAccount(req, payload, existingProfile) {
  const upstream = await fetchWithTimeout(`${config.bookingServiceUrl}/internal/connect/stylist-accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: req.headers.authorization || "",
      "x-request-id": req.id || "",
    },
    body: JSON.stringify({
      bankName: payload.bankName,
      accountNumber: payload.accountNumber,
      accountName: payload.accountName,
      icNumber: payload.icNumber,
      existingStripeAccountId: existingProfile?.stripeAccountId || null,
      ipAddress: req.ip,
    }),
  });

  const body = await upstream.json().catch(() => ({}));
  if (upstream.status !== 200 || !body?.data?.stripeAccountId) {
    throw httpError(
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 503,
      body?.error || body?.message || "Unable to register payout account"
    );
  }
  return body.data;
}

async function getOwnedShopOrRespond(req, res) {
  const shop = await findShopById(req.params.id);
  if (!shop || !shop.isActive) {
    res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
    return null;
  }
  if (!sameUserId(shop.ownerUserId, req.auth.sub)) {
    res.status(403).json({
      success: false,
      error: "You can only manage your own shop",
      request_id: req.id,
    });
    return null;
  }
  return shop;
}

async function acceptInviteForCurrentStylist(req, res, invite, { createdStatus = 201 } = {}) {
  if (!invite) {
    res.status(404).json({
      success: false,
      error: "Invite not found or expired",
      request_id: req.id,
    });
    return null;
  }

  if (!req.user?.email || req.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    res.status(403).json({
      success: false,
      error: "Invite email does not match current stylist",
      request_id: req.id,
    });
    return null;
  }

  const activeMembership = await findActiveMembershipByUser(req.auth.sub);
  if (activeMembership && activeMembership.shopId !== invite.shopId) {
    res.status(409).json({
      success: false,
      error: "Stylist already belongs to another active shop",
      request_id: req.id,
    });
    return null;
  }

  const currentMembership = await findStaffByShopAndUser(invite.shopId, req.auth.sub);
  if (currentMembership && currentMembership.status === "active") {
    await markInviteAccepted(invite.id);
    res.json({
      success: true,
      data: currentMembership,
      request_id: req.id,
    });
    return currentMembership;
  }

  let membership;
  if (currentMembership) {
    membership = await updateStaffById(currentMembership.id, {
      status: "active",
      staff_level: invite.staffLevel,
    });
  } else {
    membership = await createStaffMembership({
      shopId: invite.shopId,
      userId: req.auth.sub,
      staffLevel: invite.staffLevel,
    });
  }

  await markInviteAccepted(invite.id);
  res.status(createdStatus).json({
    success: true,
    data: membership,
    request_id: req.id,
  });
  return membership;
}

// Owner: list stylists in a shop
router.get("/shops/:id/stylists", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;

  const staff = await listActiveStylistsByShop(shop.id);
  return res.json({
    success: true,
    count: staff.length,
    data: staff,
    request_id: req.id,
  });
});

router.get("/shops/:id/staff", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;

  const staff = await listStaffByShop(shop.id);
  return res.json({
    success: true,
    count: staff.length,
    data: staff,
    request_id: req.id,
  });
});

router.post("/shops/:id/staff/invites", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;

  const email = validateEmail(req.body.email);
  const staffLevel = validateStaffLevel(req.body.staffLevel);
  const existingInvite = await findActiveInviteByShopAndEmail(shop.id, email);
  if (existingInvite) {
    return res.status(409).json({
      success: false,
      error: "An active invite already exists for this email",
      request_id: req.id,
    });
  }

  const rawToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await createInvite({
    shopId: shop.id,
    email,
    staffLevel,
    token: rawToken,
    expiresAt,
  });

  return res.status(201).json({
    success: true,
    data: {
      ...invite,
      inviteToken: rawToken,
    },
    request_id: req.id,
  });
});

router.post("/shops/:id/staff/invites/by-user", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;

  const stylistUserId = validateOptionalString("stylistUserId", req.body.stylistUserId, {
    maxLength: 120,
  });
  if (!stylistUserId) {
    return res.status(400).json({
      success: false,
      error: "stylistUserId is required",
      request_id: req.id,
    });
  }

  const staffLevel = validateStaffLevel(req.body.staffLevel);
  const [contactResponse, existingMembership, activeMembership] = await Promise.all([
    fetchAuthJson(req, `/internal/users/${encodeURIComponent(stylistUserId)}/contact`),
    findStaffByShopAndUser(shop.id, stylistUserId),
    findActiveMembershipByUser(stylistUserId),
  ]);

  if (contactResponse.status !== 200 || !contactResponse.body?.data) {
    return res.status(contactResponse.status === 404 ? 404 : 503).json({
      success: false,
      error:
        contactResponse.body?.error || "Unable to resolve stylist identity for this invite",
      request_id: req.id,
    });
  }

  const stylistUser = contactResponse.body.data;
  if (stylistUser.role !== "stylist") {
    return res.status(400).json({
      success: false,
      error: "Selected user is not a stylist",
      request_id: req.id,
    });
  }

  if (existingMembership && existingMembership.status === "active") {
    return res.status(409).json({
      success: false,
      error: "This stylist already belongs to the shop",
      request_id: req.id,
    });
  }

  if (activeMembership && String(activeMembership.shopId) !== String(shop.id)) {
    return res.status(409).json({
      success: false,
      error: "This stylist already belongs to another active shop",
      request_id: req.id,
    });
  }

  const existingInvite = await findActiveInviteByShopAndEmail(shop.id, stylistUser.email);
  if (existingInvite) {
    return res.status(409).json({
      success: false,
      error: "An active invite already exists for this stylist",
      request_id: req.id,
    });
  }

  const rawToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await createInvite({
    shopId: shop.id,
    email: stylistUser.email,
    staffLevel,
    token: rawToken,
    expiresAt,
    invitedUserId: stylistUser.id,
  });

  return res.status(201).json({
    success: true,
    data: {
      ...invite,
      inviteToken: rawToken,
      stylist: {
        id: stylistUser.id,
        name: stylistUser.name,
      },
    },
    request_id: req.id,
  });
});

router.get("/shops/:id/staff/invites", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;
  const invites = await listInvitesByShop(shop.id);
  return res.json({
    success: true,
    count: invites.length,
    data: invites,
    request_id: req.id,
  });
});

router.post(
  "/shops/:id/staff/invites/:inviteId/revoke",
  requireAuth,
  requireOwner,
  async (req, res) => {
    const shop = await getOwnedShopOrRespond(req, res);
    if (!shop) return;

    const invite = await findInviteById(req.params.inviteId);
    if (!invite || invite.shopId !== shop.id) {
      return res.status(404).json({
        success: false,
        error: "Invite not found",
        request_id: req.id,
      });
    }

    const revoked = await revokeInvite(invite.id);
    return res.json({
      success: true,
      data: revoked,
      request_id: req.id,
    });
  }
);

router.patch("/shops/:id/staff/:staffId", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;
  const staff = await findStaffById(req.params.staffId);
  if (!staff || staff.shopId !== shop.id) {
    return res.status(404).json({
      success: false,
      error: "Staff member not found",
      request_id: req.id,
    });
  }

  const patch = {};
  if (req.body.staffLevel !== undefined) patch.staff_level = validateStaffLevel(req.body.staffLevel);
  if (req.body.status !== undefined) patch.status = validateStaffStatus(req.body.status);
  const updated = await updateStaffById(staff.id, patch);
  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

router.delete("/shops/:id/staff/:staffId", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;
  const staff = await findStaffById(req.params.staffId);
  if (!staff || staff.shopId !== shop.id) {
    return res.status(404).json({
      success: false,
      error: "Staff member not found",
      request_id: req.id,
    });
  }

  const updated = await updateStaffById(staff.id, { status: "inactive" });
  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

// Owner: assign service offerings to stylist
router.post("/shops/:id/stylists/:userId/services", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;

  const stylist = await findStaffByShopAndUser(shop.id, req.params.userId);
  if (!stylist || stylist.status !== "active") {
    return res.status(404).json({
      success: false,
      error: "Active stylist membership not found",
      request_id: req.id,
    });
  }

  const service = await findServiceById(req.body.serviceId);
  if (!service || service.shopId !== shop.id || !service.isActive) {
    return res.status(404).json({
      success: false,
      error: "Service not found",
      request_id: req.id,
    });
  }

  const customPrice = validateOptionalNumber("customPrice", req.body.customPrice, {
    min: 0,
    max: 100000,
  });
  const customDurationMinutes = validateOptionalInteger(
    "customDurationMinutes",
    req.body.customDurationMinutes,
    { min: 5, max: 480 }
  );

  const offering = await upsertOffering({
    shopId: shop.id,
    stylistUserId: stylist.userId,
    serviceId: service.id,
    customPrice,
    customDurationMinutes,
    isActive: true,
  });

  return res.status(201).json({
    success: true,
    data: offering,
    request_id: req.id,
  });
});

router.get("/shops/:id/stylists/:userId/services", requireAuth, requireOwner, async (req, res) => {
  const shop = await getOwnedShopOrRespond(req, res);
  if (!shop) return;
  const offerings = await listByShopAndStylist(shop.id, req.params.userId);
  return res.json({
    success: true,
    count: offerings.length,
    data: offerings,
    request_id: req.id,
  });
});

router.delete(
  "/shops/:id/stylists/:userId/services/:serviceId",
  requireAuth,
  requireOwner,
  async (req, res) => {
    const shop = await getOwnedShopOrRespond(req, res);
    if (!shop) return;
    const updated = await deactivate(shop.id, req.params.userId, req.params.serviceId);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Offering not found",
        request_id: req.id,
      });
    }
    return res.json({
      success: true,
      data: updated,
      request_id: req.id,
    });
  }
);

// Stylist self-service
router.get("/stylists/me/invites", requireAuth, requireStylist, async (req, res) => {
  const invites = await listActiveInvitesByEmail(req.user?.email || "");
  return res.json({
    success: true,
    count: invites.length,
    data: invites,
    request_id: req.id,
  });
});

router.post("/shops/invites/accept", requireAuth, requireStylist, async (req, res) => {
  const token = validateInviteToken(req.body.token);
  const invite = await findActiveInviteByToken(token);
  return acceptInviteForCurrentStylist(req, res, invite, { createdStatus: 201 });
});

router.post("/shops/invites/:inviteId/accept", requireAuth, requireStylist, async (req, res) => {
  const invite = await findInviteById(req.params.inviteId);
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.declinedAt) {
    return res.status(404).json({
      success: false,
      error: "Invite not found or expired",
      request_id: req.id,
    });
  }
  if (new Date(invite.expiresAt) <= new Date()) {
    return res.status(404).json({
      success: false,
      error: "Invite not found or expired",
      request_id: req.id,
    });
  }
  return acceptInviteForCurrentStylist(req, res, invite, { createdStatus: 200 });
});

router.post("/shops/invites/:inviteId/reject", requireAuth, requireStylist, async (req, res) => {
  const invite = await findInviteById(req.params.inviteId);
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.declinedAt) {
    return res.status(404).json({
      success: false,
      error: "Invite not found or expired",
      request_id: req.id,
    });
  }
  if (!req.user?.email || req.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return res.status(403).json({
      success: false,
      error: "Invite email does not match current stylist",
      request_id: req.id,
    });
  }

  const declined = await rejectInvite(invite.id);
  return res.json({
    success: true,
    data: declined,
    request_id: req.id,
  });
});

router.get("/stylists/me/shops", requireAuth, requireStylist, async (req, res) => {
  const shops = await listShopsForStylist(req.auth.sub);
  return res.json({
    success: true,
    count: shops.length,
    data: shops,
    request_id: req.id,
  });
});

router.get("/stylist/payout-profile", requireAuth, requireStylist, async (req, res, next) => {
  try {
    const profile = await findPayoutProfileByStylistId(req.auth.sub);
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Payout profile not found",
        request_id: req.id,
      });
    }

    return res.json({
      success: true,
      data: payoutProfileResponse(profile),
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/stylist/payout-profile", requireAuth, requireStylist, async (req, res, next) => {
  try {
    const payload = normalizePayoutProfilePayload(req.body || {});
    let accountNumberEnc;
    let icNumberEnc;
    try {
      accountNumberEnc = encrypt(payload.accountNumber);
      icNumberEnc = encrypt(payload.icNumber);
    } catch (error) {
      throw encryptionError(error);
    }

    const existingProfile = await findPayoutProfileByStylistId(req.auth.sub, {
      includeStripeAccountId: true,
    });
    const connectAccount = await upsertStripePayoutAccount(req, payload, existingProfile);

    await upsertByUserId(req.auth.sub, {});

    const commonPatch = {
      stripe_account_id: connectAccount.stripeAccountId,
      bank_name: payload.bankName,
      account_number_enc: accountNumberEnc,
      account_number_last4: payload.accountNumber.slice(-4),
      account_name: payload.accountName,
      ic_number_enc: icNumberEnc,
      is_verified: Boolean(connectAccount.isVerified),
    };

    const profile = existingProfile
      ? await updatePayoutProfileByStylistId(req.auth.sub, commonPatch)
      : await createPayoutProfile({
          stylistId: req.auth.sub,
          stripeAccountId: connectAccount.stripeAccountId,
          bankName: payload.bankName,
          accountNumberEnc,
          accountNumberLast4: payload.accountNumber.slice(-4),
          accountName: payload.accountName,
          icNumberEnc,
          isVerified: Boolean(connectAccount.isVerified),
        });

    return res.status(201).json({
      success: true,
      message: "Payout account registered successfully",
      data: {
        message: "Payout account registered successfully",
        ...payoutProfileResponse(profile),
      },
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/stylists/me/shops/:shopId/leave", requireAuth, requireStylist, async (req, res) => {
  const membership = await findStaffByShopAndUser(req.params.shopId, req.auth.sub);
  if (!membership || membership.status !== "active") {
    return res.status(404).json({
      success: false,
      error: "Active shop membership not found",
      request_id: req.id,
    });
  }

  const updated = await updateStaffById(membership.id, { status: "inactive" });
  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

async function getCurrentStylistShop(req, res) {
  const shops = await listShopsForStylist(req.auth.sub);
  const shop = shops[0];
  if (!shop) {
    res.status(404).json({
      success: false,
      error: "Join a shop before managing services",
      request_id: req.id,
    });
    return null;
  }
  return shop;
}

function serviceWithOffering(service, offering = null) {
  return {
    ...offering,
    serviceId: service.id,
    customPrice: null,
    customDurationMinutes: null,
    service,
  };
}

router.get("/stylists/me/services", requireAuth, requireStylist, async (req, res) => {
  const shop = await getCurrentStylistShop(req, res);
  if (!shop) return;
  const offerings = await listByShopAndStylist(shop.id, req.auth.sub);
  return res.json({
    success: true,
    count: offerings.length,
    data: offerings,
    request_id: req.id,
  });
});

router.post("/stylists/me/services", requireAuth, requireStylist, async (req, res) => {
  const shop = await getCurrentStylistShop(req, res);
  if (!shop) return;

  const payload = normalizeServicePayload(req.body);
  const created = await createService({
    shopId: shop.id,
    ...payload,
  });
  const offering = await upsertOffering({
    shopId: shop.id,
    stylistUserId: req.auth.sub,
    serviceId: created.id,
    isActive: true,
  });

  return res.status(201).json({
    success: true,
    data: serviceWithOffering(created, offering),
    request_id: req.id,
  });
});

router.patch("/stylists/me/services/:serviceId", requireAuth, requireStylist, async (req, res) => {
  const shop = await getCurrentStylistShop(req, res);
  if (!shop) return;

  const offering = await findActiveOfferingByShopStylistAndService(
    shop.id,
    req.auth.sub,
    req.params.serviceId
  );
  const existing = await findServiceById(req.params.serviceId);
  if (!offering || !existing || existing.shopId !== shop.id) {
    return res.status(404).json({
      success: false,
      error: "Service not found",
      request_id: req.id,
    });
  }

  const payload = normalizeServicePayload({
    ...existing,
    ...req.body,
    durationMinutes:
      req.body.durationMinutes === undefined ? existing.durationMinutes : req.body.durationMinutes,
    price: req.body.price === undefined ? existing.price : req.body.price,
  });
  const updated = await updateServiceById(existing.id, {
    name: payload.name,
    description: payload.description,
    category: payload.category,
    duration_minutes: payload.durationMinutes,
    price: payload.price,
    catalog_service_key: payload.catalogServiceKey,
  });

  return res.json({
    success: true,
    data: serviceWithOffering(updated, offering),
    request_id: req.id,
  });
});

router.delete("/stylists/me/services/:serviceId", requireAuth, requireStylist, async (req, res) => {
  const shop = await getCurrentStylistShop(req, res);
  if (!shop) return;

  const updated = await deactivate(shop.id, req.auth.sub, req.params.serviceId);
  if (!updated) {
    return res.status(404).json({
      success: false,
      error: "Service not found",
      request_id: req.id,
    });
  }
  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

router.get("/stylists/me/profile", requireAuth, requireStylist, async (req, res) => {
  const profile = await upsertByUserId(req.auth.sub, {});
  return res.json({
    success: true,
    data: profile,
    request_id: req.id,
  });
});

router.get("/stylists/search", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const q = validateOptionalString("q", req.query.q, { maxLength: 120 });
    const limit = parseListLimit(req.query.limit);
    const shopId = validateOptionalString("shopId", req.query.shopId, { maxLength: 120 });

    if (!q) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        request_id: req.id,
      });
    }

    const [authResponse, profileMatches] = await Promise.all([
      fetchAuthJson(
        req,
        `/users/search?role=stylist&q=${encodeURIComponent(q)}&limit=${limit}`
      ),
      searchProfilesForInvite({ q, limit, excludeActiveShopId: shopId }),
    ]);

    if (authResponse.status !== 200) {
      return res.status(authResponse.status === 403 ? 403 : 503).json({
        success: false,
        error: authResponse.body?.error || "Unable to search stylists right now",
        request_id: req.id,
      });
    }

    const users = authResponse.body?.data || [];
    const userProfiles = await listProfilesByUserIds(users.map((user) => user.id));
    const profilesByUserId = new Map(
      [...userProfiles, ...profileMatches].map((profile) => [String(profile.userId), profile])
    );
    const usersById = new Map(users.map((user) => [String(user.id), user]));
    const candidates = new Map();

    function addCandidate(userId) {
      const normalizedUserId = String(userId);
      if (!normalizedUserId || candidates.has(normalizedUserId)) return;
      const user = usersById.get(normalizedUserId);
      const profile = profilesByUserId.get(normalizedUserId);
      const activeShopId = profile?.shopId ? String(profile.shopId) : null;
      const alreadyActiveHere = Boolean(shopId && activeShopId && activeShopId === String(shopId));
      const alreadyActiveElsewhere = Boolean(shopId && activeShopId && activeShopId !== String(shopId));
      if (alreadyActiveHere) return;

      candidates.set(normalizedUserId, {
        id: normalizedUserId,
        name: profile?.displayName || user?.name || `Stylist ${normalizedUserId}`,
        role: user?.role || "stylist",
        profileImageUrl: profile?.profileImageUrl || null,
        isPublic: profile?.isPublic ?? false,
        shopId: profile?.shopId || null,
        shopName: profile?.shopName || null,
        staffLevel: profile?.staffLevel || null,
        availableForInvite: !alreadyActiveElsewhere,
        inviteMessage: alreadyActiveElsewhere
          ? `Already active at ${profile?.shopName || "another shop"}`
          : null,
      });
    }

    users.forEach((user) => addCandidate(user.id));
    profileMatches.forEach((profile) => addCandidate(profile.userId));

    const results = [...candidates.values()].slice(0, limit);

    return res.json({
      success: true,
      count: results.length,
      data: results,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/stylists", async (req, res, next) => {
  try {
    const filters = {
      q: req.query.q || null,
      city: req.query.city || null,
      shopId: req.query.shopId || null,
      staffLevel:
        req.query.staffLevel === undefined ? null : validateStaffLevel(req.query.staffLevel),
      sort: req.query.sort || "newest",
      limit: parseListLimit(req.query.limit),
    };
    if (req.query.serviceName !== undefined) {
      filters.serviceName = req.query.serviceName || null;
    }

    const stylists = await listPublicProfiles(filters);

    return res.json({
      success: true,
      count: stylists.length,
      data: stylists,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/shops/:id/stylists/public", async (req, res, next) => {
  try {
    const shop = await findShopById(req.params.id);
    if (!shop || !shop.isActive) {
      return res.status(404).json({
        success: false,
        error: "Shop not found",
        request_id: req.id,
      });
    }

    const stylists = await listPublicProfilesByShopId(shop.id, {
      limit: parseListLimit(req.query.limit),
    });

    return res.json({
      success: true,
      count: stylists.length,
      data: stylists,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/internal/stylists/:stylistId/payout-profile", async (req, res, next) => {
  try {
    const profile = await findPayoutProfileByStylistId(req.params.stylistId, {
      includeStripeAccountId: true,
    });
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Payout profile not found",
        request_id: req.id,
      });
    }

    return res.json({
      success: true,
      data: {
        stylistId: profile.stylistId,
        stripeAccountId: profile.stripeAccountId,
        isVerified: profile.isVerified,
      },
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/stylists/:userId/profile", async (req, res) => {
  const profile = await getPublicProfileByIdentifier(req.params.userId);
  if (!profile || !profile.isPublic) {
    return res.status(404).json({
      success: false,
      error: "Stylist profile not found",
      request_id: req.id,
    });
  }
  return res.json({
    success: true,
    data: profile,
    request_id: req.id,
  });
});

router.patch("/stylists/me/profile", requireAuth, requireStylist, async (req, res) => {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(req.body, "displayName")) {
    patch.display_name = validateOptionalString("displayName", req.body.displayName, {
      maxLength: 120,
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "bio")) {
    patch.bio = validateOptionalString("bio", req.body.bio, { maxLength: 4000 });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "specialties")) {
    patch.specialties = validateOptionalString("specialties", req.body.specialties, {
      maxLength: 1000,
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "yearsExperience")) {
    patch.years_experience = validateOptionalInteger("yearsExperience", req.body.yearsExperience, {
      min: 0,
      max: 60,
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "instagramHandle")) {
    patch.instagram_handle = validateOptionalString("instagramHandle", req.body.instagramHandle, {
      maxLength: 120,
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "tiktokHandle")) {
    patch.tiktok_handle = validateOptionalString("tiktokHandle", req.body.tiktokHandle, {
      maxLength: 120,
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "isPublic")) {
    patch.is_public = validateOptionalBoolean("isPublic", req.body.isPublic);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "depositRequired")) {
    patch.deposit_required = validateOptionalBoolean("depositRequired", req.body.depositRequired);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "deposit_required")) {
    patch.deposit_required = validateOptionalBoolean("deposit_required", req.body.deposit_required);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "profileImageUrl")) {
    // LEGACY: migrate this field to { url, publicId } object
    patch.profile_image_url = validateImageSource(req.body.profileImageUrl, "profileImageUrl");
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "profileImagePublicId")) {
    patch.profile_image_public_id = validateOptionalString(
      "profileImagePublicId",
      req.body.profileImagePublicId,
      { maxLength: 255 }
    );
  }

  const updated = await upsertByUserId(req.auth.sub, patch);
  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

router.patch("/stylists/:userId", requireAuth, requireStylist, async (req, res) => {
  if (!sameUserId(req.params.userId, req.auth.sub)) {
    return res.status(403).json({
      success: false,
      error: "You can only update your own stylist settings",
      request_id: req.id,
    });
  }

  if (
    !Object.prototype.hasOwnProperty.call(req.body, "depositRequired") &&
    !Object.prototype.hasOwnProperty.call(req.body, "deposit_required")
  ) {
    return res.status(400).json({
      success: false,
      error: "depositRequired is required",
      request_id: req.id,
    });
  }

  const depositRequired = Object.prototype.hasOwnProperty.call(req.body, "depositRequired")
    ? req.body.depositRequired
    : req.body.deposit_required;
  const updated = await upsertByUserId(req.auth.sub, {
    deposit_required: validateOptionalBoolean("depositRequired", depositRequired),
  });

  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

router.get("/stylists/me/portfolio", requireAuth, requireStylist, async (req, res) => {
  const posts = await listByStylist(req.auth.sub, { includeUnpublished: true });
  return res.json({
    success: true,
    count: posts.length,
    data: posts,
    request_id: req.id,
  });
});

router.get("/stylists/:userId/portfolio", async (req, res) => {
  const posts = await listByStylist(req.params.userId, { includeUnpublished: false });
  return res.json({
    success: true,
    count: posts.length,
    data: posts,
    request_id: req.id,
  });
});

router.get("/stylists/:userId/reviews", async (req, res, next) => {
  try {
    const reviews = await listReviewsByStylist(req.params.userId, {
      limit: parseListLimit(req.query.limit),
    });

    return res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/stylists/me/portfolio", requireAuth, requireStylist, async (req, res) => {
  const mediaUrls = validateMediaUrls(req.body.mediaUrls);
  const isPublished =
    req.body.isPublished === undefined
      ? true
      : validateOptionalBoolean("isPublished", req.body.isPublished);
  const createInput = {
    stylistUserId: req.auth.sub,
    title: validateOptionalString("title", req.body.title, { maxLength: 160 }),
    caption: validateOptionalString("caption", req.body.caption, { maxLength: 2000 }),
    isPublished,
    mediaUrls,
  };
  if (Object.prototype.hasOwnProperty.call(req.body, "category")) {
    createInput.category = validateOptionalString("category", req.body.category, { maxLength: 20 }) || "other";
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "mediaPublicIds")) {
    createInput.mediaPublicIds = Array.isArray(req.body.mediaPublicIds) ? req.body.mediaPublicIds : [];
  }
  const post = await createPost(createInput);
  return res.status(201).json({
    success: true,
    data: post,
    request_id: req.id,
  });
});

router.patch("/stylists/me/portfolio/:postId", requireAuth, requireStylist, async (req, res) => {
  const post = await findById(req.params.postId);
  if (!post || !sameUserId(post.stylistUserId, req.auth.sub)) {
    return res.status(404).json({
      success: false,
      error: "Portfolio post not found",
      request_id: req.id,
    });
  }

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
    patch.title = validateOptionalString("title", req.body.title, { maxLength: 160 });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "caption")) {
    patch.caption = validateOptionalString("caption", req.body.caption, { maxLength: 2000 });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "isPublished")) {
    patch.is_published = validateOptionalBoolean("isPublished", req.body.isPublished);
  }

  const updated = await updatePost(post.id, patch);

  if (req.body.mediaUrls !== undefined) {
    const mediaUrls = validateMediaUrls(req.body.mediaUrls);
    const withMedia = await replaceMedia(post.id, mediaUrls);
    return res.json({
      success: true,
      data: withMedia,
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

router.delete("/stylists/me/portfolio/:postId", requireAuth, requireStylist, async (req, res) => {
  const post = await findById(req.params.postId);
  if (!post || !sameUserId(post.stylistUserId, req.auth.sub)) {
    return res.status(404).json({
      success: false,
      error: "Portfolio post not found",
      request_id: req.id,
    });
  }
  await deletePost(post.id);
  return res.json({
    success: true,
    data: { deleted: true },
    request_id: req.id,
  });
});

router.get("/stylists/:userId/services", async (req, res) => {
  const shops = await listShopsForStylist(req.params.userId);
  if (shops.length === 0) {
    return res.json({
      success: true,
      count: 0,
      data: [],
      request_id: req.id,
    });
  }

  const activeShop = shops[0];
  const offerings = await listByShopAndStylist(activeShop.id, req.params.userId);
  return res.json({
    success: true,
    count: offerings.length,
    data: offerings,
    request_id: req.id,
  });
});

module.exports = router;
