import { z } from "zod";
import { ScimError } from "./errors";

/**
 * SCIM request bodies turned into the few changes Hay supports. Identity
 * providers send the same change in different shapes (Okta puts the new value
 * in an object with no path; Entra sends a path and often "True"/"False" as
 * text), so each shape is read here and nowhere else. Attributes Hay has no use
 * for are accepted and ignored, which is what providers expect from a server
 * that does not store them.
 */

const MAX_OPERATIONS = 50;
const MAX_MEMBERS = 5000;
const UUID = z.string().uuid();

export interface UserInput {
  userName?: string;
  externalId?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  active?: boolean;
}

export interface GroupInput {
  displayName?: string;
  externalId?: string | null;
  /** Replaces the member list. */
  members?: string[];
  add: string[];
  remove: string[];
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  throw new ScimError(400, "active must be true or false", "invalidValue");
}

function toText(value: unknown, what: string, max = 255): string {
  if (typeof value !== "string" || value.length > max) {
    throw new ScimError(
      400,
      `${what} must be a string of at most ${max} characters`,
      "invalidValue",
    );
  }
  return value;
}

function toNullableText(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : toText(value, what);
}

/** `urn:...:User:userName` and `userName` name the same attribute. */
function attributeName(path: string): string {
  const colon = path.lastIndexOf(":");
  return (colon === -1 ? path : path.slice(colon + 1)).trim();
}

function setUserAttribute(target: UserInput, name: string, value: unknown, remove: boolean): void {
  switch (name.toLowerCase()) {
    case "active":
      if (remove) throw new ScimError(400, "active cannot be removed", "invalidValue");
      target.active = toBoolean(value);
      return;
    case "username":
      if (remove) throw new ScimError(400, "userName cannot be removed", "mutability");
      target.userName = toText(value, "userName");
      return;
    case "externalid":
      target.externalId = remove ? null : toNullableText(value, "externalId");
      return;
    case "name.givenname":
      target.givenName = remove ? null : toNullableText(value, "name.givenName");
      return;
    case "name.familyname":
      target.familyName = remove ? null : toNullableText(value, "name.familyName");
      return;
    case "name": {
      if (remove) {
        target.givenName = null;
        target.familyName = null;
        return;
      }
      const object =
        typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
      if ("givenName" in object)
        target.givenName = toNullableText(object.givenName, "name.givenName");
      if ("familyName" in object)
        target.familyName = toNullableText(object.familyName, "name.familyName");
      return;
    }
    default:
      // The address that identifies a person is userName; emails, phone numbers,
      // titles and extensions are not stored.
      return;
  }
}

function operationsOf(body: unknown): Array<{ op: string; path?: string; value?: unknown }> {
  const parsed = z
    .object({
      Operations: z
        .array(
          z.object({
            op: z.string(),
            path: z.string().max(500).optional(),
            value: z.unknown().optional(),
          }),
        )
        .min(1)
        .max(MAX_OPERATIONS),
    })
    .safeParse(body);
  if (!parsed.success) {
    throw new ScimError(400, "A PatchOp needs between 1 and 50 Operations", "invalidSyntax");
  }
  return parsed.data.Operations.map((operation) => {
    const op = operation.op.toLowerCase();
    if (!["add", "replace", "remove"].includes(op)) {
      throw new ScimError(400, `Unknown operation ${operation.op}`, "invalidSyntax");
    }
    return { ...operation, op };
  });
}

export function parseUserPatch(body: unknown): UserInput {
  const changes: UserInput = {};
  for (const operation of operationsOf(body)) {
    const remove = operation.op === "remove";
    if (operation.path) {
      setUserAttribute(changes, attributeName(operation.path), operation.value, remove);
      continue;
    }
    if (remove) throw new ScimError(400, "remove needs a path", "noTarget");
    if (typeof operation.value !== "object" || operation.value === null) {
      throw new ScimError(400, "A value without a path must be an object", "invalidValue");
    }
    for (const [key, value] of Object.entries(operation.value as Record<string, unknown>)) {
      setUserAttribute(changes, attributeName(key), value, false);
    }
  }
  return changes;
}

