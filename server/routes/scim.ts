import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { getClientIp } from "@server/lib/client-ip";
import { createLogger } from "@server/lib/logger";
import { ScimError } from "@server/lib/scim/errors";
import {
  parseGroupBody,
  parseGroupPatch,
  parseUserBody,
  parseUserPatch,
} from "@server/lib/scim/patch";
import { auditLogService } from "@server/services/audit-log.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import {
  SCIM_GROUP_SCHEMA,
  SCIM_MAX_PAGE,
  SCIM_USER_SCHEMA,
  scimBaseUrl,
  scimService,
  type ScimActor,
  type ScimPage,
} from "@server/services/scim.service";

/**
 * SCIM 2.0 (RFC 7643 and 7644) for one organization per bearer token. Every
 * handler works from `res.locals.scim`, which the token fixes, and never from
 * anything in the request that names an organization.
 */

const logger = createLogger("scim-routes");
const router = Router();

const SCIM_CONTENT_TYPE = "application/scim+json; charset=utf-8";
const TOKEN_REQUESTS_PER_MINUTE = 600;
const BODY_LIMIT = "256kb";

function send(res: Response, status: number, body?: unknown): void {
  res.status(status);
  res.setHeader("Content-Type", SCIM_CONTENT_TYPE);
  res.setHeader("Cache-Control", "no-store");
  if (body === undefined) res.end();
  else res.send(JSON.stringify(body));
}

function actorOf(res: Response): ScimActor {
  return res.locals.scim as ScimActor;
}

type Handler = (req: Request, res: Response) => Promise<void>;

/** Express 4 does not catch a rejected promise from a handler. */
function handle(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

async function authenticateRequest(req: Request, res: Response): Promise<void> {
  const ipAddress = getClientIp(req.headers, req.socket.remoteAddress);
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const identity = match ? await scimService.authenticate(match[1]) : null;
  if (!identity) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="scim"');
    // A guessing client is slowed by address, and only the first failure of a window is recorded.
    const attempts = await rateLimitService.checkIpRateLimit(ipAddress || "unknown", 60, 15 * 60, {
      scope: "scim-auth",
      failClosed: true,
    });
    if (attempts.limited) throw new ScimError(429, "Too many requests");
    const first = !(
      await rateLimitService.checkKeyRateLimit(`scim-auth-audit:${ipAddress}`, 1, 15 * 60)
    ).limited;
    if (first) {
      await auditLogService.record({
        action: "scim.auth_failed",
        resource: "scim",
        status: "failure",
        ipAddress,
        userAgent: req.headers["user-agent"],
      });
    }
    throw new ScimError(401, "A valid bearer token is required");
  }
  const quota = await rateLimitService.checkKeyRateLimit(
    `scim:${identity.tokenId}`,
    TOKEN_REQUESTS_PER_MINUTE,
    60,
  );
  if (quota.limited) {
    res.setHeader("Retry-After", "60");
    throw new ScimError(429, "Too many requests");
  }
  const actor: ScimActor = {
    organizationId: identity.organizationId,
    tokenId: identity.tokenId,
    ipAddress,
    userAgent: req.headers["user-agent"],
  };
  res.locals.scim = actor;
  // Only JSON bodies are understood.
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    !req.is(["application/json", "application/scim+json"])
  ) {
    throw new ScimError(400, "The body must be application/scim+json", "invalidSyntax");
  }
}

router.use("/scim/v2", (req, res, next) => {
  authenticateRequest(req, res).then(() => next(), next);
});

// Bodies are read only once the token is known, and SCIM's own media type is understood.
router.use(
  "/scim/v2",
  express.json({ type: ["application/json", "application/scim+json"], limit: BODY_LIMIT }),
);

