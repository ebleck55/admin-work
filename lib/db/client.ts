import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

let cached: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (cached) return cached;
  const sql = neon(env().DATABASE_URL);
  cached = drizzle(sql, { schema, casing: "snake_case" });
  return cached;
}

export type DB = ReturnType<typeof db>;
export { schema };