const userBody = z
  .object({
    userName: z.string().min(1).max(255).optional(),
    externalId: z.string().max(255).nullish(),
    active: z.union([z.boolean(), z.string()]).optional(),
    name: z
      .object({
        givenName: z.string().max(255).nullish(),
        familyName: z.string().max(255).nullish(),
      })
      .passthrough()
      .nullish(),
    emails: z
      .array(
        z.object({ value: z.string().max(255), primary: z.boolean().optional() }).passthrough(),
      )
      .max(20)
      .optional(),
  })
  .passthrough();

/** A POST or PUT body. `userName` is the person's email address; the primary email stands in when it is not one. */
export function parseUserBody(body: unknown): UserInput {
  const parsed = userBody.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "The user is not valid", "invalidSyntax");
  const { userName, externalId, active, name, emails } = parsed.data;
  const primary = emails?.find((email) => email.primary) ?? emails?.[0];
  // Entra sends the sign-in name as userName; Okta may send a login that is not an address.
  const identity = userName?.includes("@") ? userName : (primary?.value ?? userName);
  const input: UserInput = { userName: identity };
  if (externalId !== undefined) input.externalId = externalId ?? null;
  if (active !== undefined) input.active = toBoolean(active);
  if (name) {
    input.givenName = name.givenName ?? null;
    input.familyName = name.familyName ?? null;
  }
  return input;
}

function memberIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (list.length > MAX_MEMBERS) {
    throw new ScimError(400, `At most ${MAX_MEMBERS} members per request`, "tooMany");
  }
  return list.map((entry) => {
    const id = UUID.safeParse(
      typeof entry === "object" && entry !== null ? (entry as { value?: unknown }).value : entry,
    );
    if (!id.success) throw new ScimError(400, "A member needs the id of a user", "invalidValue");
    return id.data;
  });
}

const MEMBER_FILTER = /^members\s*\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i;

export function parseGroupPatch(body: unknown): GroupInput {
  const changes: GroupInput = { add: [], remove: [] };
  for (const operation of operationsOf(body)) {
    const remove = operation.op === "remove";
    const path = operation.path ? attributeName(operation.path) : "";
    const filtered = MEMBER_FILTER.exec(path);
    if (filtered) {
      if (!remove)
        throw new ScimError(400, "A member filter only works with remove", "invalidPath");
      changes.remove.push(...memberIds([filtered[1]]));
    } else if (path.toLowerCase() === "members") {
      if (remove) {
        if (operation.value === undefined) changes.members = [];
        else changes.remove.push(...memberIds(operation.value));
      } else if (operation.op === "add") {
        changes.add.push(...memberIds(operation.value));
      } else {
        changes.members = memberIds(operation.value);
      }
    } else if (path.toLowerCase() === "displayname" && !remove) {
      changes.displayName = toText(operation.value, "displayName");
    } else if (path.toLowerCase() === "externalid") {
      changes.externalId = remove ? null : toNullableText(operation.value, "externalId");
    } else if (!path) {
      if (remove || typeof operation.value !== "object" || operation.value === null) {
        throw new ScimError(400, "A value without a path must be an object", "invalidValue");
      }
      const object = operation.value as Record<string, unknown>;
      if ("displayName" in object) changes.displayName = toText(object.displayName, "displayName");
      if ("externalId" in object)
        changes.externalId = toNullableText(object.externalId, "externalId");
      if ("members" in object) {
        if (operation.op === "add") changes.add.push(...memberIds(object.members));
        else changes.members = memberIds(object.members);
      }
    }
    // Any other path names an attribute Hay does not store.
  }
  return changes;
}

const groupBody = z
  .object({
    displayName: z.string().min(1).max(255),
    externalId: z.string().max(255).nullish(),
    members: z.array(z.unknown()).max(MAX_MEMBERS).optional(),
  })
  .passthrough();

export function parseGroupBody(body: unknown): {
  displayName: string;
  externalId: string | null;
  members: string[];
} {
  const parsed = groupBody.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "The group needs a displayName", "invalidSyntax");
  return {
    displayName: parsed.data.displayName,
    externalId: parsed.data.externalId ?? null,
    members: memberIds(parsed.data.members),
  };
}
