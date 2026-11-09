# Single sign-on (OpenID Connect, SAML) and SCIM

Each organization can let its team sign in through its own identity provider, and can have that provider
create and remove its people automatically (SCIM). Owners set it up under Settings, Single sign-on.
A connection is OpenID Connect or SAML, one per organization.

## How a sign-in works

1. On the login page, an email address on a verified domain shows "Continue with single sign-on".
2. The browser goes to `GET /sso/start`, which stores a one-use state, nonce and PKCE verifier in
   Redis (10 minutes), sets a cookie that ties the sign-in to this browser, and redirects to the provider.
3. The provider redirects to `GET /sso/callback`. The state is spent first, whatever happens next.
   Hay then checks the cookie, trades the code for an ID token (client secret plus PKCE verifier), and
   verifies the token: signature against the provider's published keys (RS/PS/ES algorithms only),
   issuer, audience, expiry and nonce. The provider's discovery document must name the same issuer.
4. The token's email must be marked verified by the provider and sit on a domain this organization proved
   with DNS. Otherwise the sign-in is refused.
5. Hay finds or creates the person (below) and redirects the dashboard with a one-minute, one-use ticket,
   which `auth.sso.exchange` trades for a normal session.

Redis is required: without it sign-in is refused, nothing is issued.

## Setup for an owner (OpenID Connect)

1. Create an OpenID Connect web application at the provider. Redirect URL: `<API URL>/sso/callback`
   (shown on the settings page). The provider must support the authorization code flow with PKCE (S256), sign ID
   tokens with an asymmetric key, and include `email` and `email_verified: true`. Providers that do not send
   `email_verified` (for example Microsoft Entra by default) cannot be used yet.
2. Enter issuer, client ID and client secret. Hay reads the discovery document before saving. The secret is
   stored encrypted and never shown again.
3. Add each email domain and publish the TXT record shown: `_hay-sso-challenge.<domain>` with the value
   `hay-sso-verification=<token>`. Choose Check record. A domain verified by one organization cannot be
   verified by another.
4. Sign in once through the provider (in a private window), then turn on "Require single sign-on" if wanted.

Self-hosted installs whose provider sits on a private network or plain http set
`SSO_ALLOW_PRIVATE_PROVIDER_HOSTS=true`. By default provider URLs must be https on public addresses
(the same outbound rules as other tenant-supplied URLs).

## SAML

Choose "SAML 2.0" on the settings page. Hay shows the values to enter at the provider:

- **ACS URL (Reply URL):** `<API URL>/sso/saml/acs`, the same for every organization.
- **Entity ID (Audience):** `<API URL>/sso/saml/<organization id>`. Once saved, the same page lists the
  service provider metadata URL (`<entity id>/metadata`) for providers that import it.

Then enter the provider's entity ID, its single sign-on URL (HTTP-Redirect binding) and the certificate it signs with
(PEM or plain base64; paste two during a rotation). Sign-in starts at Hay only. Requirements on the provider:

- The **assertion** itself must be signed with the configured certificate. A provider that signs only the response
  (and not the assertion) is refused; there is no setting to relax this.
  Okta signs the assertion by default. In Entra choose "Sign SAML assertion" or "Sign SAML response and assertion".
- The assertion must name this audience, be addressed (Recipient) to the ACS URL, answer the request Hay sent
  (`InResponseTo`) and be within its validity window (60 seconds of clock skew, and no assertion older than 5 minutes).
- NameID must not be `transient`. The email address comes from the `email`, `mail` or `emailaddress` claim,
  else from an email NameID. Optional first/last name attributes: `givenName`/`firstName`, `sn`/`surname`.
