# Single sign-on (OpenID Connect)

Each organization can let its team sign in through its own identity provider.
Owners set it up under Settings, Single sign-on. SAML and SCIM are not part of this.

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

## Setup for an owner

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

## Confirm it works

- `GET <API URL>/sso/start?email=<a verified-domain address>` answers 302 to the provider.
- After a sign-in, `audit_logs` has `sso.login` and `sso_connections.last_login_at` is set.
- Refusals show up as `sso.login_failed`; the log line names the reason, never the token.

## Deploy notes

Run migrations after deploying. Until they run, nobody has single sign-on and everything else is unchanged.
