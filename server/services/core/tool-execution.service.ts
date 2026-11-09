import { withSpan } from "@server/lib/tracing";
import { Conversation } from "@server/database/entities/conversation.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import type { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { v4 as uuidv4 } from "uuid";
import Ajv, { type ValidateFunction } from "ajv";
import { conversationSecretService } from "../conversation-secret.service";
import { createLogger } from "@server/lib/logger";
import { actionLogService, toolErrorCode } from "../action-log.service";
import { classifyTool, READ_RISK, TOOL_APPROVAL_ARG, type ToolRisk } from "./tool-risk";
import {
  CUSTOMER_IDENTITY_META_KEY,
  resolveCustomerIdentity,
  type CustomerIdentity,
} from "./customer-identity";
import { isToolEnabled } from "./enabled-tools";
import { isDryRun, simulatedResult } from "./dry-run";
import type { ActionOutcome } from "@server/database/entities/action-log.entity";
import type {
  PendingAction,
  PendingActionHoldReason,
} from "@server/database/entities/pending-action.entity";
import { decideGate, extractAmount, NEEDS_APPROVAL_CODE } from "./action-policy";
import { pendingActionService } from "../pending-action.service";
import { orderLinkService } from "../order-links/order-link.service";
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
import {
  isPageTool,
  pageToolArgumentErrors,
  pageToolName,
  pageToolService,
  unwrapPageToolResult,
} from "@server/services/webchat/page-tools.service";

/** How far back the confirmation check looks for the AI's question (D4-10). */
const CONFIRMATION_LOOKBACK_MESSAGES = 50;

const logger = createLogger("tool-execution");

// Plugin tools' input schemas come from their cached tools/list. Compiled once
// per schema object; `strict: false` because MCP schemas carry extra keywords.
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new WeakMap<object, ValidateFunction>();

