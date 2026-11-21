// Narrow SQLite-to-PostgreSQL compatibility for the existing D1-style repository calls.
// Keep this translator deliberately small: every supported construct is covered by tests.
export function translateSql(input) {
  let sql = String(input).trim().replace(/;\s*$/, "");
  const ignoreInsert = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
  if (ignoreInsert) {
    sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
    if (!/\bON\s+CONFLICT\b/i.test(sql)) sql += " ON CONFLICT DO NOTHING";
  }

  // SQLite JSON scalar extraction used by the Product Hunt recovery proof lookup.
  sql = sql.replace(
    /CAST\(json_extract\(\s*([a-z_][a-z0-9_.]*)\s*,\s*'\$\.(\w+)'\s*\)\s+AS\s+INTEGER\s*\)/gi,
    "CAST(($1::jsonb ->> '$2') AS BIGINT)"
  );

  // Convert positional D1 placeholders while respecting quoted strings and identifiers.
  let out = "", index = 0, quote = null, lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (lineComment) { out += ch; if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { out += ch; if (ch === "*" && next === "/") { out += next; i++; blockComment = false; } continue; }
    if (quote) {
      out += ch;
      if (ch === quote && next === quote) { out += next; i++; continue; }
      if (ch === quote && sql[i - 1] !== String.fromCharCode(92)) quote = null;
      continue;
    }
    if (ch === "-" && next === "-") { out += ch + next; i++; lineComment = true; continue; }
    if (ch === "/" && next === "*") { out += ch + next; i++; blockComment = true; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === "?") { out += "$" + (++index); continue; }
    out += ch;
  }
  return out;
}
