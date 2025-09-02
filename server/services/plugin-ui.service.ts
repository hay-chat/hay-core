import path from 'path';
import fs from 'fs/promises';
import { pluginRegistryRepository } from '../repositories/plugin-registry.repository';
import { pluginInstanceRepository } from '../repositories/plugin-instance.repository';

interface UITemplate {
  name: string;
  content: string;
  type: 'vue' | 'html' | 'json';
}

interface ConfigField {
  type: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: any;
  options?: Array<{ label: string; value: any }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export class PluginUIService {
  private templateCache = new Map<string, UITemplate>();

  /**
   * Get configuration template for a plugin
   */
  async getConfigurationTemplate(pluginId: string): Promise<string | null> {
    const cacheKey = `${pluginId}:configuration`;
    
    // Check cache first
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey)!.content;
    }

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as any;
    
    // Check if plugin has custom configuration UI
    if (manifest.ui?.configuration) {
      const pluginDir = path.join(process.cwd(), 'plugins', plugin.pluginId.replace('hay-plugin-', ''));
      const templatePath = path.join(pluginDir, manifest.ui.configuration);
      
      try {
        const content = await fs.readFile(templatePath, 'utf-8');
        const template: UITemplate = {
          name: 'configuration',
          content,
          type: 'vue',
        };
        
        this.templateCache.set(cacheKey, template);
        return content;
      } catch (error) {
        console.error(`Failed to load configuration template for ${plugin.name}:`, error);
      }
    }

    // If no custom template, generate one from configSchema
    if (manifest.configSchema) {
      const generatedTemplate = this.generateConfigurationTemplate(
        manifest.configSchema,
        plugin.name
      );
      
      const template: UITemplate = {
        name: 'configuration',
        content: generatedTemplate,
        type: 'vue',
      };
      
      this.templateCache.set(cacheKey, template);
      return generatedTemplate;
    }

