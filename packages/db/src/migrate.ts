import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  console.log("[migrate] running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
