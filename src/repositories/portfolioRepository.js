const { query, withTransaction } = require("../db/pool");
const crypto = require("crypto");

function mapPost(row) {
  return {
    id: row.id,
    stylistUserId: row.stylist_user_id,
    title: row.title,
    caption: row.caption,
    category: row.category || "other",
    order: Number(row.display_order || 0),
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function attachMedia(posts) {
  if (posts.length === 0) return posts;
  const ids = posts.map((p) => p.id);
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const mediaResult = await query(
    `SELECT id, post_id, media_url, media_public_id, sort_order, created_at
     FROM portfolio_media
     WHERE post_id IN (${placeholders})
     ORDER BY post_id ASC, sort_order ASC, id ASC`,
    ids
  );

  const grouped = new Map();
  mediaResult.rows.forEach((m) => {
    if (!grouped.has(m.post_id)) grouped.set(m.post_id, []);
    grouped.get(m.post_id).push({
      id: m.id,
      postId: m.post_id,
      // LEGACY: migrate this field to { url, publicId } object
      mediaUrl: m.media_url,
      mediaPublicId: m.media_public_id,
      image: {
        url: m.media_url,
        publicId: m.media_public_id,
      },
      sortOrder: m.sort_order,
      createdAt: m.created_at,
    });
  });

  return posts.map((p) => ({
    ...p,
    media: grouped.get(p.id) || [],
    url: (grouped.get(p.id) || [])[0]?.mediaUrl || null,
    publicId: (grouped.get(p.id) || [])[0]?.mediaPublicId || null,
    uploadedAt: p.createdAt,
    // LEGACY: migrate this field to { url, publicId } object
    mediaUrls: (grouped.get(p.id) || []).map((media) => media.mediaUrl),
  }));
}

async function listByStylist(stylistUserId, { includeUnpublished = false } = {}) {
  const result = await query(
    `SELECT *
     FROM portfolio_posts
     WHERE stylist_user_id = $1 ${includeUnpublished ? "" : "AND is_published = true"}
     ORDER BY display_order ASC, created_at DESC`,
    [stylistUserId]
  );
  return attachMedia(result.rows.map(mapPost));
}

async function findById(postId) {
  const result = await query(
    "SELECT * FROM portfolio_posts WHERE id = $1 LIMIT 1",
    [postId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const [full] = await attachMedia([mapPost(row)]);
  return full;
}

async function createPost({
  stylistUserId,
  title,
  caption,
  category = "other",
  displayOrder = 0,
  isPublished,
  mediaUrls = [],
  mediaPublicIds = [],
}) {
  const postId = crypto.randomUUID();
  await withTransaction(async (txQuery) => {
    await txQuery(
      `INSERT INTO portfolio_posts (id, stylist_user_id, title, caption, category, display_order, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [postId, stylistUserId, title, caption, category, displayOrder, isPublished]
    );

    if (mediaUrls.length > 0) {
      const values = [];
      const placeholders = mediaUrls
        .map((url, index) => {
          values.push(
            crypto.randomUUID(),
            postId,
            url,
            mediaPublicIds[index] || null,
            index + 1
          );
          const offset = index * 5;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
        })
        .join(", ");

      await txQuery(
        `INSERT INTO portfolio_media (id, post_id, media_url, media_public_id, sort_order)
         VALUES ${placeholders}`,
        values
      );
    }
  });

  return findById(postId);
}

async function countByStylist(stylistUserId) {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM portfolio_posts
     WHERE stylist_user_id = $1`,
    [stylistUserId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function createPhotoEntry({ stylistUserId, photo }) {
  await withTransaction(async (txQuery) => {
    await txQuery(
      `INSERT INTO portfolio_posts (
         id, stylist_user_id, title, caption, category, display_order, is_published, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, true, $7
       )`,
      [
        photo.id,
        stylistUserId,
        photo.category,
        photo.caption,
        photo.category,
        photo.order,
        photo.uploadedAt,
      ]
    );

    await txQuery(
      `INSERT INTO portfolio_media (id, post_id, media_url, media_public_id, sort_order, created_at)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [crypto.randomUUID(), photo.id, photo.url, photo.publicId, photo.uploadedAt]
    );
  });

  return findById(photo.id);
}

async function updatePhotoImage(postId, image) {
  const existing = await findById(postId);
  const mediaId = existing?.media?.[0]?.id;
  if (!mediaId) return null;

  await query(
    `UPDATE portfolio_media
     SET media_url = $2,
         media_public_id = $3
     WHERE id = $1`,
    [mediaId, image.url, image.publicId]
  );
  return findById(postId);
}

async function reorderPortfolio(stylistUserId, orderedIds) {
  if (orderedIds.length > 0) {
    const values = [];
    const rows = orderedIds.map((id, index) => {
      values.push(id, index + 1);
      const offset = index * 2;
      return `($${offset + 1}::uuid, $${offset + 2}::int)`;
    });
    values.push(stylistUserId);

    await query(
      `UPDATE portfolio_posts AS pp
       SET display_order = updates.display_order,
           updated_at = NOW()
       FROM (VALUES ${rows.join(", ")}) AS updates(id, display_order)
       WHERE pp.id = updates.id
         AND pp.stylist_user_id = $${values.length}`,
      values
    );
  }
  return listByStylist(stylistUserId, { includeUnpublished: true });
}

async function updatePost(postId, patch) {
  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });

  if (fields.length > 0) {
    params.push(postId);
    await query(
      `UPDATE portfolio_posts
       SET ${fields.join(", ")}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    );
  }

  return findById(postId);
}

async function replaceMedia(postId, mediaUrls) {
  await withTransaction(async (txQuery) => {
    await txQuery("DELETE FROM portfolio_media WHERE post_id = $1", [postId]);
    if (mediaUrls.length === 0) return;

    const values = [];
    const placeholders = mediaUrls
      .map((url, index) => {
        values.push(crypto.randomUUID(), postId, url, index + 1);
        const offset = index * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      })
      .join(", ");

    await txQuery(
      `INSERT INTO portfolio_media (id, post_id, media_url, sort_order)
       VALUES ${placeholders}`,
      values
    );
  });
  return findById(postId);
}

async function deletePost(postId) {
  const result = await query("DELETE FROM portfolio_posts WHERE id = $1", [postId]);
  return result.rowCount;
}

module.exports = {
  listByStylist,
  findById,
  createPost,
  updatePost,
  replaceMedia,
  countByStylist,
  createPhotoEntry,
  updatePhotoImage,
  reorderPortfolio,
  deletePost,
};