    return null;
  }

  /**
   * Generate Vue template from config schema
   */
  private generateConfigurationTemplate(
    configSchema: Record<string, ConfigField>,
    pluginName: string
  ): string {
    const fields = Object.entries(configSchema).map(([key, field]) => {
      return this.generateFormField(key, field);
    }).join('\n\n    ');

    return `
<template>
  <div class="plugin-configuration">
    <Card>
      <CardHeader>
        <CardTitle>${pluginName} Configuration</CardTitle>
        <CardDescription>Configure your ${pluginName} plugin settings</CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="saveConfiguration" class="space-y-4">
          ${fields}
          
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
import { Loader2 } from 'lucide-vue-next';

const props = defineProps<{
  instanceId: string;
  configuration: Record<string, any>;
}>();

const emit = defineEmits<{
  save: [config: Record<string, any>];
  cancel: [];
}>();

const formData = ref<Record<string, any>>({ ...props.configuration });
const errors = ref<Record<string, string>>({});
const saving = ref(false);

const isValid = computed(() => {
  return Object.keys(errors.value).length === 0;
});

const validateField = (key: string, value: any) => {
  const schema = ${JSON.stringify(configSchema)};
  const field = schema[key];
  
  if (!field) return;
  
  delete errors.value[key];
  
  if (field.required && !value) {
    errors.value[key] = \`\${field.label || key} is required\`;
    return;
  }
  
  if (field.validation?.pattern) {
    const regex = new RegExp(field.validation.pattern);
    if (!regex.test(value)) {
      errors.value[key] = field.validation.message || \`Invalid format for \${field.label || key}\`;
    }
  }
  
  if (field.type === 'number') {
    const num = Number(value);
    if (field.validation?.min !== undefined && num < field.validation.min) {
      errors.value[key] = \`Minimum value is \${field.validation.min}\`;
    }
    if (field.validation?.max !== undefined && num > field.validation.max) {
      errors.value[key] = \`Maximum value is \${field.validation.max}\`;
    }
  }
};

// Watch for changes and validate
Object.keys(formData.value).forEach(key => {
  watch(() => formData.value[key], (newValue) => {
    validateField(key, newValue);
  });
});

const saveConfiguration = async () => {
  // Validate all fields
  Object.keys(formData.value).forEach(key => {
    validateField(key, formData.value[key]);
  });
  
  if (!isValid.value) return;
  
  saving.value = true;
  try {
    await emit('save', formData.value);
  } finally {
    saving.value = false;
  }
};
</script>
    `.trim();
  }

  /**
   * Generate form field based on type
   */
  private generateFormField(key: string, field: ConfigField): string {
    const label = field.label || key;
    const description = field.description ? `<p class="text-sm text-muted-foreground">${field.description}</p>` : '';
    const required = field.required ? 'required' : '';
    const errorDisplay = `<p v-if="errors.${key}" class="text-sm text-destructive mt-1">{{ errors.${key} }}</p>`;

    switch (field.type) {
      case 'select':
        if (field.options) {
          return `
    <div class="space-y-2">
      <Label for="${key}" ${required}>${label}</Label>
      ${description}
      <Select v-model="formData.${key}">
        <SelectTrigger id="${key}">
          <SelectValue placeholder="Select ${label.toLowerCase()}" />
        </SelectTrigger>
        <SelectContent>
          ${field.options.map(opt => 
            `<SelectItem value="${opt.value}">${opt.label}</SelectItem>`
          ).join('\n          ')}
        </SelectContent>
      </Select>
      ${errorDisplay}
    </div>`;
        }
        return this.generateTextField(key, field);

      case 'boolean':
        return `
    <div class="flex items-center justify-between space-x-2">
      <div class="space-y-0.5">
        <Label for="${key}">${label}</Label>
        ${description}
      </div>
      <Switch id="${key}" v-model="formData.${key}" />
    </div>`;

      case 'textarea':
        return `
    <div class="space-y-2">
      <Label for="${key}" ${required}>${label}</Label>
      ${description}
      <Textarea 
        id="${key}" 
        v-model="formData.${key}"
        placeholder="Enter ${label.toLowerCase()}"
        rows="4"
      />
      ${errorDisplay}
    </div>`;

      case 'number':
        return `
    <div class="space-y-2">
      <Label for="${key}" ${required}>${label}</Label>
      ${description}
      <Input 
        id="${key}" 
        v-model.number="formData.${key}"
        type="number"
        placeholder="Enter ${label.toLowerCase()}"
        ${field.validation?.min !== undefined ? `min="${field.validation.min}"` : ''}
        ${field.validation?.max !== undefined ? `max="${field.validation.max}"` : ''}
      />
      ${errorDisplay}
    </div>`;

      default:
        return this.generateTextField(key, field);
    }
  }

  /**
   * Generate text input field
   */
  private generateTextField(key: string, field: ConfigField): string {
    const label = field.label || key;
    const description = field.description ? `<p class="text-sm text-muted-foreground">${field.description}</p>` : '';
    const required = field.required ? 'required' : '';
    const errorDisplay = `<p v-if="errors.${key}" class="text-sm text-destructive mt-1">{{ errors.${key} }}</p>`;
    const type = field.type === 'password' ? 'password' : 'text';

    return `
    <div class="space-y-2">
      <Label for="${key}" ${required}>${label}</Label>
      ${description}
      <Input 
        id="${key}" 
        v-model="formData.${key}"
        type="${type}"
        placeholder="Enter ${label.toLowerCase()}"
      />
      ${errorDisplay}
    </div>`;
  }

  /**
   * Get all available templates for a plugin
   */
  async getPluginTemplates(pluginId: string): Promise<Record<string, UITemplate>> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as any;
    const templates: Record<string, UITemplate> = {};

    if (manifest.ui?.templates) {
      const pluginDir = path.join(process.cwd(), 'plugins', plugin.pluginId.replace('hay-plugin-', ''));
      
      for (const [name, filePath] of Object.entries(manifest.ui.templates)) {
        try {
          const fullPath = path.join(pluginDir, filePath as string);
          const content = await fs.readFile(fullPath, 'utf-8');
          
          templates[name] = {
            name,
            content,
            type: this.detectTemplateType(filePath as string),
          };
        } catch (error) {
          console.error(`Failed to load template ${name} for ${plugin.name}:`, error);
        }
      }
    }

    return templates;
  }

  /**
   * Detect template type from file extension
   */
  private detectTemplateType(filePath: string): 'vue' | 'html' | 'json' {
    if (filePath.endsWith('.vue')) return 'vue';
    if (filePath.endsWith('.html')) return 'html';
    if (filePath.endsWith('.json')) return 'json';
    return 'html';
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * Clear cache for specific plugin
   */
  clearPluginCache(pluginId: string): void {
    for (const key of this.templateCache.keys()) {
      if (key.startsWith(`${pluginId}:`)) {
        this.templateCache.delete(key);
      }
    }
  }
}

export const pluginUIService = new PluginUIService();