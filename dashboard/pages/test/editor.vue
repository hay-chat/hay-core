<template>
  <div class="min-h-screen py-8 px-4">
    <div class="container mx-auto max-w-4xl space-y-8">
      <div class="text-center space-y-2">
        <h1 class="text-3xl font-bold">Instructions Editor Test Page</h1>
        <p class="text-gray-600">Test paste functionality and slash commands</p>
      </div>

      <!-- Test Instructions -->
      <Card>
        <CardHeader>
          <CardTitle>Test Instructions</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <h3 class="font-semibold text-sm">Test 1: Paste Multi-line Text</h3>
            <p class="text-sm text-gray-600">
              Copy the following text and paste it into the editor below:
            </p>
            <ol class="list-decimal list-inside space-y-1">
              <li>
                First instruction line
                <ul class="list-decimal list-inside space-y-1">
                  <li>Second instruction line</li>
                </ul>
              </li>
              <li>Third instruction line</li>
              <li>Fourth instruction line</li>
            </ol>
            <Button size="sm" @click="copyTestText">Copy Test Text</Button>
          </div>

          <div class="space-y-2">
            <h3 class="font-semibold text-sm">Test 2: Slash Command (No Duplication)</h3>
            <p class="text-sm text-gray-600">
              Type text followed by a slash command. Example:
              <code class="bg-gray-100 px-2 py-1 rounded text-xs"
                >Please review /doc and provide feedback</code
              >
            </p>
            <p class="text-sm text-gray-600">
              After selecting a document, the text "and provide feedback" should NOT be duplicated.
            </p>
          </div>
        </CardContent>
      </Card>
      <!-- Instructions Editor -->
      <Card>
        <CardHeader>
          <CardTitle>Instructions Editor</CardTitle>
        </CardHeader>
        <CardContent>
          <InstructionsTiptap
            ref="editorRef"
            :initial-data="instructions"
            label="Test Instructions"
            hint="Paste multi-line text or use slash commands to test"
            :disable-api="true"
            :mock-documents="mockDocuments"
            :mock-tools="mockTools"
          />
        </CardContent>
      </Card>

      <!-- Output Display -->
      <Card>
        <CardHeader>
          <CardTitle>Current Value (JSON)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            class="bg-gray-100 p-4 rounded text-xs overflow-auto max-h-96 border border-gray-300"
            data-testid="instructions-output"
          ><code>{{ JSON.stringify(instructions, null, 2) }}</code></pre>
        </CardContent>
      </Card>

      <!-- Test Results -->
      <Card>
        <CardHeader>
          <CardTitle>Expected Results</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="flex items-start gap-2">
            <span class="text-green-600 mt-0.5">✓</span>
            <div>
              <p class="font-medium text-sm">Paste preserves line breaks</p>
              <p class="text-xs text-gray-600">
                Each line from pasted text should appear on a separate line in the editor
              </p>
            </div>
          </div>
          <div class="flex items-start gap-2">
            <span class="text-green-600 mt-0.5">✓</span>
            <div>
              <p class="font-medium text-sm">No text duplication after slash command</p>
              <p class="text-xs text-gray-600">
                Text after the slash command should remain intact without duplication
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Card from "@/components/ui/Card.vue";
import CardContent from "@/components/ui/CardContent.vue";
import CardHeader from "@/components/ui/CardHeader.vue";
import CardTitle from "@/components/ui/CardTitle.vue";
import Button from "@/components/ui/Button.vue";
import InstructionsTiptap from "@/components/InstructionsTiptap.vue";
import { type JSONContent } from "@tiptap/vue-3";

const instructions = ref<JSONContent | undefined>(undefined);

const testText = `First instruction line
Second instruction line
Third instruction line
Fourth instruction line`;

// Mock documents for testing
const mockDocuments = ref([
  {
    id: "doc-1",
    name: "Product Documentation",
    type: "documentation",
    url: "https://example.com/docs",
  },
  {
    id: "doc-2",
    name: "User Guide",
    type: "guide",
    url: "https://example.com/guide",
  },
  {
    id: "doc-3",
    name: "API Reference",
    type: "api",
    url: "https://example.com/api",
  },
]);

// Mock tools/actions for testing
const mockTools = ref([
  {
    id: "tool-1",
    name: "send-email",
    label: "Send Email",
    pluginId: "email-plugin",
    pluginName: "Email Plugin",
    description: "Send an email to a recipient",
  },
  {
    id: "tool-2",
    name: "create-ticket",
    label: "Create Ticket",
    pluginId: "support-plugin",
    pluginName: "Support Plugin",
    description: "Create a support ticket",
  },
  {
    id: "tool-3",
    name: "search-database",
    label: "Search Database",
    pluginId: "database-plugin",
    pluginName: "Database Plugin",
    description: "Search the database for records",
  },
]);

const copyTestText = async () => {
  try {
    await navigator.clipboard.writeText(testText);
    alert("Test text copied to clipboard!");
  } catch (err) {
    console.error("Failed to copy text:", err);
    alert("Failed to copy text. Please copy manually.");
  }
};

// No auth required for this test page
definePageMeta({
  layout: "empty",
  public: true,
});

// Set page title
useHead({
  title: "Instructions Editor Test - Hay Dashboard",
});
</script>
