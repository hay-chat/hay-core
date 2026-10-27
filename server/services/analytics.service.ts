import { AppDataSource } from "../database/data-source";
import { ConversationRepository } from "../repositories/conversation.repository";
import { MessageRepository } from "../repositories/message.repository";
import { DocumentRepository } from "../repositories/document.repository";
import { MessageSentiment } from "../database/entities/message.entity";
import { DocumentationStatus } from "../entities/document.entity";

export interface AnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  organizationId: string;
}

export interface ConversationActivityData {
  date: string;
  count: number;
  label: string;
}

export interface SentimentDistribution {
  sentiment: MessageSentiment;
  count: number;
  percentage: number;
}

export interface ResponseTimeAnalytics {
  /** Seconds. 0 when sampleSize is 0. */
  averageResponseTime: number;
  medianResponseTime: number;
  p95ResponseTime: number;
  /** Customer turns that got a reply; the metrics are meaningless at 0. */
  sampleSize: number;
}

export interface AgentPerformance {
  agentId: string;
  totalConversations: number;
  resolvedConversations: number;
  /** Same definition as the org-level rate: resolved / total, as a percentage. */
  resolutionRate: number;
}

/**
 * Appends created_at bounds for `column` to a raw query. Returns the clause
 * and pushes the values onto `params` so placeholders stay in sync.
 */
function dateRangeClause(
  column: string,
  params: unknown[],
  startDate?: Date,
  endDate?: Date,
): string {
  let clause = "";
  if (startDate) {
    params.push(startDate);
    clause += ` AND ${column} >= $${params.length}`;
  }
  if (endDate) {
    params.push(endDate);
    clause += ` AND ${column} <= $${params.length}`;
  }
  return clause;
}

