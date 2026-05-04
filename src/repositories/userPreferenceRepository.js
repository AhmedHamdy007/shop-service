const { query } = require("../db/pool");

function rowToPreference(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertDefaultUserPreferences({ userId, email, role }) {
  const result = await query(
    `INSERT INTO user_preferences (user_id, email, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id)
     DO UPDATE SET email = EXCLUDED.email,
                   role = EXCLUDED.role,
                   updated_at = NOW()
     RETURNING *`,
    [userId, email, role]
  );
  return rowToPreference(result.rows[0]);
}

module.exports = { upsertDefaultUserPreferences };
