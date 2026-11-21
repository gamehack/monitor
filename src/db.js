import { Client } from "pg";
import { translateSql } from "./sql-compat.js";

function normalizeRows(result) {
  const bigintFields = new Set((result.fields || [])
    .filter(field => field.dataTypeID === 20)
    .map(field => field.name));
  return (result.rows || []).map(row => {
    if (bigintFields.size === 0) return row;
    const normalized = { ...row };
    for (const field of bigintFields) {
      if (typeof normalized[field] !== "string") continue;
      const value = Number(normalized[field]);
      if (Number.isSafeInteger(value)) normalized[field] = value;
    }
    return normalized;
  });
}

class PgD1Statement {
  constructor(client, sql) { this.client = client; this.sql = translateSql(sql); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first(column) {
    const result = await this.client.query(this.sql, this.params);
    const row = normalizeRows(result)[0] ?? null;
    return column && row ? row[column] ?? null : row;
  }
  async all() {
    const result = await this.client.query(this.sql, this.params);
    const rows = normalizeRows(result);
    return { success: true, results: rows, meta: { changes: result.rowCount ?? 0, rows_read: result.rowCount ?? 0 } };
  }
  async run() {
    const result = await this.client.query(this.sql, this.params);
    return { success: true, meta: { changes: result.rowCount ?? 0, last_row_id: 0, rows_written: result.rowCount ?? 0 } };
  }
}

/** Minimal D1-shaped facade so business logic can move without a risky SQL rewrite. */
export class PgD1Database {
  constructor(connectionString, ClientImpl = Client) {
    if (!connectionString) throw new Error("HYPERDRIVE binding is missing");
    this.client = new ClientImpl({ connectionString, application_name: "QJAI Ops" });
    this.connected = false;
  }
  async connect() {
    if (!this.connected) { await this.client.connect(); this.connected = true; }
    return this;
  }
  prepare(sql) {
    if (!this.connected) throw new Error("PostgreSQL client is not connected");
    return new PgD1Statement(this.client, sql);
  }
  async close() {
    if (this.connected) { this.connected = false; await this.client.end(); }
  }
}
