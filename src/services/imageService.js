const config = require("../config");
const {
  LIMITS,
  validateImageFile,
  uploadAvatar,
  uploadPortfolioPhoto,
  deletePortfolioPhoto,
  replacePortfolioPhoto,
  uploadSalonCover,
  deleteEntirePortfolio,
  deleteImage,
  getNextPortfolioOrder,
  normalizeCategory,
} = require("../lib/cloudinary");
const { upsertByUserId, getByUserId } = require("../repositories/stylistProfileRepository");
const {
  listByStylist,
  countByStylist,
  findById,
  createPhotoEntry,
  updatePhotoImage,
  reorderPortfolio: persistPortfolioOrder,
  deletePost,
} = require("../repositories/portfolioRepository");
const {
  findActiveShopByOwnerUserId,
  updateShopById,
} = require("../repositories/shopRepository");

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

function normalizeFileInput(filePathOrFile) {
  if (!filePathOrFile) throw new Error("Image file is required");
  if (typeof filePathOrFile === "string") return { path: filePathOrFile };
  return filePathOrFile;
}

async function fetchAuthJson(targetPath, { method = "GET", authorization, body } = {}) {
  const upstream = await fetchWithTimeout(`${config.authServiceUrl}${targetPath}`, {
    method,
    headers: {
      authorization: authorization || "",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await upstream.json().catch(() => ({}));
  return { status: upstream.status, payload };
}

async function updateAuthAvatar(userId, role, avatar, authorization) {
  const response = await fetchAuthJson(`/internal/users/${encodeURIComponent(userId)}/avatar`, {
    method: "PATCH",
    authorization,
    body: { avatar, role },
  });
  if (response.status !== 200) {
    throw new Error(response.payload?.error || "Unable to update avatar metadata");
  }
  return response.payload.data;
}

async function updateUserAvatar(userId, role, filePath, options = {}) {
  const file = normalizeFileInput(filePath);
  validateImageFile(file);

  const avatar = await uploadAvatar(file.path, userId, role);
  const updatedUser = await updateAuthAvatar(userId, role, avatar, options.authorization);

  if (role === "stylist") {
    await upsertByUserId(userId, {
      profile_image_url: avatar.url,
      profile_image_public_id: avatar.publicId,
    });
  }

  return updatedUser;
}

async function addPortfolioPhoto(stylistId, filePath, caption, category) {
  const file = normalizeFileInput(filePath);
  validateImageFile(file);

  const portfolio = await listByStylist(stylistId, { includeUnpublished: true });
  const portfolioCount = await countByStylist(stylistId);
  if (portfolioCount >= LIMITS.maxPortfolioPhotos) {
    throw new Error("Portfolio limit of 30 photos reached");
  }

  const entry = await uploadPortfolioPhoto(file.path, stylistId, caption, category);
  entry.category = normalizeCategory(entry.category);
  entry.order = getNextPortfolioOrder(portfolio);
  return createPhotoEntry({ stylistUserId: stylistId, photo: entry });
}

async function removePortfolioPhoto(stylistId, photoId) {
  const photo = await findById(photoId);
  if (!photo || String(photo.stylistUserId) !== String(stylistId)) {
    throw new Error("Photo not found");
  }

  const publicId = photo.publicId || photo.media?.[0]?.mediaPublicId;
  await deletePortfolioPhoto(publicId);
  await deletePost(photo.id);
  return listByStylist(stylistId, { includeUnpublished: true });
}

async function swapPortfolioPhoto(stylistId, photoId, filePath) {
  const file = normalizeFileInput(filePath);
  validateImageFile(file);

  const photo = await findById(photoId);
  if (!photo || String(photo.stylistUserId) !== String(stylistId)) {
    throw new Error("Photo not found");
  }

  const oldPublicId = photo.publicId || photo.media?.[0]?.mediaPublicId;
  const image = await replacePortfolioPhoto(file.path, stylistId, oldPublicId);
  const updated = await updatePhotoImage(photo.id, image);
  if (!updated) throw new Error("Photo not found");
  return updated;
}

async function reorderPortfolio(stylistId, orderedIds) {
  const portfolio = await listByStylist(stylistId, { includeUnpublished: true });
  const existingIds = new Set(portfolio.map((entry) => String(entry.id)));
  const uniqueOrderedIds = new Set(orderedIds.map(String));

  if (uniqueOrderedIds.size !== orderedIds.length) {
    throw new Error("Invalid photo id");
  }

  for (const id of orderedIds) {
    if (!existingIds.has(String(id))) {
      throw new Error("Invalid photo id");
    }
  }

  const updated = await persistPortfolioOrder(stylistId, orderedIds);
  return updated.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

async function updateSalonCover(ownerId, filePath) {
  const file = normalizeFileInput(filePath);
  validateImageFile(file);

  const cover = await uploadSalonCover(file.path, ownerId);
  const shop = await findActiveShopByOwnerUserId(ownerId);
  if (!shop) throw new Error("Owner does not have an active shop");

  const updated = await updateShopById(shop.id, {
    image_url: cover.url,
    image_public_id: cover.publicId,
  });

  return updated;
}

async function deleteStylistAllImages(stylistId) {
  const stylist = await getByUserId(stylistId);
  if (stylist?.avatar?.publicId) {
    await deleteImage(stylist.avatar.publicId);
  }
  return deleteEntirePortfolio(stylistId);
}

async function deleteOwnerImages(ownerId, avatarPublicId) {
  if (avatarPublicId) {
    await deleteImage(avatarPublicId);
  }

  const shop = await findActiveShopByOwnerUserId(ownerId);
  if (shop?.salonCover?.publicId) {
    await deleteImage(shop.salonCover.publicId);
  }
}

module.exports = {
  updateUserAvatar,
  addPortfolioPhoto,
  removePortfolioPhoto,
  swapPortfolioPhoto,
  reorderPortfolio,
  updateSalonCover,
  deleteStylistAllImages,
  deleteOwnerImages,
  deleteImage,
};
