export interface OccupancyPeriod { startDate: Date; endDate: Date | null; status: string }
export function periodsOverlap(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date | null): boolean {
  return leftStart < (rightEnd ?? new Date(8640000000000000)) && rightStart < leftEnd;
}
export function isBedAvailable(status: string, bookings: OccupancyPeriod[], tenancies: OccupancyPeriod[], start: Date, end: Date): boolean {
  if (status !== "AVAILABLE") return false;
  return !bookings.some((item) => item.status === "CONFIRMED" && periodsOverlap(start, end, item.startDate, item.endDate))
    && !tenancies.some((item) => item.status === "ACTIVE" && periodsOverlap(start, end, item.startDate, item.endDate));
}
