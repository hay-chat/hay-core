/**
 * Note tools — the standard Twenty `note` object, plus attachment to a person
 * or company via `noteTargets`.
 *
 * Twenty has no single endpoint to list notes by their attached record, so
 * listing walks `noteTargets` (filtered by the target id) and fetches each
 * linked note.
 */

const { z } = require("zod");
const { twentyApi } = require("../lib/client");
const { ok, fail, unwrapData, buildBlockNote } = require("../lib/format");

function summarizeNote(note) {
  if (!note) return null;
  return {
    id: note.id,
    title: note.title ?? "",
    body: note.bodyV2?.markdown ?? note.body ?? null,
    createdAt: note.createdAt ?? null,
    updatedAt: note.updatedAt ?? null,
  };
}

async function listNotesForTarget(targetFilter, limit) {
  const targetsRes = await twentyApi("GET", "/noteTargets", {
    query: { filter: targetFilter, limit: limit ?? 50 },
  });
  const targets = targetsRes?.data?.noteTargets ?? [];
  const noteIds = [...new Set(targets.map((t) => t.noteId).filter(Boolean))];
  if (noteIds.length === 0) return [];

  const notes = await Promise.all(
    noteIds.map(async (noteId) => {
      try {
        const res = await twentyApi("GET", `/notes/${noteId}`);
        return summarizeNote(res?.data?.note);
      } catch {
        return null;
      }
    }),
  );

  return notes
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
}

function registerNoteTools(server) {
  server.tool(
    "create_note",
    "Create a note and optionally attach it to a person and/or company. Use this to log " +
      "interactions, context, or summaries against a CRM record.",
    {
      title: z.string().describe("Note title"),
      body: z.string().describe("Note body (plain text / markdown)"),
      personId: z.string().optional().describe("Attach the note to this person"),
      companyId: z.string().optional().describe("Attach the note to this company"),
    },
    async ({ title, body, personId, companyId }) => {
      try {
        const res = await twentyApi("POST", "/notes", {
          body: { title, bodyV2: buildBlockNote(body) },
        });
        const note = unwrapData(res);
        const attachments = [];
        if (note?.id && personId) {
          await twentyApi("POST", "/noteTargets", { body: { noteId: note.id, personId } });
          attachments.push({ personId });
        }
        if (note?.id && companyId) {
          await twentyApi("POST", "/noteTargets", { body: { noteId: note.id, companyId } });
          attachments.push({ companyId });
        }
        return ok({ note, attachments });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "list_notes_by_person",
    "List notes attached to a person, most recent first.",
    {
      personId: z.string().describe("Twenty CRM person ID"),
      limit: z.number().optional().describe("Max note targets to scan (default 50)"),
    },
    async ({ personId, limit }) => {
      try {
        return ok(await listNotesForTarget(`personId[eq]:${personId}`, limit));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "list_notes_by_company",
    "List notes attached to a company, most recent first.",
    {
      companyId: z.string().describe("Twenty CRM company ID"),
      limit: z.number().optional().describe("Max note targets to scan (default 50)"),
    },
    async ({ companyId, limit }) => {
      try {
        return ok(await listNotesForTarget(`companyId[eq]:${companyId}`, limit));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerNoteTools };
