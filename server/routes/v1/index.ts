import { router } from "@server/trpc";
import { authRouter } from "./auth";
import { documentsRouter } from "./documents";
import { documentSourcesRouter } from "./document-sources";
import { playbooksRouter } from "./playbooks";
import { conversationsRouter } from "./conversations";
import { embeddingsRouter } from "./embeddings";
import { customersRouter } from "./customers";
import { pluginsRouter } from "./plugins";
import { publicConversationsRouter } from "./public-conversations";
import { analyticsRouter } from "./analytics";
import { organizationsRouter } from "./organizations";
import { invitationsRouter } from "./invitations";
import { sourcesRouter } from "./sources";
import { messageFeedbackRouter } from "./message-feedback";
import { setupRouter } from "./setup";
import { privacyRouter } from "./privacy";
import { customerPrivacyRouter } from "./customer-privacy";
import { apiTokensRouter } from "./api-tokens";
import { auditLogsRouter } from "./audit-logs";
import { webchatRouter } from "./webchat";
import { pluginApiTrpcRouter } from "./plugin-api/trpc";
import { gitConnectionsRouter } from "./git-connections";
import { docsAuditRouter } from "./docs-audit";
import { productsRouter } from "./products";
import { internalRouter } from "./internal";
import { notificationsRouter } from "./notifications";
import { actionsRouter } from "./actions";
import { businessHoursRouter } from "./business-hours";
import { usageRouter } from "./usage";
import { organizationExportRouter } from "./organization-export";
import { evidencePacksRouter } from "./evidence-packs";
import { disputesRouter } from "./disputes";
import { emailDomainsRouter } from "./email-domains";
import { insightsRouter } from "./insights";
import { simulationsRouter } from "./simulations";
import { testTranscriptsRouter } from "./test-transcripts";
import { replaysRouter } from "./replays";
import { testCasesRouter } from "./test-cases";
import { teamQuestionsRouter } from "./team-questions";

// Core routers - always available
const coreRouters = {
  auth: authRouter,
  internal: internalRouter,
  documents: documentsRouter,
  documentSources: documentSourcesRouter,
  playbooks: playbooksRouter,
  conversations: conversationsRouter,
  embeddings: embeddingsRouter,
  customers: customersRouter,
  plugins: pluginsRouter,
  publicConversations: publicConversationsRouter,
  analytics: analyticsRouter,
  organizations: organizationsRouter,
  invitations: invitationsRouter,
  sources: sourcesRouter,
  messageFeedback: messageFeedbackRouter,
  setup: setupRouter,
  privacy: privacyRouter,
  customerPrivacy: customerPrivacyRouter,
  apiTokens: apiTokensRouter,
  auditLogs: auditLogsRouter,
  webchat: webchatRouter,
  pluginApi: pluginApiTrpcRouter,
  gitConnections: gitConnectionsRouter,
  docsAudit: docsAuditRouter,
  products: productsRouter,
  notifications: notificationsRouter,
  actions: actionsRouter,
  businessHours: businessHoursRouter,
  usage: usageRouter,
  organizationExport: organizationExportRouter,
  evidencePacks: evidencePacksRouter,
  disputes: disputesRouter,
  emailDomains: emailDomainsRouter,
  insights: insightsRouter,
  simulations: simulationsRouter,
  testTranscripts: testTranscriptsRouter,
  replays: replaysRouter,
  testCases: testCasesRouter,
  teamQuestions: teamQuestionsRouter,
};

export const v1Router = router(coreRouters);

export type V1Router = typeof v1Router;
