import * as crypto from "crypto";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { Organization } from "@server/entities/organization.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { hashPassword } from "@server/lib/auth/utils/hashing";
import { organizationService } from "@server/services/organization.service";
import { emailService } from "@server/services/email.service";
import { getDashboardUrl } from "@server/config/env";
import { DEFAULT_LANGUAGE } from "@server/types/language.types";
import { DEFAULT_NEW_ORG_RETENTION_DAYS } from "@server/types/organization-settings.types";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface NewAccountInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** Creates an organization owned by the new user when set. */
  organizationName?: string;
  emailVerified?: boolean;
}

/**
 * Create a user (and, when `organizationName` is set, an organization they own).
 * The caller checks that the email is free and decides whether to issue a session.
 */
export async function createAccount(
  manager: EntityManager,
  input: NewAccountInput,
): Promise<{ user: User; organization: Organization | null }> {
  let organization: Organization | null = null;
  if (input.organizationName) {
    const organizationRepository = manager.getRepository(Organization);
    organization = organizationRepository.create({
      name: input.organizationName,
      slug: await organizationService.generateUniqueSlug(input.organizationName),
      isActive: true,
      limits: {
        maxUsers: 5,
        maxDocuments: 100,
        maxApiKeys: 10,
        maxJobs: 50,
        maxStorageGb: 1,
      },
      settings: { retentionDays: DEFAULT_NEW_ORG_RETENTION_DAYS },
    });
    await organizationRepository.save(organization);
  }

  const userRepository = manager.getRepository(User);
  const user = userRepository.create({
    email: input.email.toLowerCase(),
    password: await hashPassword(input.password),
    firstName: input.firstName || undefined,
    lastName: input.lastName || undefined,
    isActive: true,
    emailVerified: input.emailVerified ?? false,
    organizationId: organization?.id,
    role: organization ? "owner" : "member",
  });
  user.updateLastSeen();
  await userRepository.save(user);

  if (organization) {
    const userOrgRepository = manager.getRepository(UserOrganization);
    await userOrgRepository.save(
      userOrgRepository.create({
        userId: user.id,
        organizationId: organization.id,
        role: "owner",
        isActive: true,
        joinedAt: new Date(),
      }),
    );
  }

  return { user, organization };
}

/**
 * Start (or restart) signup email verification: stores the token hash on the
 * user and returns the plain token. Clears any pending email change so a signup
 * token can never complete an email change, and vice versa.
 */
export async function issueSignupVerificationToken(user: User): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  user.emailVerificationTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  user.pendingEmail = null;
  await AppDataSource.getRepository(User).update(user.id, {
    emailVerificationTokenHash: user.emailVerificationTokenHash,
    emailVerificationExpiresAt: user.emailVerificationExpiresAt,
    pendingEmail: null,
  });
  return token;
}

/** Email the signup verification link to the user. */
export async function sendSignupVerificationEmail(user: User, token: string): Promise<void> {
  await emailService.initialize();

  const userOrg = await AppDataSource.getRepository(UserOrganization).findOne({
    where: { userId: user.id },
    relations: ["organization"],
  });
  const locale = userOrg?.organization?.defaultLanguage || DEFAULT_LANGUAGE;

  await emailService.sendTemplateEmail({
    to: user.email,
    locale,
    template: "verify-signup-email",
    variables: {
      userName: user.getFullName(),
      verificationUrl: `${getDashboardUrl()}/verify-email?token=${token}&type=signup`,
      companyName: "Hay.chat",
      currentYear: new Date().getFullYear().toString(),
      companyAddress: "Hay.chat",
      websiteUrl: "https://hay.chat",
    },
  });
}
