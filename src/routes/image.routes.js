const express = require("express");
const multer = require("multer");
const config = require("../config");
const { requireAuth } = require("../middleware/auth");
const { localImageUpload, cleanupTempFile } = require("../middleware/localImageUpload");
const { validateImageFile } = require("../lib/cloudinary");
const {
  updateUserAvatar,
  addPortfolioPhoto,
  removePortfolioPhoto,
  swapPortfolioPhoto,
  reorderPortfolio,
  updateSalonCover,
  deleteStylistAllImages,
  deleteOwnerImages,
  deleteImage,
} = require("../services/imageService");

const router = express.Router();

async function getCurrentUser(req) {
  const upstream = await fetch(`${config.authServiceUrl}/users/me`, {
    method: "GET",
    headers: {
      authorization: req.headers.authorization || "",
      "x-request-id": req.id || "",
    },
  });
  if (upstream.status !== 200) return null;
  const body = await upstream.json().catch(() => ({}));
  return body?.data || null;
}

function withSingleImage(fieldName, handler) {
  return [
    requireAuth,
    (req, res, next) => {
      localImageUpload.single(fieldName)(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            error: "File exceeds 10MB limit",
            request_id: req.id,
          });
        }
        if (error instanceof multer.MulterError) {
          return res.status(400).json({
            success: false,
            error: error.message,
            request_id: req.id,
          });
        }
        return next(error);
      });
    },
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: `${fieldName} is required`,
            request_id: req.id,
          });
        }
        validateImageFile(req.file);
        return await handler(req, res);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message,
          request_id: req.id,
        });
      } finally {
        cleanupTempFile(req.file);
      }
    },
  ];
}

router.patch(
  "/users/avatar",
  ...withSingleImage("avatar", async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Unable to verify user",
        request_id: req.id,
      });
    }

    const updated = await updateUserAvatar(user.id, user.role, req.file, {
      authorization: req.headers.authorization || "",
    });

    return res.json({
      success: true,
      message: "Avatar updated",
      avatar: updated.avatar,
      data: updated,
      request_id: req.id,
    });
  })
);

router.post(
  "/stylist/portfolio",
  ...withSingleImage("photo", async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user || user.role !== "stylist") {
      return res.status(403).json({
        success: false,
        error: "Stylist role required",
        request_id: req.id,
      });
    }

    const photo = await addPortfolioPhoto(
      user.id,
      req.file,
      req.body.caption,
      req.body.category
    );

    return res.status(201).json({
      success: true,
      message: "Photo added",
      photo,
      data: photo,
      request_id: req.id,
    });
  })
);

router.delete("/stylist/portfolio/:photoId", requireAuth, async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== "stylist") {
      return res.status(403).json({
        success: false,
        error: "Stylist role required",
        request_id: req.id,
      });
    }

    const portfolio = await removePortfolioPhoto(user.id, req.params.photoId);
    return res.json({
      success: true,
      message: "Photo deleted",
      portfolio,
      data: { deleted: true },
      request_id: req.id,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
      request_id: req.id,
    });
  }
});

router.patch(
  "/stylist/portfolio/:photoId/replace",
  ...withSingleImage("photo", async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user || user.role !== "stylist") {
      return res.status(403).json({
        success: false,
        error: "Stylist role required",
        request_id: req.id,
      });
    }

    const photo = await swapPortfolioPhoto(user.id, req.params.photoId, req.file);
    return res.json({
      success: true,
      message: "Photo replaced",
      photo,
      data: photo,
      request_id: req.id,
    });
  })
);

router.patch("/stylist/portfolio/reorder", requireAuth, async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== "stylist") {
      return res.status(403).json({
        success: false,
        error: "Stylist role required",
        request_id: req.id,
      });
    }

    if (!Array.isArray(req.body.orderedIds) || req.body.orderedIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "orderedIds must be a non-empty array",
        request_id: req.id,
      });
    }

    const portfolio = await reorderPortfolio(user.id, req.body.orderedIds);
    return res.json({
      success: true,
      message: "Portfolio reordered",
      portfolio,
      data: portfolio,
      request_id: req.id,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
      request_id: req.id,
    });
  }
});

router.patch(
  "/owner/salon-cover",
  ...withSingleImage("cover", async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user || user.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "Owner role required",
        request_id: req.id,
      });
    }

    const owner = await updateSalonCover(user.id, req.file);
    return res.json({
      success: true,
      message: "Cover updated",
      cover: owner.salonCover,
      data: owner,
      request_id: req.id,
    });
  })
);

router.delete("/internal/users/:userId/images", requireAuth, async (req, res) => {
  try {
    if (String(req.auth.sub) !== String(req.params.userId)) {
      return res.status(403).json({
        success: false,
        error: "You can only delete your own images",
        request_id: req.id,
      });
    }

    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
        request_id: req.id,
      });
    }

    if (user.role === "stylist") {
      await deleteStylistAllImages(user.id);
      if (user.avatar?.publicId) await deleteImage(user.avatar.publicId);
    } else if (user.role === "owner") {
      await deleteOwnerImages(user.id, user.avatar?.publicId);
    } else if (user.avatar?.publicId) {
      await deleteImage(user.avatar.publicId);
    }

    return res.json({
      success: true,
      data: { deleted: true },
      request_id: req.id,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
      request_id: req.id,
    });
  }
});

module.exports = router;
