#!/usr/bin/env node
/**
 * Seeds the "Casa Aurora" organization the docs screenshots are taken from, then writes the
 * Playwright login state for it. `npm run docs:screenshots` (repo root) runs this first; see
 * tests/docs-screenshots/README.md.
 *
 * Refuses to run unless NODE_ENV=development and the database is on this machine: it deletes and
 * recreates its own organization.
 *
 * Every run deletes the previous docs org (matched by DOCS_ORG_SLUG) and builds it again, so the
 * screenshots always start from the same data. Timestamps are relative to "now" so the Inbox wait
 * times, the dashboard's last-30-days charts and "x minutes ago" labels read the same on every run.
 *
 * Content follows tools/demo-account/company/brand.md (the Casa Aurora home-goods brand).
 */
import * as fs from "fs";
import * as path from "path";
import { AppDataSource } from "../database/data-source";
import { config } from "../config/env";
import { Organization } from "../entities/organization.entity";
import { User } from "../entities/user.entity";
import { UserOrganization } from "../entities/user-organization.entity";
import {
  Document,
  DocumentationStatus,
  DocumentationType,
  DocumentVisibility,
  ImportMethod,
} from "../entities/document.entity";
import { Customer } from "../database/entities/customer.entity";
import { Conversation, type ConversationStatus } from "../database/entities/conversation.entity";
import {
  Message,
  MessageDirection,
  MessageSentiment,
  MessageType,
} from "../database/entities/message.entity";
import { Playbook, PlaybookKind, PlaybookStatus } from "../database/entities/playbook.entity";
import { TeamQuestion } from "../database/entities/team-question.entity";
import { PendingAction } from "../database/entities/pending-action.entity";
import { ConversationOutcome } from "../database/entities/conversation-outcome.entity";
import { authSessionService } from "../services/auth-session.service";
import type { AuthTokens } from "../types/auth.types";
import { hashPassword } from "../lib/auth/utils/hashing";

export const DOCS_ORG_SLUG = "docs-screenshots-casa-aurora";
export const DOCS_USER_EMAIL = "ana@casa-aurora.example.com";
export const DOCS_TEAMMATE_EMAIL = "tom@casa-aurora.example.com";
export const DOCS_PASSWORD = "DocsShots@123456";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const REPO_ROOT = path.resolve(__dirname, "../..");
// Keep in sync with tests/docs-screenshots/paths.ts.
const AUTH_STATE_PATH = path.join(REPO_ROOT, "playwright/.auth/docs.json");
const SEED_IDS_PATH = path.join(REPO_ROOT, "playwright/.auth/docs-ids.json");
const DASHBOARD_URL = process.env.PLAYWRIGHT_DASHBOARD_URL ?? "http://localhost:3000";

export interface DocsSeed {
  user: User;
  organization: Organization;
  tokens: AuthTokens;
  /** Ids the shots open directly (e.g. a conversation detail page). */
  ids: { featuredConversationId: string; playbookId: string; documentId: string };
}

type Line = {
  type: MessageType;
  content: string;
  /** Minutes before the conversation's last message. */
  ago: number;
  sentiment?: MessageSentiment;
  metadata?: Message["metadata"];
};

const customer = (text: string, ago: number, sentiment = MessageSentiment.NEUTRAL): Line => ({
  type: MessageType.CUSTOMER,
  content: text,
  ago,
  sentiment,
});
const ai = (text: string, ago: number, metadata?: Message["metadata"]): Line => ({
  type: MessageType.BOT_AGENT,
  content: text,
  ago,
  metadata: { confidence: 0.91, confidenceTier: "high", ...metadata },
});
const human = (text: string, ago: number): Line => ({
  type: MessageType.HUMAN_AGENT,
  content: text,
  ago,
});