function pageOf(req: Request): ScimPage {
  const query = z
    .object({
      startIndex: z.coerce.number().int().optional(),
      count: z.coerce.number().int().optional(),
      filter: z.string().max(1000).optional(),
    })
    .safeParse(req.query);
  if (!query.success)
    throw new ScimError(400, "startIndex and count must be integers", "invalidValue");
  return {
    startIndex: Math.max(1, query.data.startIndex ?? 1),
    count: Math.min(SCIM_MAX_PAGE, Math.max(0, query.data.count ?? 100)),
    filter: query.data.filter,
  };
}

function idOf(req: Request): string {
  const id = z.string().uuid().safeParse(req.params.id);
  // An id that cannot exist is the same answer as one that does not.
  if (!id.success) throw new ScimError(404, "Resource not found");
  return id.data;
}

function created(res: Response, resource: { meta: { location: string } }): void {
  res.setHeader("Location", resource.meta.location);
  send(res, 201, resource);
}

// ---- Discovery ----

router.get(
  "/scim/v2/ServiceProviderConfig",
  handle(async (_req, res) => {
    send(res, 200, {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://docs.hay.chat",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: SCIM_MAX_PAGE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer token",
          description: "A token created by an organization owner under Settings, Single sign-on",
          specUri: "https://www.rfc-editor.org/rfc/rfc6750",
          primary: true,
        },
      ],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: `${scimBaseUrl()}/ServiceProviderConfig`,
      },
    });
  }),
);

const RESOURCE_TYPES = [
  {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "User",
    name: "User",
    endpoint: "/Users",
    description: "A person in this organization",
    schema: SCIM_USER_SCHEMA,
    meta: { resourceType: "ResourceType", location: `${scimBaseUrl()}/ResourceTypes/User` },
  },
  {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "Group",
    name: "Group",
    endpoint: "/Groups",
    description: "A group whose name maps to a role",
    schema: SCIM_GROUP_SCHEMA,
    meta: { resourceType: "ResourceType", location: `${scimBaseUrl()}/ResourceTypes/Group` },
  },
];

function attribute(
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    type,
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: "none",
    ...extra,
  };
}