export class AnalyticsService {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private documentRepository: DocumentRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.documentRepository = new DocumentRepository();
  }

  async getConversationActivity(filters: AnalyticsFilters): Promise<ConversationActivityData[]> {
    const { startDate, endDate, organizationId } = filters;

    // Default to last 30 days if no dates provided
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    return await this.conversationRepository.getDailyStats(organizationId, days, start, end);
  }

  async getSentimentAnalysis(filters: AnalyticsFilters): Promise<SentimentDistribution[]> {
    const { startDate, endDate, organizationId } = filters;

    // Get sentiment counts from the message repository
    const sentimentCounts = await this.messageRepository.getSentimentDistribution(
      organizationId,
      startDate,
      endDate,
    );

    // Calculate total and percentages
    const total = sentimentCounts.reduce((sum, item) => sum + item.count, 0);

    // Ensure all sentiments are included, even with 0 count
    const allSentiments = Object.values(MessageSentiment);
    const sentimentMap = new Map(sentimentCounts.map((item) => [item.sentiment, item.count]));

    return allSentiments.map((sentiment) => ({
      sentiment,
      count: sentimentMap.get(sentiment) || 0,
      percentage: total > 0 ? ((sentimentMap.get(sentiment) || 0) / total) * 100 : 0,
    }));
  }

  async getConversationMetrics(filters: AnalyticsFilters) {
    const { startDate, endDate, organizationId } = filters;

    // This can be extended with more metrics in the future
    const totalConversations = await this.conversationRepository.countByFilters({
      organizationId,
      startDate,
      endDate,
    });

    const resolvedConversations = await this.conversationRepository.countByFilters({
      organizationId,
      startDate,
      endDate,
      status: "resolved",
    });

    // What the backoffice meters. Unlike resolvedConversations it drops test,
    // unhappy and handed-off chats and is bounded by resolution time.
    const billableResolutions = await this.conversationRepository.countBillableResolutions({
      organizationId,
      startDate,
      endDate,
    });

    const avgMessagesPerConversation =
      await this.messageRepository.getAverageMessagesPerConversation(
        organizationId,
        startDate,
        endDate,
      );

    return {
      totalConversations,
      resolvedConversations,
      billableResolutions,
      resolutionRate:
        totalConversations > 0 ? (resolvedConversations / totalConversations) * 100 : 0,
      avgMessagesPerConversation,
    };
  }

  async getDocumentStatusCounts(
    organizationId: string,
  ): Promise<Array<{ status: string; count: number }>> {
    const statusCounts = await this.documentRepository.getStatusCounts(organizationId);

    // Ensure all statuses are represented, even with 0 count
    const allStatuses = Object.values(DocumentationStatus);
    const statusMap = new Map(statusCounts.map((item) => [item.status, item.count]));

    return allStatuses.map((status) => ({
      status,
      count: statusMap.get(status) || 0,
    }));
  }

  /**
   * Time from a customer turn to the first reply that reached the customer
   * (AI or human). A burst of customer messages counts once, from its first
   * message. Only replies in delivery state "sent" count; blocked drafts never
   * reached the customer. Turns still waiting for a reply are not counted.
   *
   * TODO: approved drafts count from creation, not approval. messages.created_at
   * is `timestamp` and approved_at is `timestamptz`, so mixing them depends on
   * the session time zone; fix once created_at is timestamptz.
   */
  async getResponseTimeAnalytics(filters: AnalyticsFilters): Promise<ResponseTimeAnalytics> {
    const { startDate, endDate, organizationId } = filters;
    const params: unknown[] = [organizationId];
    const range = dateRangeClause("c.created_at", params, startDate, endDate);

    const rows: Array<{
      average: string | null;
      median: string | null;
      p95: string | null;
      samples: string;
    }> = await AppDataSource.query(
      `
      WITH customer_turns AS (
        SELECT
          c.conversation_id,
          c.created_at AS asked_at,
          (
            SELECT MIN(r.created_at)
            FROM messages r
            WHERE r.conversation_id = c.conversation_id
              AND r.type IN ('BotAgent', 'HumanAgent')
              AND r.delivery_state = 'sent'
              AND r.created_at > c.created_at
          ) AS replied_at
        FROM messages c
        JOIN conversations conv ON conv.id = c.conversation_id
        WHERE conv.organization_id = $1
          AND conv.deleted_at IS NULL
          AND c.type = 'Customer'${range}
      ),
      turns AS (
        SELECT EXTRACT(EPOCH FROM (replied_at - MIN(asked_at))) AS seconds
        FROM customer_turns
        WHERE replied_at IS NOT NULL
        GROUP BY conversation_id, replied_at
      )
      SELECT
        AVG(seconds) AS average,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY seconds) AS p95,
        COUNT(*) AS samples
      FROM turns
      `,
      params,
    );

    const row = rows[0];
    return {
      averageResponseTime: row?.average ? parseFloat(row.average) : 0,
      medianResponseTime: row?.median ? parseFloat(row.median) : 0,
      p95ResponseTime: row?.p95 ? parseFloat(row.p95) : 0,
      sampleSize: row ? parseInt(row.samples, 10) : 0,
    };
  }

  /** Conversations and resolution rate per agent, for conversations created in the range. */
  async getAgentPerformance(filters: AnalyticsFilters): Promise<AgentPerformance[]> {
    const { startDate, endDate, organizationId } = filters;
    const params: unknown[] = [organizationId];
    const range = dateRangeClause("created_at", params, startDate, endDate);

    const rows: Array<{ agent_id: string; total: string; resolved: string }> =
      await AppDataSource.query(
        `
        SELECT
          agent_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
        FROM conversations
        WHERE organization_id = $1
          AND deleted_at IS NULL
          AND agent_id IS NOT NULL${range}
        GROUP BY agent_id
        ORDER BY total DESC
        `,
        params,
      );

    return rows.map((row) => {
      const total = parseInt(row.total, 10);
      const resolved = parseInt(row.resolved, 10);
      return {
        agentId: row.agent_id,
        totalConversations: total,
        resolvedConversations: resolved,
        resolutionRate: total > 0 ? (resolved / total) * 100 : 0,
      };
    });
  }
}
