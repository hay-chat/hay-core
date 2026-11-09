---
title: "Hay.chat dashboard: add knowledge and write a playbook"
type: tutorial
verified: 2026-11-09
sources:
  - hay-core dashboard/i18n/locales/en/documents.json, playbooks.json (labels) at tag v0.1.0 and master
  - hay-core dashboard/pages/documents, pages/playbooks
  - hay-website src/how-it-works/en.locale.js (@ key, plain-language playbooks)
  - hay-docs user-guide quick-start and playbooks (claude/ui-audit branch)
todo:
  - TODO(Roger) Duplicate, archive and the Publish flow in the playbook editor are left out until confirmed against production.
---
# Add knowledge and write a playbook

## Add knowledge (documents)
Documents are what the assistant answers from. Sidebar: Knowledge > Documents.

**Import files or a website** (button **Import Document**):
1. Choose a source: **Upload Files** or **Import from Website**.
2. Files: drag and drop or Browse Files. Formats: PDF, TXT, MD, DOC, DOCX, PPT, PPTX, HTML, JSON, CSV; several files at once, up to 10 MB each. Click Next: Add Details to set title and type, then upload.
3. Website: enter the documentation URL (for example https://docs.example.com), choose Auto-crawl or Sitemap, click Discover Pages, tick the pages you want and finish the import.
4. Wait a few seconds while the document shows Processing. When the status is Published the assistant can use it. If a document shows Error, use Retry Processing.

**Write a document yourself:** button **Write Document**, give it a title and content, Save.

Document types are Article, Guide, FAQ, Tutorial, Reference and Policy. You can search, archive, download, edit or delete documents from the list.

Good starting content: your top 10 to 20 FAQs, returns and refund policy, shipping information. If a refund flow is wanted, write the refund policy and process in plain language first: the assistant needs it before it can process refunds.

## Write a playbook
A playbook tells the assistant what to do in one situation. Sidebar: Knowledge > Playbooks.
1. Click **Generate Playbook** (a wizard: Purpose, Actions, Documents, Boundaries, Generate), **From template**, or the + button to start blank. **Create Playbook** saves it.
2. Fill **Title**, **Trigger** (when it should activate, for example "The customer asks where their order is") and **Instructions**.
3. Write the Instructions in plain language, step by step. Type **@** to insert an action from a connected integration (for example a refund) or a document.
4. Set the status to **Active**. New playbooks start as Draft and are not used until activated.
5. Test it in Conversations > Conversation Playground before real customers write.

Tips: say which questions to ask first, what to confirm with the customer before an action, and when to hand off to a human. Keep one situation per playbook. Playbooks that move money are held for approval by default.

Sources: Hay.chat dashboard labels (Documents, Playbooks).