async function removePrevious(): Promise<void> {
  const orgs = await AppDataSource.getRepository(Organization).find({
    where: { slug: DOCS_ORG_SLUG },
  });
  const orgIds = orgs.map((o) => o.id);
  // Users first: their organization_id points at the org.
  await AppDataSource.query(
    `DELETE FROM users WHERE email = ANY($1) OR organization_id = ANY($2::uuid[])`,
    [[DOCS_USER_EMAIL, DOCS_TEAMMATE_EMAIL], orgIds],
  );
  if (orgIds.length) {
    await AppDataSource.query(
      `DELETE FROM plugin_instances WHERE organization_id = ANY($1::uuid[])`,
      [orgIds],
    );
    await AppDataSource.getRepository(Organization).delete(orgIds);
  }
}

export async function seedDocsOrg(): Promise<DocsSeed> {
  await removePrevious();
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo);
  const password = await hashPassword(DOCS_PASSWORD);

  const seeded = await AppDataSource.transaction(async (m) => {
    // --- Organization and team ---------------------------------------------------------------
    const organization = await m.getRepository(Organization).save(
      m.getRepository(Organization).create({
        name: "Casa Aurora",
        slug: DOCS_ORG_SLUG,
        isActive: true,
        website: "https://casa-aurora.example.com",
        assistantName: "Aurora",
        limits: { maxUsers: 10, maxDocuments: 100, maxApiKeys: 10, maxJobs: 50, maxStorageGb: 1 },
        // A finished setup hides the Setup nav item and the /setup redirect.
        settings: {
          setup: {
            toolPluginIds: [],
            channels: ["webchat"],
            questions: [],
            answeredAt: at(40 * DAY).toISOString(),
            finishedAt: at(40 * DAY).toISOString(),
          },
        },
      }),
    );

    const makeUser = async (
      email: string,
      firstName: string,
      lastName: string,
      role: User["role"],
    ) => {
      const user = m.getRepository(User).create({
        email,
        password,
        firstName,
        lastName,
        isActive: true,
        emailVerified: true,
        organizationId: organization.id,
        role,
      });
      user.updateLastSeen();
      await m.getRepository(User).save(user);
      await m.getRepository(UserOrganization).save(
        m.getRepository(UserOrganization).create({
          userId: user.id,
          organizationId: organization.id,
          role,
          isActive: true,
          joinedAt: at(40 * DAY),
        }),
      );
      return user;
    };
    const user = await makeUser(DOCS_USER_EMAIL, "Ana", "Ribeiro", "owner");
    const teammate = await makeUser(DOCS_TEAMMATE_EMAIL, "Tom", "Becker", "admin");

    // --- Knowledge -----------------------------------------------------------------------------
    const docs: Array<[string, DocumentationType, ImportMethod, string | undefined, number]> = [
      [
        "Shipping and delivery times",
        DocumentationType.POLICY,
        ImportMethod.WEB,
        "https://casa-aurora.example.com/shipping",
        2,
      ],
      [
        "Returns and refunds policy",
        DocumentationType.POLICY,
        ImportMethod.WEB,
        "https://casa-aurora.example.com/returns",
        3,
      ],
      [
        "Caring for solid oak furniture",
        DocumentationType.GUIDE,
        ImportMethod.EDITOR,
        undefined,
        6,
      ],
      ["Candle safety and burn times", DocumentationType.FAQ, ImportMethod.UPLOAD, undefined, 9],
      ["Damaged or missing items", DocumentationType.ARTICLE, ImportMethod.EDITOR, undefined, 12],
      [
        "Wholesale and bulk orders",
        DocumentationType.REFERENCE,
        ImportMethod.UPLOAD,
        undefined,
        20,
      ],
    ];
    const documents: Document[] = [];
    for (const [title, type, importMethod, sourceUrl, daysAgo] of docs) {
      const doc = m.getRepository(Document).create({
        title,
        description: `${title} for Casa Aurora shoppers.`,
        type,
        status: DocumentationStatus.PUBLISHED,
        visibility: DocumentVisibility.PUBLIC,
        importMethod,
        sourceUrl,
        content: `# ${title}\n\nPlaceholder content for documentation screenshots.`,
        organizationId: organization.id,
      });
      documents.push(await m.getRepository(Document).save(doc));
      await m.query(`UPDATE documents SET created_at = $1, updated_at = $1 WHERE id = $2`, [
        at(daysAgo * DAY),
        doc.id,
      ]);
    }

    // --- Playbooks -----------------------------------------------------------------------------
    const playbookRows: Array<[string, string, string, PlaybookStatus, PlaybookKind]> = [
      [
        "Welcome",
        "The conversation starts",
        "Greets the shopper and asks how Aurora can help.",
        PlaybookStatus.ACTIVE,
        PlaybookKind.WELCOME,
      ],
      [
        "Where is my order?",
        "The customer asks about an order's status or tracking",
        "Looks up the order and shares tracking, or escalates stale tracking after 10 days.",
        PlaybookStatus.ACTIVE,
        PlaybookKind.CUSTOM,
      ],
      [
        "Damaged item",
        "The customer says an item arrived broken or damaged",
        "Collects photos, then offers a replacement or a refund that needs approval.",
        PlaybookStatus.ACTIVE,
        PlaybookKind.CUSTOM,
      ],
      [
        "Change delivery address",
        "The customer wants to change where an order is delivered",
        "Updates the address if the order hasn't shipped yet; hands off otherwise.",
        PlaybookStatus.ACTIVE,
        PlaybookKind.CUSTOM,
      ],
      [
        "Wholesale enquiry",
        "The customer asks about bulk or trade pricing",
        "Collects company details and hands the lead to the team.",
        PlaybookStatus.DRAFT,
        PlaybookKind.CUSTOM,
      ],
    ];
    const playbooks: Playbook[] = [];
    for (const [i, [title, trigger, description, status, kind]] of playbookRows.entries()) {
      const pb = await m.getRepository(Playbook).save(
        m.getRepository(Playbook).create({
          title,
          trigger,
          description,
          status,
          kind,
          instructions: description,
          organization_id: organization.id,
        }),
      );
      await m.query(`UPDATE playbooks SET created_at = $1, updated_at = $1 WHERE id = $2`, [
        at((30 - i * 4) * DAY),
        pb.id,
      ]);
      playbooks.push(pb);
    }

    // --- Customers -----------------------------------------------------------------------------
    const customerNames = [
      "Priya Shah",
      "Lucas Martin",
      "Emma Walsh",
      "Noah Fischer",
      "Sofia Rossi",
      "Liam O'Connor",
      "Mia Novak",
      "Oliver Bennett",
      "Chloe Dubois",
      "Ethan Park",
    ];
    const customers: Customer[] = [];
    for (const name of customerNames) {
      customers.push(
        await m.getRepository(Customer).save(
          m.getRepository(Customer).create({
            name,
            email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
            organization_id: organization.id,
          }),
        ),
      );
    }

    // --- Conversations -------------------------------------------------------------------------
    const addConversation = async (opts: {
      title: string;
      summary: string;
      status: ConversationStatus;
      channel?: string;
      customer: Customer;
      lastMessageAgo: number;
      lines: Line[];
      assignedUserId?: string;
      createdAgo?: number;
    }): Promise<Conversation> => {
      const last = now - opts.lastMessageAgo;
      const firstAgo = Math.max(...opts.lines.map((l) => l.ago));
      const createdAt =
        opts.createdAgo !== undefined
          ? at(opts.createdAgo)
          : new Date(last - firstAgo * MINUTE - MINUTE);
      const closed =
        opts.status === "resolved" || opts.status === "closed" || opts.status === "unresolved";
      const handedOff = ["pending-human", "human-took-over"].includes(opts.status);
      const conversation = await m.getRepository(Conversation).save(
        m.getRepository(Conversation).create({
          title: opts.title,
          summary: opts.summary,
          status: opts.status,
          channel: opts.channel ?? "web",
          organization_id: organization.id,
          customer_id: opts.customer.id,
          assigned_user_id: opts.assignedUserId ?? null,
          assigned_at: opts.assignedUserId ? new Date(last) : null,
          handed_off_at: handedOff ? new Date(last) : null,
          lastMessageAt: new Date(last),
          ended_at: closed ? new Date(last + 2 * MINUTE) : null,
          closed_at: closed ? new Date(last + 2 * MINUTE) : null,
          language: "en",
          document_ids: [],
          metadata: null,
        }),
      );
      await m.query(`UPDATE conversations SET created_at = $1, updated_at = $2 WHERE id = $3`, [
        createdAt,
        new Date(last),
        conversation.id,
      ]);
      for (const line of opts.lines) {
        const createdAtMsg = new Date(last - line.ago * MINUTE);
        const msg = await m.getRepository(Message).save(
          m.getRepository(Message).create({
            conversation_id: conversation.id,
            content: line.content,
            type: line.type,
            direction:
              line.type === MessageType.CUSTOMER ? MessageDirection.IN : MessageDirection.OUT,
            sentiment: line.sentiment ?? null,
            sender: line.type === MessageType.HUMAN_AGENT ? (opts.assignedUserId ?? user.id) : null,
            metadata: line.metadata ?? null,
          }),
        );
        await m.query(`UPDATE messages SET created_at = $1, updated_at = $1 WHERE id = $2`, [
          createdAtMsg,
          msg.id,
        ]);
      }
      return conversation;
    };

    const [priya, lucas, emma, noah, sofia, liam] = customers;

    // Waiting for a human
    const damaged = await addConversation({
      title: "Ceramic lamp arrived cracked",
      summary:
        "Priya's Lumen ceramic lamp (order #1042) arrived with a cracked base. She sent photos and wants a replacement before Friday.",
      status: "pending-human",
      customer: priya,
      lastMessageAgo: 14 * MINUTE,
      lines: [
        customer(
          "Hi, my Lumen lamp just arrived and the base is cracked 😞",
          9,
          MessageSentiment.NEGATIVE,
        ),
        ai(
          "I'm sorry it arrived damaged, Priya. Could you send a photo of the crack and the box it came in?",
          8,
          {
            playbookTitle: "Damaged item",
          },
        ),
        customer(
          "Sure, here you go. I need it for a dinner on Friday, can you send a new one?",
          5,
          MessageSentiment.NEGATIVE,
        ),
        {
          type: MessageType.TOOL,
          content: "Looked up order #1042",
          ago: 4,
          metadata: {
            toolName: "get_order",
            toolInput: { orderNumber: "1042" },
            toolStatus: "SUCCESS",
            toolOutput: { status: "delivered" },
          },
        },
        ai(
          "Thanks for the photos. Express replacements need a teammate's OK, so I've passed this to the team. Someone will reply here shortly.",
          3,
          {
            isHandoffMessage: true,
          },
        ),
      ],
    });
    await addConversation({
      title: "Order hasn't arrived after 12 days",
      summary:
        "Lucas's order #1037 has shown \"in transit\" since 12 days ago. Tracking hasn't updated; he asks whether to expect it.",
      status: "pending-human",
      channel: "whatsapp",
      customer: lucas,
      lastMessageAgo: 6 * MINUTE,
      lines: [
        customer(
          "My order 1037 still says in transit. It's been almost two weeks.",
          4,
          MessageSentiment.NEGATIVE,
        ),
        ai(
          "The tracking for order #1037 hasn't moved in 12 days, which is longer than usual. I've asked the team to check with the carrier.",
          2,
        ),
      ],
    });

    // You're handling / teammate handling
    await addConversation({
      title: "Change delivery address",
      summary:
        "Emma moved flats and needs order #1051 delivered to her new address. The order has already shipped.",
      status: "human-took-over",
      customer: emma,
      assignedUserId: user.id,
      lastMessageAgo: 22 * MINUTE,
      lines: [
        customer("Can I change the address on order 1051? I've just moved.", 10),
        ai(
          "Order #1051 has already shipped, so I can't change the address myself. I'm bringing in a teammate.",
          9,
        ),
        human("Hi Emma, Ana here. I'll ask the carrier to redirect it. What's the new address?", 2),
      ],
    });
    await addConversation({
      title: "Bulk order for a boutique hotel",
      summary:
        "Noah wants 40 Aurora candles and 12 throws for a hotel opening. Asked for trade pricing.",
      status: "human-took-over",
      customer: noah,
      assignedUserId: teammate.id,
      lastMessageAgo: 48 * MINUTE,
      lines: [
        customer(
          "We're opening a small hotel and would like 40 candles and 12 throws. Do you do trade pricing?",
          6,
        ),
        human("Hi Noah, Tom here. Yes, we do. I'll send you our trade sheet now.", 1),
      ],
    });

    // Waiting for approval
    const refundConversation = await addConversation({
      title: "Refund for a chipped vase",
      summary:
        "Sofia's Terra vase (order #1029) arrived chipped. The AI offered a refund of €89.00, waiting for approval.",
      status: "awaiting-approval",
      customer: sofia,
      lastMessageAgo: 11 * MINUTE,
      lines: [
        customer(
          "The Terra vase I ordered has a chip on the rim. I'd like a refund please.",
          5,
          MessageSentiment.NEGATIVE,
        ),
        ai(
          "I'm sorry about that, Sofia. I've requested a full refund of €89.00 for order #1029. A teammate will confirm it shortly.",
          2,
        ),
      ],
    });
    await m.getRepository(PendingAction).save(
      m.getRepository(PendingAction).create({
        organization_id: organization.id,
        conversation_id: refundConversation.id,
        tool_name: "refund_order",
        category: "refund",
        args: { orderNumber: "1029", amount: 89, currency: "EUR", reason: "Item arrived chipped" },
        amount: 89,
        hold_reason: "money_move",
        status: "pending",
        idempotency_key: `docs-${refundConversation.id}`,
        expires_at: at(-2 * DAY),
      }),
    );

    // Question for the team
    const questionConversation = await addConversation({
      title: "Is the oak table finished with oil?",
      summary: "Liam asks what finish the Solace oak dining table has before buying.",
      status: "open",
      customer: liam,
      lastMessageAgo: 3 * MINUTE,
      lines: [
        customer("Is the Solace oak table finished with oil or lacquer? We have a toddler.", 2),
        ai(
          "Good question. I'm checking with the team and will get back to you here in a moment.",
          1,
          {
            isTeamQuestionMessage: true,
          },
        ),
      ],
    });
    await m.getRepository(TeamQuestion).save(
      m.getRepository(TeamQuestion).create({
        organizationId: organization.id,
        conversationId: questionConversation.id,
        question: "What finish does the Solace oak dining table have: oil or lacquer?",
        customerMessage: "Is the Solace oak table finished with oil or lacquer? We have a toddler.",
        language: "en",
        status: "open",
        askedAt: at(4 * MINUTE),
      }),
    );

    // History: resolved conversations across the last 30 days for the dashboard charts.
    const topics: Array<[string, string, string]> = [
      [
        "Where is my order?",
        "When will order #10{n} arrive?",
        "Order #10{n} is out for delivery and should arrive today.",
      ],
      [
        "Return a throw",
        "How do I return a throw that doesn't match my sofa?",
        "You can return it within 30 days. I've emailed you a prepaid label.",
      ],
      [
        "Candle burn time",
        "How long does the Aurora candle burn?",
        "About 45 hours. Trim the wick to 5 mm before each burn.",
      ],
      [
        "Oak table care",
        "How do I clean the oak table?",
        "Wipe it with a damp cloth and re-oil it twice a year.",
      ],
      [
        "Discount code not working",
        "My code WELCOME10 isn't working.",
        "WELCOME10 works on full-price items only. It's applied now.",
      ],
    ];
    let n = 0;
    for (let day = 30; day >= 1; day--) {
      // Busier mid-week, quieter at weekends, slowly growing: reads like a real shop.
      const weekday = new Date(now - day * DAY).getDay();
      const perDay =
        (weekday === 0 || weekday === 6 ? 2 : 4) + (day < 15 ? 1 : 0) + (day % 5 === 0 ? 1 : 0);
      for (let k = 0; k < perDay; k++) {
        n++;
        const [title, question, answer] = topics[n % topics.length];
        const handled = n % 6 === 0;
        const ago = day * DAY + (k * 3 + 1) * HOUR;
        const conv = await addConversation({
          title,
          summary: `${question} Answered by ${handled ? "the team" : "Aurora"}.`,
          status: n % 9 === 0 ? "closed" : "resolved",
          customer: customers[n % customers.length],
          lastMessageAgo: ago,
          createdAgo: ago + 4 * MINUTE,
          lines: [
            customer(
              question.replace("{n}", String(10 + (n % 80))),
              3,
              n % 5 === 0 ? MessageSentiment.POSITIVE : MessageSentiment.NEUTRAL,
            ),
            handled
              ? human(answer.replace("{n}", String(10 + (n % 80))), 1)
              : ai(answer.replace("{n}", String(10 + (n % 80))), 1),
            customer("Thank you!", 0, MessageSentiment.POSITIVE),
          ],
        });
        await m.getRepository(ConversationOutcome).save(
          m.getRepository(ConversationOutcome).create({
            organization_id: organization.id,
            conversation_id: conv.id,
            closed_at: new Date(now - ago + 2 * MINUTE),
            close_status: "resolved",
            outcome: handled ? "human" : n % 4 === 0 ? "assumed" : "confirmed",
            billable: !handled,
            ai_resolved: !handled,
            handed_off: handled,
            classified_by: "rule",
          }),
        );
      }
    }

    return {
      user,
      organization,
      ids: {
        featuredConversationId: damaged.id,
        playbookId: playbooks[2].id,
        documentId: documents[0].id,
      },
    };
  });
  // A real login session, so the dashboard's token refresh works during the run.
  const tokens = await authSessionService.createSession(seeded.user);
  return { ...seeded, tokens };
}