- The email attribute must not be editable by the people it describes (in the provider's directory or profile).
  A first sign-in links to an existing member of the organization by email, so anyone who can change their own
  address at the provider could otherwise take over a colleague's account.
- A groups attribute can be named for role mapping, as with the OpenID Connect groups claim.

How the browser comes back: the provider POSTs the response to the ACS URL. That request is cross-site, so the
sign-in cookie (SameSite=Lax, as for OpenID Connect) is not sent with it. Hay verifies the response there, then
redirects (303) to `/sso/saml/finish`, a same-site GET where the cookie arrives; only then is the person provisioned
and the one-minute ticket issued. Provider-initiated sign-in (a response nobody asked for) is refused. A SAML
assertion has no `email_verified`: the signed assertion plus the DNS-proven domain stand in for it.

Switching an organization between OpenID Connect and SAML, or to another provider, turns the requirement off and forgets
the old provider's links; people link again by email as active members.

Rate limits: starting a sign-in is limited to 300 per 15 minutes per address. The callback, ACS and finish steps allow 30
per 15 minutes per address, but a step that succeeds clears its count, so only failed attempts add up and an office behind
one address is not locked out by its own sign-ins. Limits stay fail-closed without Redis.

Redis is used for the request id (one use), the assertion id (so a captured response cannot be replayed) and the
parked response. The ACS endpoint accepts a form post of up to 400 KB and nothing else is widened.

## Who gets in

- A returning person is matched on the provider's stable subject id, not on email.
- A first sign-in links to an existing account only if that account's email matches and it is already an
  active member of this organization with a verified email. An account that exists only elsewhere is never
  claimed, whatever the provider says. Ask an owner to invite the person first.
- Otherwise a new account is created with the default role. It has a random password nobody knows.
- Members who were removed or deactivated are not added back by signing in.
- Roles: with a groups claim configured, the best matching group wins (admin, member, contributor, agent,
  viewer). Nothing matching gives the default role. A claim can never grant owner, and an existing owner's
  role is never changed by sign-in. Without a claim configured, roles are never changed after creation.
- A session from single sign-on can only act in the organization whose provider signed the person in
  (`sso` claim in the access token, kept on the session). The same account's other organizations answer 403.

## Requiring single sign-on

Turning it on needs: an enabled provider with at least one successful sign-in, a verified domain, and the owner
turning it on has two-factor authentication. Then:

- Sessions that did not come from the provider are refused in that organization (403, `SSO_REQUIRED`);
  the dashboard signs them out and says why.
- **Break-glass:** an owner with a second factor can still sign in with a password and code. That keeps the
  organization reachable if the provider is down or misconfigured. Other roles, including admins, cannot.
- API tokens are not people and keep working. Owners control who can create them.
- Changing the issuer, client ID or secret, switching the connection off or deleting it, or removing the last
  verified domain turns the requirement off, so a bad edit cannot lock people out. Test the new setup, then
  turn it back on.
- Members of several organizations who sign in with a password can still use their other organizations; the
  enforcing one refuses them. They need a provider session for it, which then reaches only that organization.

### If everyone is locked out

An owner with two-factor signs in with email, password and code. If there is no such owner, turn it off in the
database (this is a deliberate break-glass, so write it down):

```sql
UPDATE organizations SET settings = jsonb_set(settings, '{ssoEnforced}', 'false') WHERE id = '<org id>';
```

Then check `audit_logs` for `sso.enforcement.change`.

## Two-factor authentication

- Where SSO is **not** enforced, a person who has Hay two-factor set up still gives the code after the provider.
- Where SSO **is** enforced, the provider is trusted to ask for the second factor: provider sessions skip the
  Hay code and the organization's own "require two-factor" setting. Ask the customer to require MFA at the
  provider. Password (break-glass) sessions are still held to Hay's two-factor rules.
- Known edge: a provider-created account has no known password, and enrolling a first factor asks for one.
  Where SSO is not enforced but the organization requires two-factor, such a person first uses "Forgot password".

## Audit events

`sso.config.update`, `sso.config.delete`, `sso.domain.add`, `sso.domain.verify`, `sso.domain.remove`,
`sso.enforcement.change` (all by the acting owner; the client secret is never recorded), `sso.login`, and
`sso.login_failed` (with a reason such as `state_invalid`, `token_invalid`, `domain_unverified`).
SCIM adds `scim.token.create`, `scim.token.revoke`, `scim.auth_failed` (first failure per address per 15 minutes),
`scim.user.create|update|deactivate|reactivate|delete`, `scim.group.create|update|delete` and `scim.role.change`.

## SCIM provisioning

An owner generates a token under "Automatic provisioning (SCIM)". It is shown once; only a hash is kept. Creating another
replaces the first; revoking stops it at once. Enter `<API URL>/scim/v2` and the token at the provider (Okta: SCIM 2.0 with
HTTP header authentication; Entra: tenant URL and secret token). Requests are limited to 600 a minute per token, and
failed attempts are limited per address.

- A token reaches only its own organization. Other organizations' people and groups answer 404.
- Users: create, get, list (filters `eq ne co sw ew pr gt ge lt le`, `and`, `or`, `not`, on `userName`, `externalId`, `id`,
  `emails.value`, `active`, `name.*`, `displayName`), PUT, PATCH (Okta's pathless and Entra's path form) and DELETE.
  Discovery: `/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`. Errors follow RFC 7644 (`scimType`).
- Only addresses on the organization's verified domains can be provisioned. An account that already exists outside the
  organization is never claimed (409); invite that person first. A person this organization removed earlier can be
  provisioned again.
- Owners are never changed, deactivated or removed through SCIM (403). Groups never produce an owner.
- An account used in other organizations is only changed here: its name and address are left alone (an address change
  is refused with `mutability`), and nothing happens to its other memberships.
- Deactivating (`active: false`) or deleting removes the person from this organization: the membership, their single
  sign-on sessions for this organization, their open dashboard sockets here and the API tokens they created here all
  end. If it was their only organization the account is deactivated and every session ends. Reactivation turns the
  membership back on, and the account too when this was its only organization.
- Groups: a pushed group's name is looked up in the role mapping above (the same one sign-in uses). Members get the best
  mapped role, or the default role when none of their groups is mapped. With no mapping set, groups never change a role.
  A person's role is rewritten only when the role their mapped groups give actually changes, so someone promoted by hand
  and pushed into an unrelated group keeps their role.
- **One source of truth for roles.** If a groups claim or attribute is also configured for sign-in, every sign-in
  re-applies it (no claim means the default role, on purpose: a person removed from every group must lose access).
  Use the same group names in SCIM and in the claim, or configure only one of them.
- A token works without a connection (people get the default role, groups map to nothing). Removing the connection
  revokes the token. A suspended or deactivated organization's token is refused.

## Confirm it works

- `GET <API URL>/sso/start?email=<a verified-domain address>` answers 302 to the provider.
- After a sign-in, `audit_logs` has `sso.login` and `sso_connections.last_login_at` is set.
- Refusals show up as `sso.login_failed`; the log line names the reason, never the token.

## Deploy notes

Run migrations after deploying. Until they run, nobody has single sign-on or SCIM and everything else is unchanged
(SCIM requests answer 401). Two migrations add SAML columns to `sso_connections` and the SCIM tables.
No new environment variables. `SSO_ALLOW_PRIVATE_PROVIDER_HOSTS=true` also allows a plain-http SAML sign-in URL for self-hosted installs.
