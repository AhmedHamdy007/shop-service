const express = require("express");
const { healthCheck } = require("../db/pool");
const { requireAuth, requireOwner, requireCustomer } = require("../middleware/auth");
const {
  listServiceCatalog,
  getServiceCatalogItem,
} = require("../catalog/serviceCatalog");
const {
  ValidationError,
  normalizeShopPayload,
  normalizeServicePayload,
  validateOptionalString,
  validateRequiredInteger,
  validateOptionalMediaUrls,
} = require("../utils/validation");
const {
  createShop,
  findShopById,
  findPublicShopById,
  findActiveShopByOwnerUserId,
  listShops,
  updateShopById,
} = require("../repositories/shopRepository");
const {
  createService,
  findActiveServiceByShopAndCatalogServiceKey,
  listServicesByShop,
  findServiceById,
  findActiveServiceByShopAndId,
  updateServiceById,
} = require("../repositories/serviceRepository");
const {
  findActiveOfferingByShopStylistAndService,
} = require("../repositories/offeringRepository");
const {
  createReview,
  findReviewByBookingId,
  listReviewsByCustomer,
  listReviewsByShop,
} = require("../repositories/reviewRepository");
const {
  findStaffByShopAndUser,
  findActiveMembershipByUser,
} = require("../repositories/staffRepository");
const { getByUserId } = require("../repositories/stylistProfileRepository");

const router = express.Router();

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

function pickPresentFields(source, fields) {
  return fields.reduce((patch, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      patch[field] = source[field];
    }
    return patch;
  }, {});
}

function normalizeReviewPayload(body) {
  const aspects = body.aspectRatings || body.aspects || {};
  return {
    bookingId: validateOptionalString("bookingId", body.bookingId, { maxLength: 120 }),
    stylistUserId: validateOptionalString("stylistUserId", body.stylistUserId, {
      maxLength: 120,
    }),
    serviceName: validateOptionalString("serviceName", body.serviceName, { maxLength: 160 }),
    rating: validateRequiredInteger("rating", body.rating, { min: 1, max: 5 }),
    reviewText: validateOptionalString("reviewText", body.reviewText, { maxLength: 2000 }),
    photoUrls: validateOptionalMediaUrls(body.photoUrls),
    aspectRatings: {
      technique: validateOptionalRating("aspectRatings.technique", aspects.technique),
      communication: validateOptionalRating(
        "aspectRatings.communication",
        aspects.communication
      ),
      value: validateOptionalRating("aspectRatings.value", aspects.value),
      atmosphere: validateOptionalRating("aspectRatings.atmosphere", aspects.atmosphere),
    },
  };
}

function validateOptionalRating(name, value) {
  if (value === undefined || value === null || value === 0) return null;
  return validateRequiredInteger(name, value, { min: 1, max: 5 });
}

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "shop-service",
    timestamp: new Date().toISOString(),
  });
});

router.get("/ready", async (req, res) => {
  try {
    await healthCheck();
    return res.json({
      ready: true,
      service: "shop-service",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      ready: false,
      service: "shop-service",
      error: "Database unavailable",
      timestamp: new Date().toISOString(),
      request_id: req.id,
    });
  }
});

router.post("/uploads/image", requireAuth, (req, res) => {
  return res.status(410).json({
    success: false,
    error: "Generic image uploads are disabled. Use the role-specific image endpoints.",
    request_id: req.id,
  });
});

