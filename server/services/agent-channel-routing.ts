/**
 * Which agent answers on a channel (D7-14). Agent <-> channel is many-to-many
 * (agent.channels), but every incoming message needs exactly one responder:
 *
 * 1. Enabled agents assigned to the channel. When several claim it, the org
 *    default agent wins if it is one of them, otherwise the oldest agent.
 * 2. The org default agent.
 * 3. The oldest enabled agent, else the oldest agent.
 *
 * A disabled agent assigned to a channel does not keep it: the channel falls
 * through to the default. Pick 2 and 3 may still return a disabled agent; the
 * orchestrator then parks the conversation for the team (paused agent).
 */

export interface RoutableAgent {
  id: string;
  name?: string;
  enabled: boolean;
  channels?: string[] | null;
  created_at: Date;
}

function oldestFirst<T extends RoutableAgent>(agents: T[]): T[] {
  return [...agents].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}

export function pickAgentForChannel<T extends RoutableAgent>(
  agents: T[],
  defaultAgentId: string | null | undefined,
  channel: string,
): T | null {
  const sorted = oldestFirst(agents);
  const assigned = sorted.filter((a) => a.enabled && a.channels?.includes(channel));
  if (assigned.length > 0) {
    return assigned.find((a) => a.id === defaultAgentId) ?? assigned[0];
  }
  const defaultAgent = defaultAgentId ? sorted.find((a) => a.id === defaultAgentId) : undefined;
  if (defaultAgent) return defaultAgent;
  return sorted.find((a) => a.enabled) ?? sorted[0] ?? null;
}

/**
 * Channels claimed by more than one agent, with the agent that answers there.
 * The agent page uses it to explain who replies when a channel is shared.
 */
export function sharedChannels<T extends RoutableAgent>(
  agents: T[],
  defaultAgentId: string | null | undefined,
): Array<{ channel: string; agentIds: string[]; responderId: string | null }> {
  const claims = new Map<string, string[]>();
  for (const agent of oldestFirst(agents)) {
    for (const channel of agent.channels ?? []) {
      claims.set(channel, [...(claims.get(channel) ?? []), agent.id]);
    }
  }
  return [...claims.entries()]
    .filter(([, agentIds]) => agentIds.length > 1)
    .map(([channel, agentIds]) => ({
      channel,
      agentIds,
      responderId: pickAgentForChannel(agents, defaultAgentId, channel)?.id ?? null,
    }));
}
