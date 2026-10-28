import { Conversation } from "@server/database/entities/conversation.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import type { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { v4 as uuidv4 } from "uuid";
import type { HayPluginManifest } from "@server/types/plugin.types";
import { conversationSecretService } from "../conversation-secret.service";
import { createLogger } from "@server/lib/logger";
import { actionLogService, toolErrorCode } from "../action-log.service";
import { classifyTool, CORE_TOOL_RISK, TOOL_APPROVAL_ARG, type ToolRisk } from "./tool-risk";
import { isDryRun, simulatedResult } from "./dry-run";
import type { ActionOutcome } from "@server/database/entities/action-log.entity";
import type {
  PendingAction,
  PendingActionHoldReason,
} from "@server/database/entities/pending-action.entity";
import { decideGate, extractAmount, NEEDS_APPROVAL_CODE } from "./action-policy";
import { pendingActionService } from "../pending-action.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import {
  resolveActionApprovalConfig,
  type ActionApprovalConfig,
} from "@server/types/organization-settings.types";
import { AppDataSource } from "@server/database/data-source";
import { Playbook } from "@server/database/entities/playbook.entity";
import {
  confirmationRequest,
  findConfirmation,
  needsCustomerConfirmation,
  NEEDS_CONFIRMATION_STATUS,
} from "./customer-confirmation";

/** How far back the confirmation check looks for the AI's question (D4-10). */
const CONFIRMATION_LOOKBACK_MESSAGES = 50;

const logger = createLogger("tool-execution");

/** `details.amount` from a NEEDS_APPROVAL tool error, when the plugin stated one. */
function overCapAmount(mcpErrorDetails: unknown): number | null {
  let parsed: unknown = mcpErrorDetails;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  const amount = (parsed as { details?: { amount?: unknown } } | null)?.details?.amount;
  const n = typeof amount === "string" ? Number(amount) : amount;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  /** A dry-run write: nothing was sent to the provider. */
  simulated?: boolean;
  /** Held for a person's approval: nothing was sent to the provider yet. */
  pending?: boolean;
}

interface ToolLogEntry {
  turn: number;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  errorClass?: string;
  latencyMs: number;
  idempotencyKey: string;
}

interface ToolTarget {
  pluginId: string | null;
  toolName: string;
  risk: ToolRisk;
}

/** Everything known about a call before it runs. */
interface PreparedCall {
  conversation: Conversation;
  toolCall: { name: string; args: Record<string, unknown> };
  messageId?: string;
  target: ToolTarget;
  idempotencyKey: string;
  startedAt: number;
  executedAt: string;
  /** Set only when re-running a call a person approved (fills TOOL_APPROVAL_ARG). */
  approvedActionId?: string;
}

/** How a call ended, for the caller, the action log and the tool log. */
interface CallStep {
  result: ToolExecutionResult;
  logOutcome: ActionOutcome;
  errorCode: string | null;
  errorClass?: string;
}

interface ToolCallData {
  tool_name: string;
  arguments: Record<string, unknown>;
}

/**
 * Error enriched with MCP-specific failure details, attached by `executeMCPTool`
 * when an MCP tool call returns an error response.
 */
interface MCPError extends Error {
  mcpErrorDetails?: unknown;
}

interface ToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: unknown[];
        required?: boolean;
      }
    >;
    required?: string[];
  };
}

