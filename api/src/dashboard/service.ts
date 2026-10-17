import type { DashboardQuery } from "./schemas.js";

export interface DashboardRepository {
  owner(ownerId: string | null, range: { from: Date; toExclusive: Date; asOf: Date }): Promise<unknown>;
  tenant(tenantId: string, range: { from: Date; toExclusive: Date; asOf: Date }): Promise<unknown>;
}

export class DashboardService {
  constructor(private readonly repository: DashboardRepository, private readonly now: () => Date = () => new Date()) {}
  owner(ownerId: string | null, query: DashboardQuery) {
    const today = day(this.now());
    return this.repository.owner(ownerId, dateRange(query, today));
  }
  tenant(tenantId: string, query: DashboardQuery) {
    const today = day(this.now());
    return this.repository.tenant(tenantId, dateRange(query, today));
  }
}

function day(value: Date) { return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`); }
function dateRange(query: DashboardQuery, today: Date) {
  const to = query.to ? day(new Date(`${query.to}T00:00:00.000Z`)) : today;
  const from = query.from ? day(new Date(`${query.from}T00:00:00.000Z`)) : new Date(to);
  if (!query.from) from.setUTCDate(from.getUTCDate() - 29);
  const toExclusive = new Date(to); toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return { from, toExclusive, asOf: today };
}
