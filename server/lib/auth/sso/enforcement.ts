export function organizationEnforcesSso(
  organization: { settings?: { ssoEnforced?: boolean } | null } | undefined | null,
): boolean {
  return organization?.settings?.ssoEnforced === true;
}