router.get("/service-catalog", async (req, res, next) => {
  try {
    const providerType = req.query.providerType
      ? validateOptionalString("providerType", req.query.providerType, { maxLength: 40 })
      : null;
    const category = req.query.category
      ? validateOptionalString("category", req.query.category, { maxLength: 80 })
      : null;

    const items = listServiceCatalog({ providerType, category });
    return res.json({
      success: true,
      count: items.length,
      data: items,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/service-catalog/:serviceKey", async (req, res) => {
  const item = getServiceCatalogItem(req.params.serviceKey);
  if (!item) {
    return res.status(404).json({
      success: false,
      error: "Service catalog item not found",
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: item,
    request_id: req.id,
  });
});

router.get("/shops", async (req, res, next) => {
  try {
    const shops = await listShops({
      city: req.query.city || null,
      q: req.query.q || null,
      sort: req.query.sort || "newest",
      limit: parseListLimit(req.query.limit),
    });
    res.json({
      success: true,
      count: shops.length,
      data: shops,
      request_id: req.id,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/shops/me", requireAuth, requireOwner, async (req, res) => {
  const shop = await findActiveShopByOwnerUserId(req.auth.sub);
  if (!shop) {
    return res.status(404).json({
      success: false,
      error: "Owner does not have an active shop",
      request_id: req.id,
    });
  }

  return res.json({
    success: true,
    data: shop,
    request_id: req.id,
  });
});

router.get("/shops/reviews/me", requireAuth, requireCustomer, async (req, res, next) => {
  try {
    const reviews = await listReviewsByCustomer(req.auth.sub, {
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

router.get("/shops/:id", async (req, res) => {
  const shop = await findPublicShopById(req.params.id);
  if (!shop) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
  }
  return res.json({
    success: true,
    data: shop,
    request_id: req.id,
  });
});

router.get("/shops/:id/reviews", async (req, res, next) => {
  try {
    const shop = await findPublicShopById(req.params.id);
    if (!shop) {
      return res.status(404).json({
        success: false,
        error: "Shop not found",
        request_id: req.id,
      });
    }

    const reviews = await listReviewsByShop(shop.id, {
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

router.post("/shops/:id/reviews", requireAuth, requireCustomer, async (req, res, next) => {
  try {
    const shop = await findShopById(req.params.id);
    if (!shop || !shop.isActive) {
      return res.status(404).json({
        success: false,
        error: "Shop not found",
        request_id: req.id,
      });
    }

    const payload = normalizeReviewPayload(req.body);
    if (!payload.bookingId) {
      throw new ValidationError("bookingId is required", "bookingId");
    }
    if (!payload.reviewText || payload.reviewText.length < 10) {
      throw new ValidationError("reviewText must be at least 10 characters", "reviewText");
    }

    const existing = await findReviewByBookingId(payload.bookingId);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "This booking has already been reviewed",
        request_id: req.id,
      });
    }

    const review = await createReview({
      shopId: shop.id,
      customerUserId: req.auth.sub,
      ...payload,
    });

    return res.status(201).json({
      success: true,
      data: review,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/shops", requireAuth, requireOwner, async (req, res) => {
  const existingShop = await findActiveShopByOwnerUserId(req.auth.sub);
  if (existingShop) {
    return res.status(409).json({
      success: false,
      error: "Owner already has an active shop",
      request_id: req.id,
    });
  }

  const payload = normalizeShopPayload(req.body);
  const shop = await createShop({
    ownerUserId: req.auth.sub,
    ...payload,
  });
  return res.status(201).json({
    success: true,
    data: shop,
    request_id: req.id,
  });
});

router.patch("/shops/:id", requireAuth, requireOwner, async (req, res) => {
  const shop = await findShopById(req.params.id);
  if (!shop || !shop.isActive) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
  }

  if (!sameUserId(shop.ownerUserId, req.auth.sub)) {
    return res.status(403).json({
      success: false,
      error: "You can only update your own shop",
      request_id: req.id,
    });
  }

  const patchInput = pickPresentFields(req.body, [
    "name",
    "slug",
    "addressLine1",
    "city",
    "country",
    "phone",
    "email",
    "description",
    "imageUrl",
  ]);
  const normalized = normalizeShopPayload({ ...shop, ...patchInput });

  const dbPatch = {};
  if (Object.prototype.hasOwnProperty.call(patchInput, "name")) dbPatch.name = normalized.name;
  if (Object.prototype.hasOwnProperty.call(patchInput, "slug")) dbPatch.slug = normalized.slug;
  if (Object.prototype.hasOwnProperty.call(patchInput, "addressLine1")) {
    dbPatch.address_line1 = normalized.addressLine1;
  }
  if (Object.prototype.hasOwnProperty.call(patchInput, "city")) dbPatch.city = normalized.city;
  if (Object.prototype.hasOwnProperty.call(patchInput, "country")) dbPatch.country = normalized.country;
  if (Object.prototype.hasOwnProperty.call(patchInput, "phone")) dbPatch.phone = normalized.phone;
  if (Object.prototype.hasOwnProperty.call(patchInput, "email")) dbPatch.email = normalized.email;
  if (Object.prototype.hasOwnProperty.call(patchInput, "description")) {
    dbPatch.description = normalized.description;
  }
  if (Object.prototype.hasOwnProperty.call(patchInput, "imageUrl")) {
    dbPatch.image_url = normalized.imageUrl;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "imagePublicId")) {
    dbPatch.image_public_id = validateOptionalString("imagePublicId", req.body.imagePublicId, {
      maxLength: 255,
    });
  }

  const updated = await updateShopById(shop.id, dbPatch);

  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
});

async function listShopServiceOfferings(req, res) {
  const shop = await findShopById(req.params.id);
  if (!shop || !shop.isActive) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
  }

  const services = await listServicesByShop(shop.id);
  return res.json({
    success: true,
    count: services.length,
    data: services,
    request_id: req.id,
  });
}

router.get("/shops/:id/services", listShopServiceOfferings);
router.get("/shops/:id/service-offerings", listShopServiceOfferings);

async function createShopServiceOffering(req, res) {
  const shop = await findShopById(req.params.id);
  if (!shop || !shop.isActive) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
  }

  if (!sameUserId(shop.ownerUserId, req.auth.sub)) {
    return res.status(403).json({
      success: false,
      error: "You can only manage services for your own shop",
      request_id: req.id,
    });
  }

  const payload = normalizeServicePayload(req.body);
  if (req.route?.path?.includes("service-offerings") && !payload.catalogServiceKey) {
    throw new ValidationError("catalogServiceKey is required for service offerings", "catalogServiceKey");
  }

  if (payload.catalogServiceKey) {
    const existing = await findActiveServiceByShopAndCatalogServiceKey(
      shop.id,
      payload.catalogServiceKey
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "An active service offering already exists for this catalog service",
        request_id: req.id,
      });
    }
  }

  const created = await createService({
    shopId: shop.id,
    ...payload,
  });

  return res.status(201).json({
    success: true,
    data: created,
    request_id: req.id,
  });
}

router.post("/shops/:id/services", requireAuth, requireOwner, createShopServiceOffering);
router.post(
  "/shops/:id/service-offerings",
  requireAuth,
  requireOwner,
  createShopServiceOffering
);

async function updateShopServiceOffering(req, res) {
  const shop = await findShopById(req.params.id);
  if (!shop || !shop.isActive) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
  }
  if (!sameUserId(shop.ownerUserId, req.auth.sub)) {
    return res.status(403).json({
      success: false,
      error: "You can only manage services for your own shop",
      request_id: req.id,
    });
  }

  const existing = await findServiceById(req.params.serviceId);
  if (!existing || existing.shopId !== shop.id) {
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
      req.body.durationMinutes === undefined
        ? existing.durationMinutes
        : req.body.durationMinutes,
    price: req.body.price === undefined ? existing.price : req.body.price,
  });
  if (req.route?.path?.includes("service-offerings") && !payload.catalogServiceKey) {
    throw new ValidationError("catalogServiceKey is required for service offerings", "catalogServiceKey");
  }

  const patch = {
    name: payload.name,
    description: payload.description,
    category: payload.category,
    duration_minutes: payload.durationMinutes,
    price: payload.price,
  };
  if (
    Object.prototype.hasOwnProperty.call(req.body, "catalogServiceKey") ||
    existing.catalogServiceKey !== undefined
  ) {
    patch.catalog_service_key = payload.catalogServiceKey;
  }

  const updated = await updateServiceById(existing.id, patch);

  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
}

router.patch(
  "/shops/:id/services/:serviceId",
  requireAuth,
  requireOwner,
  updateShopServiceOffering
);
router.patch(
  "/shops/:id/service-offerings/:serviceId",
  requireAuth,
  requireOwner,
  updateShopServiceOffering
);

async function deactivateShopServiceOffering(req, res) {
  const shop = await findShopById(req.params.id);
  if (!shop || !shop.isActive) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
      request_id: req.id,
    });
  }
  if (!sameUserId(shop.ownerUserId, req.auth.sub)) {
    return res.status(403).json({
      success: false,
      error: "You can only manage services for your own shop",
      request_id: req.id,
    });
  }

  const existing = await findServiceById(req.params.serviceId);
  if (!existing || existing.shopId !== shop.id) {
    return res.status(404).json({
      success: false,
      error: "Service not found",
      request_id: req.id,
    });
  }

  const updated = await updateServiceById(existing.id, { is_active: false });
  return res.json({
    success: true,
    data: updated,
    request_id: req.id,
  });
}

router.delete(
  "/shops/:id/services/:serviceId",
  requireAuth,
  requireOwner,
  deactivateShopServiceOffering
);
router.delete(
  "/shops/:id/service-offerings/:serviceId",
  requireAuth,
  requireOwner,
  deactivateShopServiceOffering
);

router.get("/internal/booking-context/shop", async (req, res, next) => {
  try {
    const shopId = validateOptionalString("shopId", req.query.shopId, { maxLength: 120 });
    const stylistUserId = validateOptionalString("stylistUserId", req.query.stylistUserId, {
      maxLength: 120,
    });
    const serviceId = validateOptionalString("serviceId", req.query.serviceId, { maxLength: 120 });

    if (!shopId || !stylistUserId || !serviceId) {
      throw new ValidationError(
        "shopId, stylistUserId, and serviceId are required",
        "bookingContext"
      );
    }

    const shop = await findShopById(shopId);
    if (!shop || !shop.isActive) {
      return res.status(404).json({
        success: false,
        error: "Shop not found",
        request_id: req.id,
      });
    }

    const membership = await findStaffByShopAndUser(shop.id, stylistUserId);
    if (!membership || membership.status !== "active") {
      return res.status(404).json({
        success: false,
        error: "Active stylist membership not found",
        request_id: req.id,
      });
    }

    const service = await findActiveServiceByShopAndId(shop.id, serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        error: "Service offering not found",
        request_id: req.id,
      });
    }

    const stylistOffering = await findActiveOfferingByShopStylistAndService(
      shop.id,
      stylistUserId,
      service.id
    );

    return res.json({
      success: true,
      data: {
        bookingContextType: "shop",
        shop: {
          id: shop.id,
          ownerUserId: shop.ownerUserId,
          name: shop.name,
          slug: shop.slug,
          addressLine1: shop.addressLine1,
          city: shop.city,
          country: shop.country,
          phone: shop.phone,
          email: shop.email,
          imageUrl: shop.imageUrl,
        },
        stylist: {
          userId: membership.userId,
          staffLevel: membership.staffLevel,
          displayName: membership.displayName || membership.stylistName || null,
          profileImageUrl: membership.profileImageUrl || null,
          specialties: membership.specialties || null,
          yearsExperience: membership.yearsExperience || null,
        },
        serviceOffering: {
          id: service.id,
          catalogServiceKey: service.catalogServiceKey,
          catalogService: service.catalogService,
          name: service.name,
          description: service.description,
          category: service.category,
          durationMinutes:
            stylistOffering?.customDurationMinutes ?? service.durationMinutes,
          baseDurationMinutes: service.durationMinutes,
          price: stylistOffering?.customPrice ?? service.price,
          basePrice: service.price,
        },
      },
      request_id: req.id,
    });
  }
  catch (error) {
    return next(error);
  }
});

router.get("/internal/messaging-context", async (req, res, next) => {
  try {
    const conversationType = validateOptionalString("conversationType", req.query.conversationType, {
      maxLength: 40,
    });
    const initiatorUserId = validateOptionalString("initiatorUserId", req.query.initiatorUserId, {
      maxLength: 120,
    });
    const initiatorRole = validateOptionalString("initiatorRole", req.query.initiatorRole, {
      maxLength: 40,
    });
    const targetUserId = validateOptionalString("targetUserId", req.query.targetUserId, {
      maxLength: 120,
    });
    const targetRole = validateOptionalString("targetRole", req.query.targetRole, { maxLength: 40 });

    if (!conversationType || !initiatorUserId || !initiatorRole || !targetUserId || !targetRole) {
      throw new ValidationError(
        "conversationType, initiatorUserId, initiatorRole, targetUserId, and targetRole are required",
        "messagingContext"
      );
    }

    if (conversationType === "customer_stylist") {
      const stylistUserId =
        initiatorRole === "stylist"
          ? initiatorUserId
          : targetRole === "stylist"
            ? targetUserId
            : null;
      const customerUserId =
        initiatorRole === "customer"
          ? initiatorUserId
          : targetRole === "customer"
            ? targetUserId
            : null;

      if (!stylistUserId || !customerUserId) {
        return res.status(403).json({
          success: false,
          error: "customer_stylist conversations require one customer and one stylist",
          request_id: req.id,
        });
      }

      const profile = await getByUserId(stylistUserId);
      if (!profile || !profile.isPublic) {
        return res.status(404).json({
          success: false,
          error: "Public stylist profile not found",
          request_id: req.id,
        });
      }

      const membership = await findActiveMembershipByUser(stylistUserId);
      const shop = membership ? await findShopById(membership.shopId) : null;

      return res.json({
        success: true,
        data: {
          conversationType,
          shopId: shop?.isActive ? shop.id : null,
          ownerUserId: shop?.isActive ? shop.ownerUserId : null,
          stylistUserId,
          customerUserId,
        },
        request_id: req.id,
      });
    }

    if (conversationType === "owner_stylist") {
      const ownerUserId =
        initiatorRole === "owner"
          ? initiatorUserId
          : targetRole === "owner"
            ? targetUserId
            : null;
      const stylistUserId =
        initiatorRole === "stylist"
          ? initiatorUserId
          : targetRole === "stylist"
            ? targetUserId
            : null;

      if (!ownerUserId || !stylistUserId) {
        return res.status(403).json({
          success: false,
          error: "owner_stylist conversations require one owner and one stylist",
          request_id: req.id,
        });
      }

      const membership = await findActiveMembershipByUser(stylistUserId);
      if (!membership) {
        return res.status(403).json({
          success: false,
          error: "Stylist does not belong to an active shop",
          request_id: req.id,
        });
      }

      const shop = await findShopById(membership.shopId);
      if (!shop || !shop.isActive) {
        return res.status(404).json({
          success: false,
          error: "Shop not found",
          request_id: req.id,
        });
      }

      if (!sameUserId(shop.ownerUserId, ownerUserId)) {
        return res.status(403).json({
          success: false,
          error: "Owner can only message stylists from their own shop",
          request_id: req.id,
        });
      }

      return res.json({
        success: true,
        data: {
          conversationType,
          shopId: shop.id,
          ownerUserId,
          stylistUserId,
          staffLevel: membership.staffLevel,
        },
        request_id: req.id,
      });
    }

    return res.status(400).json({
      success: false,
      error: "Unsupported conversation type",
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
