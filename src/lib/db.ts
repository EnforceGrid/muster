import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://muster:muster@localhost:5434/muster";

export const sql = postgres(url, {
  max: 5,
  idle_timeout: 30,
  prepare: true,
  onnotice: () => {},
});

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
