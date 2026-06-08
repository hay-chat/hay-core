/**
 * Task tools — the standard Twenty `task` object, plus attachment to a person
 * or company via `taskTargets`.
 */

const { z } = require("zod");
const { twentyApi } = require("../lib/client");
const { ok, fail, unwrapData, buildBlockNote } = require("../lib/format");

const TASK_STATUS = ["TODO", "IN_PROGRESS", "DONE"];

function registerTaskTools(server) {
  server.tool(
    "create_task",
    "Create a task and optionally attach it to a person and/or company. Defaults to TODO status.",
    {
      title: z.string().describe("Task title"),
      body: z.string().optional().describe("Task body / description (plain text / markdown)"),
      status: z.enum(TASK_STATUS).optional().describe("Task status (default TODO)"),
      dueAt: z.string().optional().describe("Due date in ISO 8601 (e.g. 2025-01-31T00:00:00Z)"),
      assigneeId: z.string().optional().describe("Workspace member ID to assign the task to"),
      personId: z.string().optional().describe("Attach the task to this person"),
      companyId: z.string().optional().describe("Attach the task to this company"),
    },
    async ({ title, body, status, dueAt, assigneeId, personId, companyId }) => {
      try {
        const payload = { title, status: status ?? "TODO", bodyV2: buildBlockNote(body || "") };
        if (dueAt) payload.dueAt = dueAt;
        if (assigneeId) payload.assigneeId = assigneeId;

        const res = await twentyApi("POST", "/tasks", { body: payload });
        const task = unwrapData(res);
        const attachments = [];
        if (task?.id && personId) {
          await twentyApi("POST", "/taskTargets", { body: { taskId: task.id, personId } });
          attachments.push({ personId });
        }
        if (task?.id && companyId) {
          await twentyApi("POST", "/taskTargets", { body: { taskId: task.id, companyId } });
          attachments.push({ companyId });
        }
        return ok({ task, attachments });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "find_tasks",
    "List tasks with an optional raw Twenty filter expression. " +
      'E.g. "status[eq]:TODO" or "dueAt[lt]:2025-02-01".',
    {
      filter: z.string().optional().describe("Twenty filter expression. Omit to list all tasks."),
      limit: z.number().optional().describe("Max results to return (default 50)"),
    },
    async ({ filter, limit }) => {
      try {
        const res = await twentyApi("GET", "/tasks", { query: { filter, limit: limit ?? 50 } });
        return ok(res?.data?.tasks ?? []);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "update_task",
    "Update an existing task. Only fields you pass are written. Commonly used to mark a task DONE.",
    {
      taskId: z.string().describe("Twenty CRM task ID"),
      title: z.string().optional().describe("Task title"),
      body: z.string().optional().describe("Task body / description"),
      status: z.enum(TASK_STATUS).optional().describe("Task status"),
      dueAt: z.string().optional().describe("Due date in ISO 8601"),
      assigneeId: z.string().optional().describe("Workspace member ID to assign the task to"),
    },
    async ({ taskId, title, body, status, dueAt, assigneeId }) => {
      try {
        const update = {};
        if (title !== undefined) update.title = title;
        if (status !== undefined) update.status = status;
        if (dueAt !== undefined) update.dueAt = dueAt;
        if (assigneeId !== undefined) update.assigneeId = assigneeId;
        if (body !== undefined) update.bodyV2 = buildBlockNote(body);
        if (Object.keys(update).length === 0) {
          throw new Error("No fields to update were provided");
        }
        const res = await twentyApi("PATCH", `/tasks/${taskId}`, { body: update });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerTaskTools };
