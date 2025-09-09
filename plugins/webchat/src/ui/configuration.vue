<template>
  <div class="webchat-configuration">
    <Card>
      <CardHeader>
        <CardTitle>
          <div class="flex items-center gap-2">
            <MessageSquare class="h-5 w-5" />
            Webchat Widget Configuration
          </div>
        </CardTitle>
        <CardDescription>
          Customize the appearance and behavior of your webchat widget
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="saveConfiguration" class="space-y-6">
          <!-- Widget Appearance Section -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold">Widget Appearance</h3>
            
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for="widgetTitle" required>Widget Title</Label>
                <Input 
                  id="widgetTitle" 
                  v-model="formData.widgetTitle"
                  placeholder="e.g., Chat with us"
                  required
                />
              </div>

              <div class="space-y-2">
                <Label for="widgetSubtitle">Widget Subtitle</Label>
                <Input 
                  id="widgetSubtitle" 
                  v-model="formData.widgetSubtitle"
                  placeholder="e.g., We typically reply within minutes"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for="position" required>Position</Label>
                <Select v-model="formData.position">
                  <SelectTrigger id="position">
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="right">Bottom Right</SelectItem>
                    <SelectItem value="left">Bottom Left</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-2">
                <Label for="theme" required>Theme Color</Label>
                <Select v-model="formData.theme">
                  <SelectTrigger id="theme">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">
                      <div class="flex items-center gap-2">
                        <div class="w-4 h-4 rounded bg-blue-500"></div>
                        Blue
                      </div>
                    </SelectItem>
                    <SelectItem value="green">
                      <div class="flex items-center gap-2">
                        <div class="w-4 h-4 rounded bg-green-500"></div>
                        Green
                      </div>
                    </SelectItem>
                    <SelectItem value="purple">
                      <div class="flex items-center gap-2">
                        <div class="w-4 h-4 rounded bg-purple-500"></div>
                        Purple
                      </div>
                    </SelectItem>
                    <SelectItem value="black">
                      <div class="flex items-center gap-2">
                        <div class="w-4 h-4 rounded bg-black"></div>
                        Black
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <!-- Greeting Message Section -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold">Greeting Message</h3>
            
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label for="showGreeting">Show Greeting Message</Label>
                <p class="text-sm text-muted-foreground">
                  Display a welcome message when the chat opens
                </p>
              </div>
              <Switch 
                id="showGreeting" 
                v-model="formData.showGreeting"
              />
            </div>

            <div v-if="formData.showGreeting" class="space-y-2">
              <Label for="greetingMessage">Greeting Message</Label>
              <Textarea 
                id="greetingMessage" 
                v-model="formData.greetingMessage"
                placeholder="Enter your greeting message..."
                rows="3"
              />
            </div>
          </div>

          <!-- Security Section -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold">Security Settings</h3>
            
            <div class="space-y-2">
              <Label for="allowedDomains">Allowed Domains</Label>
              <p class="text-sm text-muted-foreground">
                Specify domains where the widget can be embedded (one per line).
                Use * to allow all domains.
              </p>
              <Textarea 
                id="allowedDomains" 
                v-model="formData.allowedDomains"
                placeholder="example.com&#10;app.example.com&#10;*.example.com"
                rows="4"
              />
            </div>
          </div>

          <!-- Preview Section -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold">Widget Preview</h3>
            <div class="border rounded-lg p-4 bg-background-tertiary/20">
              <div class="flex justify-center">
                <WidgetPreview 
                  :config="formData"
                  :theme="formData.theme"
                  :position="formData.position"
                />
              </div>
            </div>
          </div>

          <!-- Embed Code Section -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold">Installation</h3>
            <div class="space-y-2">
              <Label>Embed Code</Label>
              <p class="text-sm text-muted-foreground">
                Copy and paste this code into your website's HTML
              </p>
              <div class="relative">
                <Textarea 
                  :value="embedCode"
                  readonly
                  rows="4"
                  class="font-mono text-xs"
                />
                <Button 
                  type="button"
                  size="sm"
                  variant="secondary"
                  class="absolute top-2 right-2"
                  @click="copyEmbedCode"
                >
                  <Copy v-if="!copied" class="h-4 w-4" />
                  <Check v-else class="h-4 w-4" />
                  {{ copied ? 'Copied!' : 'Copy' }}
                </Button>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" @click="$emit('cancel')">
              Cancel
            </Button>
            <Button type="submit" :disabled="!isValid || saving">
              <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
              Save Configuration
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MessageSquare, Loader2, Copy, Check } from 'lucide-vue-next';
import WidgetPreview from './WidgetPreview.vue';

const props = defineProps<{
  instanceId: string;
  organizationId: string;
  configuration: Record<string, any>;
}>();

const emit = defineEmits<{
  save: [config: Record<string, any>];
  cancel: [];
}>();

const formData = ref<Record<string, any>>({
  widgetTitle: 'Chat with us',
  widgetSubtitle: 'We typically reply within minutes',
  position: 'right',
  theme: 'blue',
  showGreeting: true,
  greetingMessage: 'Hello! How can we help you today?',
  allowedDomains: '*',
  ...props.configuration,
});

const errors = ref<Record<string, string>>({});
const saving = ref(false);
const copied = ref(false);

const isValid = computed(() => {
  return formData.value.widgetTitle && 
         formData.value.position && 
         formData.value.theme &&
         Object.keys(errors.value).length === 0;
});

const embedCode = computed(() => {
  const baseUrl = window.location.origin.replace(':5173', ':3000');
  return `<!-- Hay Webchat Widget -->
<script>
  (function(h,a,y){
    var s=a.createElement('script');
    s.src='${baseUrl}/plugins/embed/${props.organizationId}/${props.instanceId}';
    s.async=true;
    a.head.appendChild(s);
  })(window,document);
</script>
<!-- End Hay Webchat Widget -->`;
});

const copyEmbedCode = async () => {
  try {
    await navigator.clipboard.writeText(embedCode.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
};

const saveConfiguration = async () => {
  if (!isValid.value) return;
  
  saving.value = true;
  try {
    await emit('save', formData.value);
  } finally {
    saving.value = false;
  }
};
</script>

<style scoped>
.webchat-configuration {
  max-width: 1200px;
  margin: 0 auto;
}
</style>