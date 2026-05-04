/* eslint-disable no-console */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const migrationsDir = path.join(__dirname, "..", "migrations");
const connectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/shop_db";

async function run() {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const check = await client.query(
        "SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1",
        [filename]
      );
      if (check.rowCount > 0) {
        console.log(`Skipping ${filename} (already applied)`);
        continue;
      }

      console.log(`Applying ${filename} ...`);
      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    }

    console.log("Migrations complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
