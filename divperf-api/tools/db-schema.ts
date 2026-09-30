/**
 * Creates or updates the sign-in database from db/schema.sql. Idempotent.
 * Usage:  npm run db:schema      (then npm run infinity:sync to fill it)
 */
import { config } from '../src/config.js';
import { applySchema } from '../src/users/schema.js';

const target = new URL(config.USER_DATABASE_URL);
await applySchema(config.USER_DATABASE_URL);
console.log(`Schema applied to ${target.hostname}/${target.pathname.slice(1)}`);
