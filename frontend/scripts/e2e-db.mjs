// The throwaway API's PostgreSQL database, for the end-to-end scripts that need to do what an email link would do (mark an address
// confirmed, switch two-step on, add a verified domain). Start that API against its own database, for example:
//   docker compose exec db createdb -U craton craton_e2e
//   CRATON_DATABASE_URL=postgres://craton:craton@localhost:5433/craton_e2e npm start      (in backend)
//   CRATON_E2E_DATABASE_URL=postgres://craton:craton@localhost:5433/craton_e2e node scripts/<script>.mjs
// Never aim it at real data: the scripts create accounts and change them directly.
import { createRequire } from "node:module";

const backend = createRequire(new URL("../../backend/package.json", import.meta.url));
const pg = backend("pg");

/** `?` placeholders to $1, $2 ... */
const numbered = (sql) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

export async function openE2eDb() {
  const url = process.env.CRATON_E2E_DATABASE_URL;
  if (!url) throw new Error("Set CRATON_E2E_DATABASE_URL to the PostgreSQL database of the throwaway API (see scripts/e2e-db.mjs).");
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  return {
    prepare: (sql) => ({
      run: async (...params) => {
        await pool.query(numbered(sql), params);
      },
    }),
    close: () => pool.end(),
  };
}
