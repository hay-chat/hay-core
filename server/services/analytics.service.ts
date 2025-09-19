import { ConversationRepository } from "../repositories/conversation.repository";
import { MessageRepository } from "../repositories/message.repository";
import { MessageType, MessageSentiment } from "../database/entities/message.entity";

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

export class AnalyticsService {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
  }

  async getConversationActivity(filters: AnalyticsFilters): Promise<ConversationActivityData[]> {
    const { startDate, endDate, organizationId } = filters;

    // Default to last 30 days if no dates provided
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    return await this.conversationRepository.getDailyStats(
      organizationId,
      days,
      start,
      end
    );
  }

  async getSentimentAnalysis(filters: AnalyticsFilters): Promise<SentimentDistribution[]> {
    const { startDate, endDate, organizationId } = filters;

    // Get sentiment counts from the message repository
    const sentimentCounts = await this.messageRepository.getSentimentDistribution(
      organizationId,
      startDate,
      endDate
    );

    // Calculate total and percentages
    const total = sentimentCounts.reduce((sum, item) => sum + item.count, 0);

    // Ensure all sentiments are included, even with 0 count
    const allSentiments = Object.values(MessageSentiment);
    const sentimentMap = new Map(sentimentCounts.map(item => [item.sentiment, item.count]));

    return allSentiments.map(sentiment => ({
      sentiment,
      count: sentimentMap.get(sentiment) || 0,
      percentage: total > 0 ? ((sentimentMap.get(sentiment) || 0) / total) * 100 : 0
    }));
  }

  async getConversationMetrics(filters: AnalyticsFilters) {
    const { startDate, endDate, organizationId } = filters;

    // This can be extended with more metrics in the future
    const totalConversations = await this.conversationRepository.countByFilters({
      organizationId,
      startDate,
      endDate
    });

    const resolvedConversations = await this.conversationRepository.countByFilters({
      organizationId,
      startDate,
      endDate,
      status: 'resolved'
    });

    const avgMessagesPerConversation = await this.messageRepository.getAverageMessagesPerConversation(
      organizationId,
      startDate,
      endDate
    );

    return {
      totalConversations,
      resolvedConversations,
      resolutionRate: totalConversations > 0 ? (resolvedConversations / totalConversations) * 100 : 0,
      avgMessagesPerConversation
    };
  }

  async getResponseTimeAnalytics(filters: AnalyticsFilters) {
    // Placeholder for future response time analytics
    // This would analyze the time between customer messages and agent responses
    return {
      averageResponseTime: 0,
      medianResponseTime: 0,
      p95ResponseTime: 0
    };
  }
}