/** Error messages when `args` do not match the tool's input schema; empty when they do. */
function schemaErrors(schema: Record<string, unknown>, args: Record<string, unknown>): string[] {
  let validate = validators.get(schema);
  if (!validate) {
    try {
      validate = ajv.compile(schema);
    } catch (err) {
      logger.warn({ err }, "Tool input schema does not compile; skipping argument validation");
      return [];
    }
    validators.set(schema, validate);
  }
  if (validate(args)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "arguments"} ${e.message ?? ""}`);
}

/** Size of a value as JSON, for logs that must not contain the value itself. */
function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

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
  /** The tool only reads: running it again with the same input changes nothing. */
  readOnly?: boolean;
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
  /** A built-in core tool (not a plugin or page tool). */
  isCore: boolean;
  /** The plugin tool's cached input schema, when known. */
  inputSchema: Record<string, unknown> | null;
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
  /** Who the conversation is verifiably with; sent to plugin tools beside the args. */
  identity: CustomerIdentity;
}

/** How a call ended, for the caller, the action log and the tool log. */
interface CallStep {
  result: ToolExecutionResult;
  logOutcome: ActionOutcome;
  errorCode: string | null;
  errorClass?: string;
}

/**
 * Error enriched with MCP-specific failure details, attached by `executeMCPTool`
 * when an MCP tool call returns an error response.
 */
interface MCPError extends Error {
  mcpErrorDetails?: unknown;
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
      logger.info(
        {
          conversationId: conversation.id,
          toolName: toolCall.name,
          argsSize: jsonSize(toolCall.args),
        },
        "Executing tool",
      );

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

      const target = await this.resolveTarget(conversation, toolCall.name);
      const call: PreparedCall = {
        conversation,
        toolCall,
        messageId,
        target,
        idempotencyKey: uuidv4(),
        startedAt: Date.now(),
        executedAt: new Date().toISOString(),
        identity: await this.identityFor(conversation, target),
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

      return { ...step.result, readOnly: target.risk.readOnly };
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
    const target = await this.resolveTarget(conversation, action.tool_name);
    const call: PreparedCall = {
      approvedActionId: action.id,
      conversation,
      toolCall: { name: action.tool_name, args: action.args },
      messageId: action.message_id ?? undefined,
      target,
      idempotencyKey: action.idempotency_key,
      startedAt: Date.now(),
      executedAt: new Date().toISOString(),
      identity: await this.identityFor(conversation, target),
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
    // D2-4: index the orders this call named (dry-run playground calls excepted).
    if (step.logOutcome !== "simulated") {
      await orderLinkService.recordFromToolCall({
        organizationId: call.conversation.organization_id,
        conversationId: call.conversation.id,
        messageId: call.messageId ?? null,
        pluginId: call.target.pluginId,
        toolName: call.target.toolName,
        input: call.toolCall.args,
        output: step.logOutcome === "success" ? step.result.result : undefined,
      });
    }
    return latencyMs;
  }

  /** Plugin tools get the conversation's verified customer; core and page tools need none. */
  private async identityFor(
    conversation: Conversation,
    target: ToolTarget,
  ): Promise<CustomerIdentity> {
    if (!target.pluginId) return { trust: "none" };
    return resolveCustomerIdentity(conversation);
  }

  private async isRemotePluginTool(target: ToolTarget): Promise<boolean> {
    if (!target.pluginId) return false;
    const { MCPClientFactory } = await import("@server/services/mcp-client-factory.service");
    return MCPClientFactory.isRemote(target.pluginId);
  }

  /**
   * A tool the conversation's playbook does not enable, or args that do not
   * match the tool's schema, are refused before anything else. Reads run,
   * except a customer-data read with no verified customer, or on a remote
   * server, which is never told who the customer is and so can't scope records.
   * Core writes act only inside Hay.chat: simulated in a dry-run, else run. A
   * plugin write first needs the shopper's go-ahead (D4-10); then it is
   * simulated in a dry-run conversation, held when the org's approval policy
   * says so, and run otherwise.
   */
  private async runStep(call: PreparedCall): Promise<CallStep> {
    if (!(await isToolEnabled(call.conversation, call.toolCall.name))) {
      return this.refuse(call, "TOOL_NOT_ENABLED", {
        status: "not_available",
        message: `Tool "${call.toolCall.name}" is not available in this conversation.`,
      });
    }
    const { inputSchema } = call.target;
    const errors = !inputSchema
      ? []
      : isPageTool(call.toolCall.name)
        ? pageToolArgumentErrors(inputSchema, call.toolCall.args)
        : schemaErrors(inputSchema, call.toolCall.args);
    if (errors.length > 0) {
      return this.refuse(call, "BAD_INPUT", {
        status: "invalid_arguments",
        message: `Invalid tool arguments: ${errors.join("; ")}`,
      });
    }
    if (call.target.risk.readOnly) {
      if (call.target.risk.customerData && call.identity.trust === "none") {
        return this.refuse(call, "IDENTITY_REQUIRED", {
          status: "identity_required",
          message:
            "NOT DONE. This lookup returns a customer's personal details, and the customer in " +
            "this conversation is not verified, so it cannot run. Do not look up anyone by an " +
            "email, phone or name typed in the chat. Tell the customer you cannot open account " +
            "details here: they can sign in to their account on the store and open the chat " +
            "again, or you can hand the conversation to the team.",
        });
      }
      if (call.target.risk.customerData && (await this.isRemotePluginTool(call.target))) {
        return this.refuse(call, "IDENTITY_REQUIRED", {
          status: "identity_required",
          message:
            "NOT DONE. This lookup returns a customer's personal details, and this connection " +
            "cannot match them to the verified customer, so it cannot run. Tell the customer " +
            "you cannot open account details here, or hand the conversation to the team.",
        });
      }
      return this.runLive(call);
    }
    if (call.target.isCore) {
      return isDryRun(call.conversation.metadata) ? this.simulate(call) : this.runLive(call);
    }
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
    // The same request is already with the team: answer from it, even if the
    // policy would now let it run (e.g. the threshold was raised), or the
    // pending one could still be approved and run a second time.
    const earlier = await this.answerFromEarlierRequest(call);
    if (earlier) return earlier;

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
    const earlier = await this.answerFromEarlierRequest(call);
    if (earlier) return earlier;

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

  /** Held or declined when this exact call is already pending or was turned down; else null. */
  private async answerFromEarlierRequest(call: PreparedCall): Promise<CallStep | null> {
    const earlier = await pendingActionService.findEarlierRequest(
      call.conversation.id,
      call.toolCall.name,
      call.toolCall.args,
    );
    if (earlier?.status === "rejected") return this.declined(call, earlier);
    if (earlier?.status === "pending") return this.held(call, earlier);
    return null;
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

  /** Refused by core before the tool ran: the AI gets why, the provider sees nothing. */
  private async refuse(
    call: PreparedCall,
    errorCode: string,
    result: { status: string; message: string },
  ): Promise<CallStep> {
    await this.finishToolMessage(call, `Action refused: ${call.toolCall.name}`, {
      toolOutput: result,
      toolStatus: "ERROR",
      toolErrorCode: errorCode,
    });
    return {
      result: { success: false, error: result.message, result },
      logOutcome: "error",
      errorCode,
      errorClass: "ToolRefused",
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
    const { toolCall } = call;
    try {
      const result = await this.executeToolCall(call);
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
   * Split `pluginId:toolName` (or a core tool name) and look up its risk class
   * and cached input schema. An unparseable or uncached tool resolves to an
   * unclassified write.
   */
  private async resolveTarget(
    conversation: Pick<Conversation, "id" | "organization_id">,
    fullToolName: string,
  ): Promise<ToolTarget> {
    const organizationId = conversation.organization_id;
    const { coreToolRegistry } = await import("./core-tools");
    const coreTool = coreToolRegistry.get(fullToolName);
    if (coreTool) {
      return {
        pluginId: null,
        toolName: fullToolName,
        risk: coreTool.risk,
        isCore: true,
        inputSchema: null,
      };
    }
    // Page tools run in the visitor's own browser, with no provider and no
    // secret involved. One the page declares as a write still follows the
    // approval policy. Only what the page registered can run.
    if (isPageTool(fullToolName)) {
      const tool = (await pageToolService.list(conversation.id, organizationId)).find(
        (t) => t.name === pageToolName(fullToolName),
      );
      return {
        pluginId: null,
        toolName: fullToolName,
        risk: tool?.annotations?.readOnlyHint === false ? classifyTool(null) : READ_RISK,
        isCore: false,
        inputSchema: tool?.inputSchema ?? null,
      };
    }
    const colonIndex = fullToolName.lastIndexOf(":");
    if (colonIndex === -1) {
      return {
        pluginId: null,
        toolName: fullToolName,
        risk: classifyTool(null),
        isCore: false,
        inputSchema: null,
      };
    }
    const pluginId = fullToolName.substring(0, colonIndex);
    const toolName = fullToolName.substring(colonIndex + 1);
    try {
      const { mcpRegistryService } = await import("@server/services/mcp-registry.service");
      const [risk, tools] = await Promise.all([
        mcpRegistryService.getToolRisk(organizationId, pluginId, toolName),
        mcpRegistryService.getToolsForOrg(organizationId),
      ]);
      const tool = tools.find((t) => t.pluginId === pluginId && t.name === toolName);
      const schema = tool?.input_schema as Record<string, unknown> | undefined;
      return {
        pluginId,
        toolName,
        risk,
        isCore: false,
        inputSchema: schema && typeof schema === "object" ? schema : null,
      };
    } catch (err) {
      logger.warn({ err, pluginId, toolName }, "Could not resolve tool risk; treating as a write");
      return { pluginId, toolName, risk: classifyTool(null), isCore: false, inputSchema: null };
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

  private async executeToolCall(call: PreparedCall): Promise<unknown> {
    const { conversation, target } = call;
    const fullToolName = call.toolCall.name;
    const toolArgs = call.toolCall.args ?? {};

    // Core tools — unprefixed names handled in-process. The absence of a
    // colon is the natural dispatch fork between core and plugin/MCP tools.
    if (target.isCore) {
      const { coreToolRegistry } = await import("./core-tools");
      logger.debug({ fullToolName }, "Dispatching to core tool");
      return coreToolRegistry.execute(fullToolName, conversation, toolArgs);
    }

    // Page tools (`page:name`) — run by the host page over the conversation's
    // socket. Nothing is injected: the page gets exactly what the model sent.
    if (isPageTool(fullToolName)) {
      if (!target.inputSchema) throw new Error(`Page tool "${fullToolName}" is not registered`);
      logger.debug({ fullToolName }, "Dispatching to page tool");
      const result = await pageToolService.call(
        conversation.id,
        conversation.organization_id,
        pageToolName(fullToolName),
        toolArgs,
      );
      return unwrapPageToolResult(result);
    }

    // Expected format: "{pluginId}:{toolName}"
    const { pluginId, toolName } = target;
    if (!pluginId) {
      throw new Error(
        `Invalid tool name format: ${fullToolName}. Expected format: {pluginId}:{toolName}`,
      );
    }

    const plugin = pluginManagerService.getAllPlugins().find((p) => p.pluginId === pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' not found`);
    }

    // Check if plugin needs installation/building
    if (pluginManagerService.needsInstallation(plugin.pluginId)) {
      logger.info({ pluginName: plugin.name }, "Installing plugin");
      await pluginManagerService.installPlugin(plugin.pluginId);
    }

    if (pluginManagerService.needsBuilding(plugin.pluginId)) {
      logger.info({ pluginName: plugin.name }, "Building plugin");
      await pluginManagerService.buildPlugin(plugin.pluginId);
    }

    if (!pluginManagerService.getStartCommand(plugin.pluginId)) {
      throw new Error(`Plugin '${plugin.name}' has no start command defined`);
    }

    // Copy first: core-owned args must not leak into the logged / held call args.
    const enrichedArgs = await this.injectConversationSecrets(
      conversation.id,
      { ...toolArgs },
      target.inputSchema,
    );

    // Inject the core-generated idempotency key and approval id. The LLM must
    // never invent these — a made-up key defeats retry deduplication on the
    // provider side, and a made-up approval would skip a merchant's cap — so
    // core's values always override whatever was sent.
    this.injectCoreArgs(target, enrichedArgs, {
      idempotencyKey: call.idempotencyKey,
      approvedActionId: call.approvedActionId,
    });

    return await this.executeMCPTool(
      conversation.organization_id,
      pluginId,
      toolName,
      enrichedArgs,
      call.identity,
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
   * approved run. Without a cached schema the call proceeds without the key
   * (and never with an approval id).
   */
  private injectCoreArgs(
    target: ToolTarget,
    args: Record<string, unknown>,
    values: { idempotencyKey?: string; approvedActionId?: string },
  ): void {
    delete args[TOOL_APPROVAL_ARG];
    const properties = (target.inputSchema as { properties?: Record<string, unknown> } | null)
      ?.properties;
    if (!properties) return;
    if (values.idempotencyKey && "idempotency_key" in properties) {
      args.idempotency_key = values.idempotencyKey;
    }
    if (values.approvedActionId && TOOL_APPROVAL_ARG in properties) {
      args[TOOL_APPROVAL_ARG] = values.approvedActionId;
      logger.debug(
        { pluginId: target.pluginId, toolName: target.toolName },
        "Injected approval id for an approved call",
      );
    }
  }

  /**
   * Fill conversation secrets into the properties the tool's input schema
   * marks with `x-hay-secret: "<key>"`. Only those properties: a secret never
   * lands in an argument the tool did not ask for it in. Secret values never
   * appear in logs or LLM context — only in the actual MCP call.
   */
  private async injectConversationSecrets(
    conversationId: string,
    args: Record<string, unknown>,
    inputSchema: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const properties = inputSchema?.["properties"];
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return args;
    const wanted = Object.entries(properties as Record<string, unknown>).flatMap(
      ([propName, propDef]) => {
        const key = (propDef as Record<string, unknown> | null)?.["x-hay-secret"];
        return typeof key === "string" ? [[propName, key] as const] : [];
      },
    );
    if (wanted.length === 0) return args;

    const secrets = await conversationSecretService.getSecrets(conversationId);
    const enriched = { ...args };
    for (const [propName, key] of wanted) {
      if (secrets[key] !== undefined) enriched[propName] = secrets[key];
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
    identity: CustomerIdentity,
  ): Promise<unknown> {
    logger.debug({ pluginId, toolName, organizationId }, "Executing MCP tool via client");

    try {
      // Use MCP client factory to get the appropriate client (local or remote)
      const { MCPClientFactory } = await import("@server/services/mcp-client-factory.service");
      const client = await MCPClientFactory.createClient(organizationId, pluginId);

      // Call the tool
      const result = await withSpan(
        "plugin tool call",
        { "hay.plugin_id": pluginId, "hay.tool": toolName },
        (span) =>
          client
            .callTool(toolName, toolArgs, { [CUSTOMER_IDENTITY_META_KEY]: identity })
            .then((callResult) => {
              span.setAttributes({ "hay.tool_error": Boolean(callResult.isError) });
              return callResult;
            }),
      );

      logger.debug(
        { pluginId, toolName, isError: Boolean(result.isError), resultSize: jsonSize(result) },
        "MCP response received",
      );

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
