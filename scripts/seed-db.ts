import "dotenv/config";
import { checkDbConnection } from "../lib/db";

// Sanity check script - confirms DATABASE_URL is reachable and the pgvector
// extension is installed before you start building against it.
async function main() {
  const ok = await checkDbConnection();
  if (!ok) {
    console.error("Could not connect to the database. Check DATABASE_URL in .env.local.");
    process.exit(1);
  }
  console.log("Database connection OK. Run `npm run db:migrate` next if you haven't.");
}

main();
