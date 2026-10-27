/**
 * Is the organization inside its business hours right now?
 *
 * There is no business-hours schedule yet (D5-6 adds it). Until then every
 * organization is treated as always open, which is the agreed default for an
 * organization without a schedule.
 *
 * TODO(D5-6): read the organization's schedule (timezone + weekly hours +
 * exceptions) and answer from it; keep `true` for organizations without one.
 */
export async function isWithinBusinessHours(
  _organizationId: string,
  _now: Date = new Date(),
): Promise<boolean> {
  return true;
}
