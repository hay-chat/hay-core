# Incident response

Use this for suspected unauthorized access, data exposure, or leaked secrets. For a
plain outage, start with the other runbooks.

## First hour

1. **Open a timeline** in a private document. Note times in UTC, who did what, and why.
2. **Name one lead.** They decide; everyone else reports to them.
3. **Preserve evidence before changing anything.** Container logs rotate and restarts
   lose them:
   ```bash
   docker compose logs --no-color --since 72h > incident-<date>.log
   ```
   Take a database backup or provider snapshot, and keep any affected host's state.
4. **Contain.** Choose the smallest step that stops the harm:
   - Rotate the exposed secret ([key-rotation](key-rotation.md)).
   - Revoke the affected API tokens or suspend the organization.
   - If the scope is unknown, take the service offline. That's better than guessing.
5. **Keep it private.** The repository is public, so no details go in issues, commits or
   pull requests until it's resolved.

## Investigate

- **Audit log:** `audit_logs` records logins, exports, permission changes and admin
  actions. Check that it's intact first: `SELECT * FROM audit_logs_verify_chain();`
- **Trace a request:** each one has an id in the `X-Request-Id` header and in every
  log line as `requestId`; tRPC errors return it as `error.data.requestId`.
- **Trace a conversation:** `hay logs <conversationId>`.
- **Establish:** what was accessed, whose data, since when, how they got in, and
  whether it's still open.

## Notify

If personal data was affected, Hay's obligations under GDPR start when you become
aware of it:

- **Controllers (where Hay decides how data is used, such as its own accounts):**
  the supervisory authority within **72 hours**, unless the risk is unlikely (Art. 33),
  and the people affected without undue delay if the risk is high (Art. 34).
- **Processor (customer conversation data):** each affected customer **without undue
  delay**. Check their contract for a specific deadline. Customers then make their own
  notifications, so give them what you know even if it's incomplete.

Record what you decided and why, including a decision not to notify. Have legal counsel
confirm before anything goes out.

## Afterwards

1. Remove the cause and confirm it's closed. If production was compromised, rebuild
   from a known-good state instead of cleaning in place.
2. Rotate anything that could have been reached.
3. Within a week, write down what happened, how it was detected, what would have caught
   it sooner, and who owns each follow-up. Add an alert or test for that gap.
