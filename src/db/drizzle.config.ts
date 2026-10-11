import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST || process.env.PGHOST || 'localhost';
const sqlPort = Number(process.env.PGPORT || 5432);
const sqlDbName = process.env.SQL_DB_NAME || process.env.PGDATABASE || 'achadinhos';
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || process.env.PGUSER || 'postgres';
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || process.env.PGPASSWORD || '';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    host: sqlHost,
    port: sqlPort,
    user,
    password,
    database: sqlDbName,
    ssl: false,
  },
  verbose: true,
});