/** Playwright storage state: the dashboard's persisted Pinia stores (see tests/helpers/auth.ts). */
function authState({ tokens, user, organization }: DocsSeed): object {
  const persisted = (name: string, value: unknown) => ({ name, value: JSON.stringify(value) });
  return {
    cookies: [],
    origins: [
      {
        origin: DASHBOARD_URL,
        localStorage: [
          persisted("auth", {
            tokens: {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt: Date.now() + tokens.expiresIn * 1000,
            },
            isAuthenticated: true,
            // false makes the dashboard call auth.me on load, which fills in fields the user store
            // doesn't persist (such as the email shown in the sidebar).
            isInitialized: false,
            lastActivity: Date.now(),
            isLoading: false,
          }),
          persisted("user", {
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              isActive: user.isActive,
              role: user.role,
            },
            activeOrganizationId: organization.id,
            organizations: [
              {
                id: organization.id,
                name: organization.name,
                slug: organization.slug,
                role: "owner",
                permissions: null,
                joinedAt: new Date().toISOString(),
              },
            ],
          }),
        ],
      },
    ],
  };
}

async function main() {
  const dbHost = process.env.DB_HOST || "localhost";
  if (!config.isDevelopment || !LOCAL_DB_HOSTS.has(dbHost)) {
    throw new Error(
      `Refusing to seed the docs screenshot org (NODE_ENV=${config.env}, DB_HOST=${dbHost}): ` +
        "it needs NODE_ENV=development and a local database.",
    );
  }
  await AppDataSource.initialize();
  try {
    const seed = await seedDocsOrg();
    fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(authState(seed), null, 2));
    fs.writeFileSync(SEED_IDS_PATH, JSON.stringify(seed.ids, null, 2));
    console.log(
      `Seeded "${seed.organization.name}" (${seed.organization.id}) for docs screenshots.`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
