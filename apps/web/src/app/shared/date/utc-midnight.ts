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

// The inverse of toUtcMidnightIso: turns a stored UTC-midnight ISO string
// back into a Date a NativeDateAdapter-driven datepicker can show correctly.
//
// `new Date(isoString)` is NOT the inverse here, even though it looks like
// one. NativeDateAdapter reads a Date with *local* getters
// (getFullYear/getMonth/getDate), so a plain `new Date('2026-08-01T00:00:00.000Z')`
// at UTC-5 displays as 31 July, not 1 August — one calendar day off. Worse,
// if that displayed value is ever re-serialized with toUtcMidnightIso (e.g.
// touching a sibling filter control triggers both to be read and resent),
// the result is 2026-07-31T00:00:00.000Z: a new, wrong "stored" value. Doing
// this every time a screen reloads a retained filter walks the date back one
// day per cycle.
//
// Build the local Date from the ISO's *UTC* calendar-day components instead,
// so NativeDateAdapter's local getters read back the same calendar day the
// ISO string encodes.
export function fromUtcMidnightIso(iso: string): Date {
  const instant = new Date(iso);
  return new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}
