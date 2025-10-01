<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold">Installation</h3>
      <p class="text-sm text-neutral-muted">
        Add this code to your website to enable the chat widget
      </p>
    </div>

    <div class="space-y-2">
      <Label>Embed Code</Label>
      <div class="relative">
        <Textarea :value="embedCode" readonly class="font-mono text-xs" :rows="10" />
        <Button
          variant="outline"
          size="sm"
          class="absolute top-2 right-2"
          @click="copyEmbedCode"
        >
          <Copy v-if="!copied" class="h-3 w-3 mr-1" />
          <Check v-else class="h-3 w-3 mr-1" />
          {{ copied ? "Copied!" : "Copy" }}
        </Button>
      </div>
    </div>

    <div class="text-sm text-neutral-muted">
      Place this code before the closing &lt;/body&gt; tag on your website.
    </div>
  </div>
</template>

<script>
// NOTE: This component is loaded dynamically by the plugin system
// Components (Label, Textarea, Button, Copy, Check) and Vue APIs (ref, computed)
// are provided by the parent component loader
export default {
  props: {
    plugin: Object,
    config: Object,
    apiBaseUrl: String,
  },
  setup(props) {
    const copied = ref(false);

    const embedCode = computed(() => {
      const organizationId = props.config?.organizationId || '{{ORGANIZATION_ID}}';
      const instanceId = props.config?.instanceId || '{{INSTANCE_ID}}';
      const pluginId = props.plugin?.id || 'hay-plugin-webchat';
      const baseUrl = props.apiBaseUrl || 'http://localhost:3001';

      return '<' + 'script>\n' +
  '  window.HayChat = window.HayChat || {};\n' +
  '  window.HayChat.config = {\n' +
  `    organizationId: '${organizationId}',\n` +
  `    instanceId: '${instanceId}',\n` +
  `    pluginId: '${pluginId}',\n` +
  `    baseUrl: '${baseUrl}'\n` +
  '  };\n' +
  '</' + 'script>\n' +
  '<' + `script src="${baseUrl}/plugins/public/${pluginId}/widget.js" async><` + '/script>\n' +
  `<link rel="stylesheet" href="${baseUrl}/plugins/public/${pluginId}/widget.css">`;
    });

    const copyEmbedCode = async () => {
      try {
        await navigator.clipboard.writeText(embedCode.value);
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    };

    return {
      copied,
      embedCode,
      copyEmbedCode,
    };
  },
};
</script>