export class ToolExecutionService {
  private conversationRepository: ConversationRepository;
  private messageService: MessageService;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageService = new MessageService();
  }

  async handleToolExecution(
    conversation: Conversation,
    toolCall: { name: string; args: Record<string, unknown> },
    messageId?: string,
  ): Promise<ToolExecutionResult> {
    try {
      logger.info({ toolName: toolCall.name, args: toolCall.args }, "Executing tool");

      const currentContext =
        conversation.orchestration_status as unknown as ConversationContext | null;
      if (!currentContext) {
        return { success: false, error: "No conversation context available" };
      }
      if (!currentContext.toolLog) {
        currentContext.toolLog = [];
      }

      // Only core may say a call was approved; drop whatever the model sent.
      delete toolCall.args[TOOL_APPROVAL_ARG];

      const target = await this.resolveTarget(conversation.organization_id, toolCall.name);
      const call: PreparedCall = {
        conversation,
        toolCall,
        messageId,
        target,
        idempotencyKey: uuidv4(),
        startedAt: Date.now(),
        executedAt: new Date().toISOString(),
      };

      const step = await this.runStep(call);
      const latencyMs = await this.recordAction(call, step);

      const toolLogEntry: ToolLogEntry = {
        turn: currentContext.lastTurn + 1,
        name: toolCall.name,
        input: toolCall.args,
        ok: step.result.success,
        result: step.result.success ? step.result.result : step.result.error,
        errorClass: step.errorClass,
        latencyMs,
        idempotencyKey: call.idempotencyKey,
      };
      currentContext.toolLog.push(toolLogEntry);
      await this.conversationRepository.updateById(conversation.id, {
        orchestration_status: currentContext as unknown as Record<string, unknown>,
      });

      return step.result;
    } catch (error) {
      logger.error({ err: error }, "Error handling tool execution");
      return {
        success: false,
        error: (error as Error).message || "Unknown error",
      };
    }
  }

  /**
   * Run an action a person approved (D4-5). Skips the gate and the dry-run
   * check: the decision was made on this exact call. Sends the pending
   * action's idempotency key, so a provider that honours it applies the
   * action once even if this runs again. Updates the original TOOL message
   * and writes the action log. The caller moves the pending action on.
   */
  async executeApprovedAction(
    conversation: Conversation,
    action: Pick<PendingAction, "id" | "tool_name" | "args" | "message_id" | "idempotency_key">,
  ): Promise<ToolExecutionResult & { errorCode: string | null }> {
    const call: PreparedCall = {
      approvedActionId: action.id,
      conversation,
      toolCall: { name: action.tool_name, args: action.args },
      messageId: action.message_id ?? undefined,
      target: await this.resolveTarget(conversation.organization_id, action.tool_name),
      idempotencyKey: action.idempotency_key,
      startedAt: Date.now(),
      executedAt: new Date().toISOString(),
    };
    const step = await this.runLive(call);
    await this.recordAction(call, step);
    return { ...step.result, errorCode: step.errorCode };
  }

  /** Write the action log row for a finished step. Returns the latency. */
  private async recordAction(call: PreparedCall, step: CallStep): Promise<number> {
    const latencyMs = Date.now() - call.startedAt;
    await actionLogService.record({
      organizationId: call.conversation.organization_id,
      conversationId: call.conversation.id,
      messageId: call.messageId ?? null,
      pluginId: call.target.pluginId,
      toolName: call.target.toolName,
      risk: call.target.risk,
      args: call.toolCall.args,
      outcome: step.logOutcome,
      errorCode: step.errorCode,
      durationMs: latencyMs,
      idempotencyKey: call.idempotencyKey,
    });
    return latencyMs;
  }

  /**
   * Reads run. A write first needs the shopper's go-ahead (D4-10); then it is
   * simulated in a dry-run conversation, held when the org's approval policy
   * says so, and run otherwise.
   */
  private async runStep(call: PreparedCall): Promise<CallStep> {
    if (call.target.risk.readOnly) return this.runLive(call);
    const organization = await organizationRepository.findById(call.conversation.organization_id);
    const config = resolveActionApprovalConfig(organization?.settings);
    if (needsCustomerConfirmation(call.target.risk, config)) {
      const ask = await this.confirmWithCustomer(call);
      if (ask) return ask;
    }
    if (isDryRun(call.conversation.metadata)) return this.simulate(call);
    return (await this.gate(call, config)) ?? this.runLive(call);
  }

  /**
   * Returns null when the shopper already answered the AI's question about
   * this exact call (and uses that answer up); otherwise marks this call as
   * waiting for the shopper and tells the AI to ask. A call already waiting
   * for (or turned down by) the team is not asked about again.
   */
  private async confirmWithCustomer(call: PreparedCall): Promise<CallStep | null> {
    const { conversation, toolCall } = call;
    const earlier = await pendingActionService.findEarlierRequest(
      conversation.id,
      toolCall.name,
      toolCall.args,
    );
    if (earlier) return null;

    const messages = await this.messageService.messageRepository.getLastMessages(
      conversation.id,
      CONFIRMATION_LOOKBACK_MESSAGES,
    );
    const confirmation = findConfirmation(messages, toolCall.name, toolCall.args, call.messageId);
    if (confirmation) {
      await this.messageService.messageRepository.update(confirmation.id, {
        metadata: { ...confirmation.metadata, confirmationUsed: true },
      });
      return null;
    }

    const result = confirmationRequest(toolCall.name);
    await this.finishToolMessage(call, `Confirmation needed: ${toolCall.name}`, {
      toolOutput: result,
      toolStatus: NEEDS_CONFIRMATION_STATUS,
    });
    return {
      result: { success: false, result },
      logOutcome: "confirming",
      errorCode: null,
    };
  }

  /**
   * Apply the approval policy (D4-4). Returns null when the call may run now;
   * otherwise a step that tells the AI the action is waiting for a person
   * (or was already turned down), without touching the provider.
   */
  private async gate(call: PreparedCall, config: ActionApprovalConfig): Promise<CallStep | null> {
    const { conversation, toolCall, target } = call;
    const playbookCategories = await this.playbookApprovalCategories(conversation);
    const decision = decideGate(target.risk, toolCall.args, config, playbookCategories);
    if (decision.kind === "allow") return null;

    return this.holdForApproval(call, decision.reason, decision.amount, config.expiryHours);
  }

  /** The categories the conversation's active playbook always holds (D4-9). */
  private async playbookApprovalCategories(conversation: Conversation): Promise<string[]> {
    if (!conversation.playbook_id) return [];
    const playbook = await AppDataSource.getRepository(Playbook).findOne({
      where: { id: conversation.playbook_id, organization_id: conversation.organization_id },
      select: { id: true, approval_categories: true },
    });
    return Array.isArray(playbook?.approval_categories) ? playbook.approval_categories : [];
  }

  /**
   * Open a pending action for this call and tell the AI it is waiting. If the
   * same request was already made in this conversation, answer from it instead
   * of opening a second one.
   */
  private async holdForApproval(
    call: PreparedCall,
    holdReason: PendingActionHoldReason,
    amount: number | null,
    expiryHours: number,
  ): Promise<CallStep> {
    const { conversation, toolCall, target } = call;
    const earlier = await pendingActionService.findEarlierRequest(
      conversation.id,
      toolCall.name,
      toolCall.args,
    );
    if (earlier?.status === "rejected") return this.declined(call, earlier);
    if (earlier?.status === "pending") return this.held(call, earlier);

    const action = await pendingActionService.hold({
      organizationId: conversation.organization_id,
      conversationId: conversation.id,
      messageId: call.messageId ?? null,
      pluginId: target.pluginId,
      toolName: toolCall.name,
      category: target.risk.readOnly ? "other_write" : target.risk.category,
      args: toolCall.args,
      amount,
      holdReason,
      expiryHours,
    });
    // The pending action's key is the one the provider will see on approval.
    call.idempotencyKey = action.idempotency_key;
    await this.conversationRepository.update(conversation.id, conversation.organization_id, {
      status: "awaiting-approval",
    });
    conversation.status = "awaiting-approval";
    return this.held(call, action);
  }

  /**
   * A cap-enforcing plugin refused the call as above the merchant's cap
   * (NEEDS_APPROVAL): hold it for a person instead of failing. This applies
   * even when the org's money-move approval is off, because the merchant's own
   * cap is what asked for it. An approved re-run is never held again.
   */
  private async holdOverCap(call: PreparedCall, mcpErrorDetails: unknown): Promise<CallStep> {
    const organization = await organizationRepository.findById(call.conversation.organization_id);
    const config = resolveActionApprovalConfig(organization?.settings);
    return this.holdForApproval(
      call,
      "over_cap",
      overCapAmount(mcpErrorDetails) ?? extractAmount(call.toolCall.args),
      config.expiryHours,
    );
  }

  private async held(call: PreparedCall, action: PendingAction): Promise<CallStep> {
    const result = {
      status: "pending_approval",
      pendingActionId: action.id,
      message:
        "NOT DONE YET. This action needs a team member's approval before it runs. " +
        "Tell the customer you have requested it and that they will get an answer " +
        "here once the team decides. Do not say it is done, approved or guaranteed, " +
        "and do not call this tool again for the same request.",
    };
    await this.finishToolMessage(call, `Approval requested: ${call.toolCall.name}`, {
      toolOutput: result,
      toolStatus: "PENDING_APPROVAL",
      pendingActionId: action.id,
    });
    return {
      result: { success: false, pending: true, result },
      logOutcome: "held",
      errorCode: null,
    };
  }

  private async declined(call: PreparedCall, action: PendingAction): Promise<CallStep> {
    const result = {
      status: "rejected",
      pendingActionId: action.id,
      reason: action.decision_note,
      message:
        "A team member already declined this exact request. It was not done. " +
        "Do not request it again; explain to the customer and offer another option.",
    };
    await this.finishToolMessage(call, `Request declined: ${call.toolCall.name}`, {
      toolOutput: result,
      toolStatus: "REJECTED",
      pendingActionId: action.id,
    });
    return {
      result: { success: false, error: result.message, result },
      logOutcome: "error",
      errorCode: "APPROVAL_REJECTED",
      errorClass: "ApprovalRejected",
    };
  }

  /** Dry-run write: nothing reaches the provider, the AI gets a structured mock. */
  private async simulate(call: PreparedCall): Promise<CallStep> {
    const result = simulatedResult(call.toolCall.name, call.toolCall.args);
    await this.finishToolMessage(call, `Action simulated: ${call.toolCall.name}`, {
      toolOutput: result,
      toolStatus: "SIMULATED",
    });
    return {
      result: { success: true, simulated: true, result },
      logOutcome: "simulated",
      errorCode: null,
    };
  }

  /** Send the call to the core tool or plugin and record the answer. */
  private async runLive(call: PreparedCall): Promise<CallStep> {
    const { conversation, toolCall } = call;
    try {
      const result = await this.executeToolCall(
        conversation,
        { tool_name: toolCall.name, arguments: toolCall.args },
        call.idempotencyKey,
        call.approvedActionId,
      );
      await this.finishToolMessage(call, `Action completed: ${toolCall.name}`, {
        toolOutput: result,
        toolStatus: "SUCCESS",
      });
      return { result: { success: true, result }, logOutcome: "success", errorCode: null };
    } catch (error: unknown) {
      const err = error as Error;
      // Extract MCP error details if available
      const mcpErrorDetails = (err as MCPError).mcpErrorDetails;
      const errorCode = toolErrorCode(mcpErrorDetails);
      if (
        errorCode === NEEDS_APPROVAL_CODE &&
        !call.target.risk.readOnly &&
        call.target.risk.capEnforced &&
        !call.approvedActionId
      ) {
        return this.holdOverCap(call, mcpErrorDetails);
      }
      const errorOutput = mcpErrorDetails || {
        error: err.message || "Unknown error",
        errorType: err.constructor.name,
      };
      await this.finishToolMessage(call, `Action failed: ${toolCall.name}`, {
        toolOutput: errorOutput,
        toolStatus: "ERROR",
        toolErrorCode: errorCode,
      });
      return {
        result: { success: false, error: err.message || "Unknown error" },
        logOutcome: "error",
        errorCode,
        errorClass: err.constructor.name,
      };
    }
  }

  /**
   * Split `pluginId:toolName` (or a core tool name) and look up its risk class.
   * An unparseable or uncached tool resolves to an unclassified write.
   */
  private async resolveTarget(organizationId: string, fullToolName: string): Promise<ToolTarget> {
    const { coreToolRegistry } = await import("./core-tools");
    if (coreToolRegistry.has(fullToolName)) {
      return { pluginId: null, toolName: fullToolName, risk: CORE_TOOL_RISK };
    }
    const colonIndex = fullToolName.lastIndexOf(":");
    if (colonIndex === -1) {
      return { pluginId: null, toolName: fullToolName, risk: classifyTool(null) };
    }
    const pluginId = fullToolName.substring(0, colonIndex);
    const toolName = fullToolName.substring(colonIndex + 1);
    try {
      const { mcpRegistryService } = await import("@server/services/mcp-registry.service");
      const risk = await mcpRegistryService.getToolRisk(organizationId, pluginId, toolName);
      return { pluginId, toolName, risk };
    } catch (err) {
      logger.warn({ err, pluginId, toolName }, "Could not resolve tool risk; treating as a write");
      return { pluginId, toolName, risk: classifyTool(null) };
    }
  }

  /** Write the final state onto the TOOL message and push it to the dashboard. */
  private async finishToolMessage(
    call: PreparedCall,
    content: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (!call.messageId) return;
    const message = await this.messageService.messageRepository.findById(call.messageId);
    if (!message) return;
    const metadata = {
      ...message.metadata,
      ...patch,
      toolLatencyMs: Date.now() - call.startedAt,
      toolExecutedAt: call.executedAt,
    };
    await this.messageService.messageRepository.update(call.messageId, { content, metadata });
    await this.broadcastMessageUpdate(call.conversation, message.id, { content, metadata });
  }

  private async executeToolCall(
    conversation: Conversation,
    toolCall: ToolCallData,
    idempotencyKey?: string,
    approvedActionId?: string,
  ): Promise<unknown> {
    const { tool_name: fullToolName, arguments: toolArgs } = toolCall;

    logger.debug({ fullToolName, toolArgs }, "Executing tool");

    // Core tools — unprefixed names handled in-process. The absence of a
    // colon is the natural dispatch fork between core and plugin/MCP tools.
    const { coreToolRegistry } = await import("./core-tools");
    if (coreToolRegistry.has(fullToolName)) {
      logger.debug({ fullToolName }, "Dispatching to core tool");
      return coreToolRegistry.execute(fullToolName, conversation, toolArgs ?? {});
    }

    // Parse the tool name to extract plugin and tool parts
    // Expected format: "{pluginId}:{toolName}"
    const colonIndex = fullToolName.lastIndexOf(":");
    if (colonIndex === -1) {
      throw new Error(
        `Invalid tool name format: ${fullToolName}. Expected format: {pluginId}:{toolName}`,
      );
    }

    const pluginId = fullToolName.substring(0, colonIndex);
    const actualToolName = fullToolName.substring(colonIndex + 1);

    logger.debug({ pluginId, actualToolName }, "Parsed tool name");

    // Find the plugin that contains this tool
    const allPlugins = pluginManagerService.getAllPlugins();
    logger.debug(
      { availablePlugins: allPlugins.map((p) => ({ id: p.pluginId, name: p.name })) },
      "Available plugins",
    );

    let matchingPlugin = null;
    let toolSchema = null;

    for (const plugin of allPlugins) {
      logger.debug({ pluginId: plugin.pluginId, pluginName: plugin.name }, "Checking plugin");
      if (plugin.pluginId === pluginId) {
        logger.debug({ pluginId }, "Found matching plugin ID");
        const manifest = plugin.manifest as HayPluginManifest;

        // Check if this plugin has dynamic MCP tools (no static tool definitions)
        const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
        const hasMCPCapability = capabilities.includes("mcp");

        if (hasMCPCapability && !manifest.capabilities?.mcp?.tools) {
          // Plugin with dynamic tools - fetched from the running MCP server
          logger.debug("Plugin has dynamic tools, skipping manifest validation");
          matchingPlugin = plugin;
          // No toolSchema needed - the MCP client will handle validation
          break;
        } else if (manifest.capabilities?.mcp?.tools) {
          // Legacy plugin with static tool definitions in manifest
          const mcpTools = manifest.capabilities.mcp.tools;
          logger.debug({ tools: mcpTools.map((t) => t.name) }, "Available tools in plugin");
          const tool = mcpTools.find((t) => t.name === actualToolName);
          if (tool) {
            matchingPlugin = plugin;
            toolSchema = tool;
            logger.debug({ toolName: tool.name }, "Found matching tool");
            break;
          } else {
            logger.debug({ actualToolName }, "Tool not found in this plugin");
          }
        } else {
          logger.debug("Plugin has no MCP capability or tools defined");
        }
      }
    }

    if (!matchingPlugin) {
      const availableTools = allPlugins.flatMap(
        (p) =>
          (p.manifest as HayPluginManifest)?.capabilities?.mcp?.tools?.map(
            (t) => `${p.pluginId}:${t.name}`,
          ) || [],
      );
      throw new Error(
        `Plugin '${pluginId}' not found. Available tools: ${availableTools.join(", ")}`,
      );
    }

    logger.info(
      { toolName: actualToolName, pluginName: matchingPlugin.name },
      "Found tool in plugin",
    );

    // Validate tool arguments against input schema (only for legacy plugins with static schemas)
    if (toolSchema && toolSchema.input_schema) {
      // Ensure input_schema is an object before validation
      if (typeof toolSchema.input_schema === "object") {
        const validation = this.validateToolArguments(
          toolArgs,
          toolSchema.input_schema as ToolSchema["inputSchema"],
        );
        if (!validation.valid) {
          throw new Error(`Invalid tool arguments: ${validation.errors.join(", ")}`);
        }
      }
    } else if (!toolSchema) {
      logger.debug("Skipping argument validation for dynamic plugin (handled by MCP server)");
    }

    // Check if plugin needs installation/building
    if (pluginManagerService.needsInstallation(matchingPlugin.pluginId)) {
      logger.info({ pluginName: matchingPlugin.name }, "Installing plugin");
      await pluginManagerService.installPlugin(matchingPlugin.pluginId);
    }

    if (pluginManagerService.needsBuilding(matchingPlugin.pluginId)) {
      logger.info({ pluginName: matchingPlugin.name }, "Building plugin");
      await pluginManagerService.buildPlugin(matchingPlugin.pluginId);
    }

    // Get the plugin's start command
    const startCommand = pluginManagerService.getStartCommand(matchingPlugin.pluginId);
    if (!startCommand) {
      throw new Error(`Plugin '${matchingPlugin.name}' has no start command defined`);
    }

    logger.debug({ startCommand }, "Plugin start command");

    // Get organization ID from the conversation parameter passed to the parent method
    const organizationId = conversation.organization_id;

    // Inject conversation secrets into tool args before execution
    // Copy first: core-owned args must not leak into the logged / held call args.
    const enrichedArgs = await this.injectConversationSecrets(
      conversation.id,
      { ...toolArgs },
      toolSchema as Record<string, unknown> | null,
    );

    // Inject the core-generated idempotency key and approval id. The LLM must
    // never invent these — a made-up key defeats retry deduplication on the
    // provider side, and a made-up approval would skip a merchant's cap — so
    // core's values always override whatever was sent.
    await this.injectCoreArgs(
      organizationId,
      matchingPlugin.pluginId,
      actualToolName,
      enrichedArgs,
      {
        idempotencyKey,
        approvedActionId,
      },
    );

    // Execute the MCP tool via the running process
    return await this.executeMCPTool(
      organizationId,
      matchingPlugin.pluginId,
      actualToolName,
      enrichedArgs,
    );
  }

  /**
   * Fill core-owned arguments: `idempotency_key` with the core-generated UUID,
   * and TOOL_APPROVAL_ARG with the pending action's id on an approved re-run.
   *
   * Gated on the tool's cached input schema actually declaring the property —
   * MCP servers using strict schemas reject unknown arguments, so blind
   * injection is not safe. Mutates `args` in place, overriding any
   * LLM-provided value; the approval arg is always removed unless this is an
   * approved run. Failure to resolve the schema is non-fatal for the key: the
   * call proceeds without it (and never with an approval id).
   */
  private async injectCoreArgs(
    organizationId: string,
    pluginId: string,
    toolName: string,
    args: Record<string, unknown>,
    values: { idempotencyKey?: string; approvedActionId?: string },
  ): Promise<void> {
    delete args[TOOL_APPROVAL_ARG];
    if (!values.idempotencyKey && !values.approvedActionId) return;
    try {
      const { mcpRegistryService } = await import("@server/services/mcp-registry.service");
      const tools = await mcpRegistryService.getToolsForOrg(organizationId);
      const tool = tools.find((t) => t.pluginId === pluginId && t.name === toolName);
      const properties = (
        tool?.input_schema as { properties?: Record<string, unknown> } | undefined
      )?.properties;

      if (values.idempotencyKey && properties && "idempotency_key" in properties) {
        args.idempotency_key = values.idempotencyKey;
        logger.debug(
          { pluginId, toolName, idempotencyKey: values.idempotencyKey },
          "Injected idempotency key",
        );
      }
      if (values.approvedActionId && properties && TOOL_APPROVAL_ARG in properties) {
        args[TOOL_APPROVAL_ARG] = values.approvedActionId;
        logger.debug({ pluginId, toolName }, "Injected approval id for an approved call");
      }
    } catch (error) {
      logger.warn(
        { err: error, pluginId, toolName },
        "Failed to resolve tool schema for core argument injection",
      );
    }
  }

  private validateToolArguments(
    args: Record<string, unknown>,
    schema: ToolSchema["inputSchema"],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!schema) {
      return { valid: true, errors: [] };
    }

    // Basic validation - check required properties
    if (schema.required && Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in args)) {
          errors.push(`Missing required field: ${requiredField}`);
        }
      }
    }

    // Type validation for properties
    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        if (fieldName in args) {
          const fieldValue = args[fieldName];
          const fieldType = fieldSchema.type;

          if (fieldType === "string" && typeof fieldValue !== "string") {
            errors.push(`Field '${fieldName}' must be a string`);
          } else if (fieldType === "number" && typeof fieldValue !== "number") {
            errors.push(`Field '${fieldName}' must be a number`);
          } else if (fieldType === "boolean" && typeof fieldValue !== "boolean") {
            errors.push(`Field '${fieldName}' must be a boolean`);
          }

          // Validate enum values
          const enumValues = fieldSchema.enum;
          if (enumValues && Array.isArray(enumValues)) {
            if (!enumValues.includes(fieldValue)) {
              errors.push(`Field '${fieldName}' must be one of: ${enumValues.join(", ")}`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Substitute conversation secrets into tool arguments before MCP execution.
   *
   * Two injection modes:
   *  1. `x-hay-secret` annotation on a schema property → inject secret value by key name directly
   *  2. `<<secret.keyname>>` placeholder in any string arg value → replace with real value
   *
   * Secret values never appear in logs or LLM context — only in the actual MCP call.
   */
  private async injectConversationSecrets(
    conversationId: string,
    args: Record<string, unknown>,
    toolSchema: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const secrets = await conversationSecretService.getSecrets(conversationId);
    if (Object.keys(secrets).length === 0) {
      return args;
    }

    const enriched = { ...args };

    // Mode 1: x-hay-secret annotation on schema properties
    const inputSchema = toolSchema?.["input_schema"];
    if (inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)) {
      const properties = (inputSchema as Record<string, unknown>)["properties"];
      if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        for (const [propName, propDef] of Object.entries(properties as Record<string, unknown>)) {
          if (propDef && typeof propDef === "object" && !Array.isArray(propDef)) {
            const secretKey = (propDef as Record<string, unknown>)["x-hay-secret"];
            if (typeof secretKey === "string" && secrets[secretKey] !== undefined) {
              enriched[propName] = secrets[secretKey];
            }
          }
        }
      }
    }

    // Mode 2: <<secret.keyname>> placeholder substitution in string values
    for (const [argKey, argValue] of Object.entries(enriched)) {
      if (typeof argValue === "string") {
        enriched[argKey] = argValue.replace(/<<secret\.([^>]+)>>/g, (_, keyName: string) => {
          return secrets[keyName] ?? `<<secret.${keyName}>>`;
        });
      }
    }

    return enriched;
  }

  /**
   * Broadcast a message update via WebSocket/Redis
   * This ensures the frontend receives real-time updates when tool calls complete
   *
   * TODO: route through conversationEventsService.broadcastMessageReceived
   * (shared payload builder, includes attachments and the Redis-down gate).
   */
  private async broadcastMessageUpdate(
    conversation: Conversation,
    messageId: string,
    updates: { content: string; metadata: Record<string, unknown> },
  ): Promise<void> {
    try {
      const { redisService } = await import("@server/services/redis.service");

      // Fetch the full message to get all fields
      const message = await this.messageService.messageRepository.findById(messageId);
      if (!message) {
        logger.warn({ messageId }, "Message not found for broadcast");
        return;
      }

      const eventPayload = {
        type: "message_received",
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
        payload: {
          id: message.id,
          content: updates.content,
          type: message.type,
          sender: message.sender,
          timestamp: message.created_at,
          metadata: updates.metadata,
          status: message.status,
          deliveryState: message.deliveryState,
          isPlayground: conversation.metadata?.isPlayground === true,
        },
      };

      if (redisService.isConnected()) {
        // Publish to Redis for distribution across all server instances
        await redisService.publish("websocket:events", eventPayload);
        logger.debug({ messageId }, "Tool result broadcast via Redis");
      } else {
        // Fallback to direct WebSocket if Redis not available
        const { websocketService } = await import("@server/services/websocket.service");

        const messagePayload = {
          type: "message",
          conversationId: conversation.id,
          data: {
            id: message.id,
            content: updates.content,
            type: message.type,
            sender: message.sender,
            timestamp: message.created_at,
            metadata: updates.metadata,
          },
        };

        // Dashboard only. Tool output (order data, error details) must never
        // reach the shopper's webchat socket.
        websocketService.sendToOrganization(conversation.organization_id, messagePayload);
        logger.debug({ messageId }, "Tool result broadcast via WebSocket");
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to broadcast message update");
      // Don't throw - broadcast failure shouldn't break tool execution
    }
  }

  private async executeMCPTool(
    organizationId: string,
    pluginId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<unknown> {
    logger.debug({ pluginId, toolName, organizationId, toolArgs }, "Executing MCP tool via client");

    try {
      // Use MCP client factory to get the appropriate client (local or remote)
      const { MCPClientFactory } = await import("@server/services/mcp-client-factory.service");
      const client = await MCPClientFactory.createClient(organizationId, pluginId);

      // Call the tool
      const result = await client.callTool(toolName, toolArgs);

      logger.debug({ result }, "MCP response received");

      if (result.isError) {
        // Extract error from MCP response — error text may be in content or error field
        const contentText = Array.isArray(result.content)
          ? result.content
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text?: string }) => c.text || "")
              .join("\n")
          : null;
        const errorDetails = contentText || result.error || "Unknown error";
        const errorMessage =
          typeof errorDetails === "object" ? JSON.stringify(errorDetails) : String(errorDetails);

        const error: MCPError = new Error(`MCP tool error: ${errorMessage}`);
        // Attach the full error object to the error for better handling
        error.mcpErrorDetails = errorDetails;
        throw error;
      }

      // Return the result content or the full result object
      return result.content || result;
    } catch (error) {
      logger.error({ err: error }, "MCP tool execution failed");
      throw error;
    }
  }
}