const SCHEMAS = [
  {
    id: SCIM_USER_SCHEMA,
    name: "User",
    description: "A person in this organization",
    attributes: [
      attribute("userName", "string", { required: true, uniqueness: "server" }),
      attribute("externalId", "string", { caseExact: true }),
      attribute("active", "boolean"),
      attribute("displayName", "string", { mutability: "readOnly" }),
      attribute("name", "complex", {
        subAttributes: [attribute("givenName", "string"), attribute("familyName", "string")],
      }),
      attribute("emails", "complex", {
        multiValued: true,
        mutability: "readOnly",
        subAttributes: [attribute("value", "string"), attribute("primary", "boolean")],
      }),
      attribute("groups", "complex", {
        multiValued: true,
        mutability: "readOnly",
        subAttributes: [attribute("value", "string"), attribute("display", "string")],
      }),
    ],
    meta: { resourceType: "Schema", location: `${scimBaseUrl()}/Schemas/${SCIM_USER_SCHEMA}` },
  },
  {
    id: SCIM_GROUP_SCHEMA,
    name: "Group",
    description: "A group whose name maps to a role",
    attributes: [
      attribute("displayName", "string", { required: true, uniqueness: "server" }),
      attribute("externalId", "string", { caseExact: true }),
      attribute("members", "complex", {
        multiValued: true,
        subAttributes: [attribute("value", "string", { mutability: "immutable" })],
      }),
    ],
    meta: { resourceType: "Schema", location: `${scimBaseUrl()}/Schemas/${SCIM_GROUP_SCHEMA}` },
  },
].map((schema) => ({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"], ...schema }));

function listOf(resources: unknown[]) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

router.get(
  "/scim/v2/ResourceTypes",
  handle(async (_req, res) => send(res, 200, listOf(RESOURCE_TYPES))),
);
router.get(
  "/scim/v2/ResourceTypes/:id",
  handle(async (req, res) => {
    const found = RESOURCE_TYPES.find((type) => type.id === req.params.id);
    if (!found) throw new ScimError(404, "Resource type not found");
    send(res, 200, found);
  }),
);
router.get(
  "/scim/v2/Schemas",
  handle(async (_req, res) => send(res, 200, listOf(SCHEMAS))),
);
router.get(
  "/scim/v2/Schemas/:id",
  handle(async (req, res) => {
    const found = SCHEMAS.find((schema) => schema.id === req.params.id);
    if (!found) throw new ScimError(404, "Schema not found");
    send(res, 200, found);
  }),
);

// ---- Users ----

router.get(
  "/scim/v2/Users",
  handle(async (req, res) => {
    send(res, 200, await scimService.listUsers(actorOf(res).organizationId, pageOf(req)));
  }),
);

router.get(
  "/scim/v2/Users/:id",
  handle(async (req, res) => {
    send(res, 200, await scimService.getUser(actorOf(res).organizationId, idOf(req)));
  }),
);

router.post(
  "/scim/v2/Users",
  handle(async (req, res) => {
    const input = parseUserBody(req.body);
    if (!input.userName) {
      throw new ScimError(400, "userName is required", "invalidValue");
    }
    created(
      res,
      await scimService.createUser(actorOf(res), { ...input, userName: input.userName }),
    );
  }),
);

router.put(
  "/scim/v2/Users/:id",
  handle(async (req, res) => {
    const input = parseUserBody(req.body);
    // A replace sets every attribute the body names; one it leaves out stays as it is.
    send(res, 200, await scimService.updateUser(actorOf(res), idOf(req), input));
  }),
);

router.patch(
  "/scim/v2/Users/:id",
  handle(async (req, res) => {
    send(res, 200, await scimService.updateUser(actorOf(res), idOf(req), parseUserPatch(req.body)));
  }),
);

router.delete(
  "/scim/v2/Users/:id",
  handle(async (req, res) => {
    await scimService.deprovision(actorOf(res), idOf(req), { remove: true });
    send(res, 204);
  }),
);

// ---- Groups ----

router.get(
  "/scim/v2/Groups",
  handle(async (req, res) => {
    send(res, 200, await scimService.listGroups(actorOf(res).organizationId, pageOf(req)));
  }),
);

router.get(
  "/scim/v2/Groups/:id",
  handle(async (req, res) => {
    send(res, 200, await scimService.getGroup(actorOf(res).organizationId, idOf(req)));
  }),
);

router.post(
  "/scim/v2/Groups",
  handle(async (req, res) => {
    created(res, await scimService.createGroup(actorOf(res), parseGroupBody(req.body)));
  }),
);

router.put(
  "/scim/v2/Groups/:id",
  handle(async (req, res) => {
    const input = parseGroupBody(req.body);
    send(
      res,
      200,
      await scimService.updateGroup(actorOf(res), idOf(req), {
        displayName: input.displayName,
        externalId: input.externalId,
        members: input.members,
      }),
    );
  }),
);

router.patch(
  "/scim/v2/Groups/:id",
  handle(async (req, res) => {
    send(
      res,
      200,
      await scimService.updateGroup(actorOf(res), idOf(req), parseGroupPatch(req.body)),
    );
  }),
);

router.delete(
  "/scim/v2/Groups/:id",
  handle(async (req, res) => {
    await scimService.deleteGroup(actorOf(res), idOf(req));
    send(res, 204);
  }),
);

router.use("/scim/v2", (_req, _res, next) => next(new ScimError(404, "Resource not found")));

// Errors in the SCIM shape, whatever raised them.
router.use("/scim/v2", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ScimError) return send(res, error.status, error);
  const parseError = error as { type?: string; status?: number };
  if (parseError.type === "entity.too.large") {
    return send(res, 413, new ScimError(413, "The request body is too large"));
  }
  if (parseError.type === "entity.parse.failed") {
    return send(res, 400, new ScimError(400, "The body is not valid JSON", "invalidSyntax"));
  }
  logger.error({ err: error }, "SCIM request failed");
  return send(res, 500, new ScimError(500, "The request could not be completed"));
});

export default router;
