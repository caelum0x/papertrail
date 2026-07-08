import "dotenv/config";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

// Applies the base db/migrations.sql first, then every db/migrations/*.sql in
// filename order. All migration files are expected to be idempotent, so this is
// safe to run repeatedly.
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  const dbDir = join(__dirname, "..", "db");
  const baseSqlPath = join(dbDir, "migrations.sql");
  if (existsSync(baseSqlPath)) {
    console.log("Applying db/migrations.sql ...");
    await pool.query(readFileSync(baseSqlPath, "utf-8"));
  }

  const migrationsDir = join(dbDir, "migrations");
  if (existsSync(migrationsDir)) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      console.log(`Applying db/migrations/${file} ...`);
      await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
    }
  }

  console.log("Migration complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
