// What each Claude call cost: tokens by person, list and use, with an estimated price. Shown on the admin screen.
import { randomUUID } from "node:crypto";
import type { AdminUsage, ClaudeUse } from "../shared/types.ts";
import { db } from "./db.ts";

/** Who a call is for, and what for. */
export interface UsageTag {
  userId: string;
  listId: string | null;
  use: ClaudeUse;
}

/** The fields of `response.usage` that are billed. */
interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Standard API prices, dollars per million tokens. Cache writes are the 5-minute rate (1.25× input).
 * These are estimates for a family-sized bill: check the Anthropic console for the real one.
 */
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

/** Estimated cost in millionths of a dollar, or null for a model without a price here. */
export function costMicros(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return Math.round(
    (u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead,
  );
}

const insert = db.prepare(`
  INSERT INTO claude_usage(id, at, user_id, list_id, use, model, input_tokens, output_tokens, cache_write_tokens,
    cache_read_tokens, cost_micros, ok)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Log one response's tokens. `ok` is false when the answer came back but couldn't be used (cut off, declined):
 * those are billed too. Never throws: a logging hiccup mustn't break reading a receipt.
 */
export function recordUsage(tag: UsageTag, response: { model: string; usage: Usage }, ok = true) {
  try {
    const u = response.usage;
    insert.run(
      randomUUID(), Date.now(), tag.userId, tag.listId, tag.use, response.model,
      u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0,
      costMicros(response.model, u), ok ? 1 : 0,
    );
  } catch (err) {
    console.error("couldn't log Claude usage:", err instanceof Error ? err.message : err);
  }
}

// ---------- the admin screen's summary ----------

const MONTH = 30 * 864e5;

const SUM = `COUNT(*) AS calls, SUM(input_tokens + cache_write_tokens + cache_read_tokens) AS input,
  SUM(output_tokens) AS output, SUM(cost_micros) AS cost`;
const totals = db.prepare(`SELECT ${SUM} FROM claude_usage WHERE at > ?`);
const byUse = db.prepare(`SELECT use AS key, ${SUM} FROM claude_usage WHERE at > ? GROUP BY use ORDER BY cost DESC`);
const byUser = db.prepare(`
  SELECT COALESCE(u.name, 'Someone') AS key, ${SUM} FROM claude_usage c LEFT JOIN users u ON u.id = c.user_id
  WHERE c.at > ? GROUP BY c.user_id ORDER BY cost DESC
`);
const byList = db.prepare(`
  SELECT COALESCE(json_extract(l.data, '$.name'), '(deleted list)') AS key, ${SUM}
  FROM claude_usage c LEFT JOIN lists l ON l.id = c.list_id
  WHERE c.at > ? AND c.list_id IS NOT NULL GROUP BY c.list_id ORDER BY cost DESC
`);
const recent = db.prepare(`
  SELECT c.at, c.use, c.model, c.input_tokens + c.cache_write_tokens + c.cache_read_tokens AS input, c.output_tokens AS output,
    c.cost_micros AS cost, c.ok, COALESCE(u.name, 'Someone') AS who, json_extract(l.data, '$.name') AS list
  FROM claude_usage c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN lists l ON l.id = c.list_id
  ORDER BY c.at DESC LIMIT 25
`);

type SumRow = { key?: string; calls: number; input: number | null; output: number | null; cost: number | null };
const sum = (r: SumRow) => ({ calls: r.calls, input: r.input ?? 0, output: r.output ?? 0, cost: (r.cost ?? 0) / 1e6 });
const groups = (rows: SumRow[]) => rows.map((r) => ({ key: r.key ?? "", ...sum(r) }));

export function usageSummary(): AdminUsage {
  const month = Date.now() - MONTH;
  return {
    month: sum(totals.get(month) as SumRow),
    allTime: sum(totals.get(0) as SumRow),
    byUse: groups(byUse.all(month) as SumRow[]),
    byUser: groups(byUser.all(month) as SumRow[]),
    byList: groups(byList.all(month) as SumRow[]),
    recent: (recent.all() as Record<string, unknown>[]).map((r) => ({
      at: Number(r.at),
      use: r.use as ClaudeUse,
      model: String(r.model),
      who: String(r.who),
      list: (r.list as string | null) ?? null,
      input: Number(r.input),
      output: Number(r.output),
      cost: r.cost == null ? null : Number(r.cost) / 1e6,
      ok: r.ok === 1,
    })),
  };
}
