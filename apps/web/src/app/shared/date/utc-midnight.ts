// The datepicker (and any other native Date input driven by
// provideNativeDateAdapter()) yields a Date at *local* midnight. Calling
// .toISOString() on it directly converts that local instant to UTC, which
// shifts the calendar day in either direction depending on the deployment
// timezone (e.g. local midnight Aug 1 in Bogota, UTC-5, becomes
// 2026-08-01T05:00:00.000Z, and local midnight Aug 1 in Madrid, UTC+2,
// becomes 2026-07-31T22:00:00.000Z). Build the UTC instant from the picker's
// calendar-day components instead, so a date picked in any timezone
// round-trips to the same UTC-midnight instant `consumedAt` is stored at and
// filtered against.
//
// Every screen that turns a picked Date into a wire value — registering a
// consumption and filtering the consumptions list by date — must use this
// same function, or the two can disagree on which calendar day a given
// instant belongs to.
export function toUtcMidnightIso(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}
