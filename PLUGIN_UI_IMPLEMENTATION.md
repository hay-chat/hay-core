# Plugin UI Implementation Plan

**Date**: 2025-12-27
**Status**: Planning Phase
**Related**: `PLUGIN_SDK_MIGRATION_PROGRESS.md` - Zendesk & Shopify migrations

---

## Overview

This document outlines the implementation plan for enabling plugins to provide Vue components that render in the Hay dashboard. This is critical for the V2 plugin SDK migration, specifically for Zendesk and Shopify plugins which currently use UI extensions.

### Current V1 Pattern

```typescript
// Plugin registers UI component
this.registerUIExtension({
  slot: 'after-settings',
  component: 'components/settings/AfterSettings.vue',
});
```

The component is a standard Vue 3 SFC with:
- Props: `plugin`, `config`, `apiBaseUrl`
- Emits: `update:config`
- Purpose: Tutorial content with images for setup instructions

---

## Architecture Decision: Option B (Dynamic Route-Based Loading)

**Selected Approach**: Plugins build Vue components to bundles, dashboard loads them dynamically via runtime imports.

### Why This Approach?

1. ✅ Supports external plugin uploads (developer can send built bundle)
2. ✅ No server restart required (dynamic imports at runtime)
3. ✅ Plugin isolation (separate builds)
4. ✅ Security scoped at backend (all API calls through tRPC with org validation)
5. ✅ Familiar Vue DX for plugin developers

---

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Plugin Manifest Schema Extension

**File**: `plugins/base/plugin-manifest.schema.json`

Add `pages` field to manifest:

```json
{
  "pages": {
    "type": "array",
    "description": "Custom UI pages provided by the plugin",
    "items": {
      "type": "object",
      "required": ["id", "title", "component"],
      "properties": {
        "id": {
          "type": "string",
          "description": "Unique identifier for the page (e.g., 'settings', 'analytics')"
        },
        "title": {
          "type": "string",
          "description": "Display title for the page"
        },
        "component": {
          "type": "string",
          "description": "Path to the Vue component relative to plugin root (e.g., './pages/Settings.vue')"
        },
        "icon": {
          "type": "string",
          "description": "Icon name for the page (optional)"
        },
        "slot": {
          "type": "string",
          "enum": ["standalone", "after-settings", "before-settings"],
          "description": "Where to render the component (standalone = own route, after-settings = below config form)",
          "default": "standalone"
        },
        "requiresSetup": {
          "type": "boolean",
          "description": "Whether the page requires plugin setup to be complete",
          "default": false
        }
      }
    }
  }
}
```

**Example manifest** (Zendesk):

```json
{
  "id": "hay-plugin-zendesk",
  "name": "Zendesk",
  "pages": [
    {
      "id": "setup-guide",
      "title": "Setup Guide",
      "component": "./components/settings/AfterSettings.vue",
      "slot": "after-settings",
      "icon": "book"
    }
  ]
}
```

#### 1.2 SDK V2 Plugin Registration API

**File**: `plugin-sdk-v2/src/types.ts`

Add UI registration to SDK context:

```typescript
export interface PluginPage {
  id: string;
  title: string;
  component: string;
  icon?: string;
  slot?: 'standalone' | 'after-settings' | 'before-settings';
  requiresSetup?: boolean;
}

export interface PluginRegisterContext {
  config(options: ConfigOptions): void;
  auth: AuthRegistration;
  ui: {
    page(page: PluginPage): void;
  };
}
```

**Usage in Plugin** (Zendesk V2):

```typescript
import { defineHayPlugin } from '@hay/plugin-sdk-v2';

export default defineHayPlugin((globalCtx) => ({
  name: 'Zendesk',

  onInitialize(ctx) {
    // Register UI page
    ctx.register.ui.page({
      id: 'setup-guide',
      title: 'Setup Guide',
      component: './components/settings/AfterSettings.vue',
      slot: 'after-settings',
    });
  },

  async onStart(ctx) {
    // MCP setup...
  }
}));
```

#### 1.3 Plugin Build System

**New File**: `plugins/core/zendesk/vite.config.ui.ts`

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'components/index.ts'), // Export all components
      formats: ['es'],
      fileName: 'ui',
    },
    outDir: 'dist',
    rollupOptions: {
      // Externalize Vue and any shared dependencies
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
});
```

**New File**: `plugins/core/zendesk/components/index.ts`

```typescript
// Export all UI components
export { default as AfterSettings } from './settings/AfterSettings.vue';
```

**Update**: `plugins/core/zendesk/package.json`

```json
{
  "scripts": {
    "build": "npm run build:mcp && npm run build:ui",
    "build:mcp": "tsc",
    "build:ui": "vite build --config vite.config.ui.ts",
    "dev:ui": "vite build --watch --config vite.config.ui.ts"
  }
}
```

**Build Output**:
```
plugins/core/zendesk/dist/
  ├── ui.js           # Vue component bundle
  └── index.js        # MCP server code
```

#### 1.4 Post-Build: Copy to Dashboard Public

**Update**: `scripts/build-plugins.sh`

```bash
#!/bin/bash
# After building each plugin, copy UI bundle to dashboard public directory

for plugin in plugins/core/*; do
  if [ -f "$plugin/dist/ui.js" ]; then
    plugin_id=$(basename "$plugin")
    mkdir -p "dashboard/public/plugins/$plugin_id"
    cp "$plugin/dist/ui.js" "dashboard/public/plugins/$plugin_id/"

    # Also copy public assets (images, etc.)
    if [ -d "$plugin/public" ]; then
      cp -r "$plugin/public/"* "dashboard/public/plugins/$plugin_id/"
    fi

    echo "✅ Copied UI bundle for $plugin_id"
  fi
done
```

---

### Phase 2: Dashboard Integration

#### 2.1 Plugin Registry Composable

**New File**: `dashboard/composables/usePluginRegistry.ts`

```typescript
import { defineAsyncComponent, type Component } from 'vue';

interface PluginComponentCache {
  [key: string]: Component;
}

export const usePluginRegistry = () => {
  const componentCache: PluginComponentCache = {};

  /**
   * Load a plugin page component dynamically
   * @param pluginId - Plugin identifier (e.g., 'hay-plugin-zendesk')
   * @param componentName - Component name from export (e.g., 'AfterSettings')
   */
  const loadPluginComponent = (
    pluginId: string,
    componentName: string
  ): Component | null => {
    const cacheKey = `${pluginId}:${componentName}`;

    if (componentCache[cacheKey]) {
      return componentCache[cacheKey];
    }

    try {
      const component = defineAsyncComponent({
        loader: async () => {
          // Dynamic import from public directory
          // @vite-ignore tells Vite this is truly dynamic
          const module = await import(
            /* @vite-ignore */ `/plugins/${pluginId}/ui.js`
          );

          if (!module[componentName]) {
            throw new Error(
              `Component "${componentName}" not found in plugin "${pluginId}"`
            );
          }

          return module[componentName];
        },
        delay: 200,
        timeout: 10000,
      });

      componentCache[cacheKey] = component;
      return component;
    } catch (error) {
      console.error(
        `Failed to load plugin component ${pluginId}/${componentName}:`,
        error
      );
      return null;
    }
  };

  /**
   * Clear component cache (useful for development hot reload)
   */
  const clearCache = () => {
    Object.keys(componentCache).forEach((key) => delete componentCache[key]);
  };

  return {
    loadPluginComponent,
    clearCache,
  };
};
```

#### 2.2 Plugin Page Slot Component

**New File**: `dashboard/components/plugins/PluginPageSlot.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { usePluginRegistry } from '@/composables/usePluginRegistry';

interface Props {
  pluginId: string;
  componentName: string;
  plugin?: any;
  config?: any;
  apiBaseUrl?: string;
}

const props = withDefaults(defineProps<Props>(), {
  apiBaseUrl: 'http://localhost:3001',
});

const emit = defineEmits<{
  'update:config': [value: any];
}>();

const pluginRegistry = usePluginRegistry();

const PluginComponent = computed(() => {
  return pluginRegistry.loadPluginComponent(props.pluginId, props.componentName);
});

const componentProps = computed(() => ({
  plugin: props.plugin,
  config: props.config,
  apiBaseUrl: props.apiBaseUrl,
}));
</script>

<template>
  <div class="plugin-page-slot">
    <component
      :is="PluginComponent"
      v-if="PluginComponent"
      v-bind="componentProps"
      @update:config="emit('update:config', $event)"
    />
    <div v-else class="plugin-loading">
      <p>Loading plugin component...</p>
    </div>
  </div>
</template>

<style scoped>
.plugin-page-slot {
  width: 100%;
}

.plugin-loading {
  padding: 2rem;
  text-align: center;
  color: var(--color-neutral-muted);
}
</style>
```

#### 2.3 Integration into Plugin Settings Page

**Update**: `dashboard/pages/plugins/[id]/settings.vue`

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Hay } from '@/utils/api';
import PluginPageSlot from '@/components/plugins/PluginPageSlot.vue';

const route = useRoute();
const pluginId = computed(() => route.params.id as string);

const plugin = ref<any>(null);
const config = ref<any>({});
const pluginMetadata = ref<any>(null);

const loadPlugin = async () => {
  const response = await Hay.plugins.getById({ id: pluginId.value });
  plugin.value = response;
  config.value = response.config || {};

  // Get plugin metadata (includes pages info)
  const metadata = await Hay.plugins.getMetadata({ id: pluginId.value });
  pluginMetadata.value = metadata;
};

const afterSettingsPages = computed(() => {
  return pluginMetadata.value?.pages?.filter(
    (page: any) => page.slot === 'after-settings'
  ) || [];
});

const saveConfig = async () => {
  await Hay.plugins.updateConfig({
    id: pluginId.value,
    config: config.value,
  });
};

onMounted(loadPlugin);
</script>

<template>
  <div class="plugin-settings-page">
    <PageHeader :title="`${plugin?.name || 'Plugin'} Settings`" />

    <!-- Standard config form -->
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <!-- Config fields rendered here -->
        <PluginConfigForm v-model="config" :plugin="plugin" />

        <div class="mt-4">
          <Button @click="saveConfig">Save Settings</Button>
        </div>
      </CardContent>
    </Card>

    <!-- After-settings slot: Plugin-provided UI components -->
    <div v-if="afterSettingsPages.length > 0" class="mt-6">
      <PluginPageSlot
        v-for="page in afterSettingsPages"
        :key="page.id"
        :plugin-id="pluginId"
        :component-name="page.component"
        :plugin="plugin"
        :config="config"
        @update:config="config = $event"
      />
    </div>
  </div>
</template>
```

---

### Phase 3: Server-Side Support

#### 3.1 Plugin Metadata Endpoint Enhancement

**File**: `server/routes/v1/plugins/plugins.handler.ts`

Update `getPluginMetadata` to include pages info:

```typescript
export const getPluginMetadata = authenticatedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input, ctx }) => {
    const plugin = await PluginRegistry.findOne({
      where: { id: input.id }
    });

    if (!plugin) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // Load manifest to get pages
    const manifestPath = path.join(
      process.cwd(),
      'plugins/core',
      plugin.id,
      'manifest.json'
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

    return {
      ...plugin,
      pages: manifest.pages || [],
    };
  });
```

#### 3.2 Static Asset Serving

**File**: `server/main.ts`

Ensure plugin public assets are served:

```typescript
// Serve plugin UI bundles and assets
app.use('/plugins', express.static(path.join(__dirname, '../dashboard/public/plugins')));
```

This allows:
- `/plugins/hay-plugin-zendesk/ui.js` → Vue component bundle
- `/plugins/hay-plugin-zendesk/images/Z00001.png` → Plugin images

---

### Phase 4: Developer SDK Package (Optional Enhancement)

**New Package**: `@hay/plugin-ui-sdk`

Provides helpers for plugin developers:

```typescript
// @hay/plugin-ui-sdk
export { defineComponent, ref, computed, onMounted } from 'vue';

export interface PluginComponentProps {
  plugin: any;
  config: any;
  apiBaseUrl: string;
}

export const definePluginComponent = <T>(
  setup: (props: PluginComponentProps) => T
) => {
  return defineComponent({
    props: {
      plugin: { type: Object, default: () => ({}) },
      config: { type: Object, default: () => ({}) },
      apiBaseUrl: { type: String, default: 'http://localhost:3001' },
    },
    emits: ['update:config'],
    setup,
  });
};
```

**Usage in Plugin**:

```vue
<script setup lang="ts">
import { definePluginComponent } from '@hay/plugin-ui-sdk';

export default definePluginComponent((props) => {
  const imageUrl = computed(() =>
    `${props.apiBaseUrl}/plugins/${props.plugin.id}/images/tutorial.png`
  );

  return { imageUrl };
});
</script>
```

---

## Migration Path for Existing Plugins

### Zendesk Migration Checklist

- [ ] Create `vite.config.ui.ts` for UI build
- [ ] Create `components/index.ts` to export `AfterSettings`
- [ ] Add `build:ui` script to `package.json`
- [ ] Update manifest to include `pages` field
- [ ] Update SDK V2 migration to use `ctx.register.ui.page()`
- [ ] Build plugin and verify `dist/ui.js` is created
- [ ] Run `scripts/build-plugins.sh` to copy to dashboard
- [ ] Test in dashboard settings page

### Shopify Migration Checklist

Same as Zendesk (follow the established pattern).

---

## Security Considerations

### 1. **Component Isolation**
- Plugins ship pre-built Vue components (no runtime compilation of untrusted code)
- Components are loaded from static files (no arbitrary code execution)

### 2. **Backend Enforcement**
- All plugin data access goes through tRPC with org-scoped auth
- Components can't bypass API security
- No direct database access from components

### 3. **CSP Compliance**
- Plugin bundles served from same origin (`/plugins/*`)
- No inline scripts needed
- Standard CSP rules apply

### 4. **Dependency Management**
- Vue externalized to prevent version conflicts
- Plugins can't override core dashboard dependencies
- Shared UI components from dashboard available via future enhancement

---

## Testing Strategy

### Unit Tests

```typescript
// dashboard/composables/__tests__/usePluginRegistry.spec.ts
describe('usePluginRegistry', () => {
  it('should load plugin component from bundle', async () => {
    const { loadPluginComponent } = usePluginRegistry();
    const component = loadPluginComponent('hay-plugin-zendesk', 'AfterSettings');
    expect(component).toBeDefined();
  });

  it('should cache loaded components', () => {
    const { loadPluginComponent } = usePluginRegistry();
    const comp1 = loadPluginComponent('hay-plugin-zendesk', 'AfterSettings');
    const comp2 = loadPluginComponent('hay-plugin-zendesk', 'AfterSettings');
    expect(comp1).toBe(comp2); // Same instance
  });
});
```

### Integration Tests

- Load plugin settings page
- Verify after-settings component renders
- Verify images load from plugin assets
- Verify config updates emit correctly

---

## Phase 5: Standalone Plugin Pages & Tabs (Priority Enhancement)

### 5.1 Standalone Page Routes

**Use Case**: Plugins can define full-page routes beyond settings (e.g., analytics, dashboards, custom tools)

**Manifest Extension**:

```json
{
  "pages": [
    {
      "id": "settings",
      "title": "Settings",
      "component": "./pages/Settings.vue",
      "slot": "standalone",
      "icon": "settings",
      "route": "/settings"
    },
    {
      "id": "analytics",
      "title": "Analytics",
      "component": "./pages/Analytics.vue",
      "slot": "standalone",
      "icon": "bar-chart",
      "route": "/analytics",
      "requiresSetup": true
    }
  ]
}
```

**Dynamic Route Generation**:

**New File**: `dashboard/pages/plugins/[id]/[...page].vue`

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Hay } from '@/utils/api';
import { usePluginRegistry } from '@/composables/usePluginRegistry';

const route = useRoute();
const pluginId = computed(() => route.params.id as string);
const pagePath = computed(() => {
  const pages = route.params.page as string[];
  return pages?.join('/') || 'settings';
});

const plugin = ref<any>(null);
const pluginMetadata = ref<any>(null);
const currentPage = ref<any>(null);

const loadPlugin = async () => {
  plugin.value = await Hay.plugins.getById({ id: pluginId.value });
  pluginMetadata.value = await Hay.plugins.getMetadata({ id: pluginId.value });

  // Find the page definition
  currentPage.value = pluginMetadata.value?.pages?.find(
    (p: any) => p.route === `/${pagePath.value}`
  );
};

const pluginRegistry = usePluginRegistry();

const PluginPageComponent = computed(() => {
  if (!currentPage.value) return null;

  // Extract component name from path (e.g., './pages/Analytics.vue' -> 'Analytics')
  const componentName = currentPage.value.component
    .split('/')
    .pop()
    .replace('.vue', '');

  return pluginRegistry.loadPluginComponent(pluginId.value, componentName);
});

const pluginContext = computed(() => ({
  organizationId: useAuth().organizationId,
  pluginId: pluginId.value,
  api: usePluginAPI(pluginId.value),
  components: useHayComponents(),
  router: useRouter(),
  toast: useNotifications().toast,
}));

onMounted(loadPlugin);
</script>

<template>
  <div class="plugin-page">
    <PageHeader :title="currentPage?.title || 'Plugin Page'" />

    <component
      :is="PluginPageComponent"
      v-if="PluginPageComponent"
      v-bind="pluginContext"
    />
    <div v-else class="p-8 text-center text-neutral-muted">
      <p>Page not found</p>
    </div>
  </div>
</template>
```

### 5.2 Tabbed Plugin Pages

**Use Case**: Plugin has multiple pages/sections, use tabs for navigation

**Component**: Use existing `Tabs` component from `@/components/ui/tabs`

**Example Plugin Page with Tabs**:

```vue
<!-- plugins/zendesk/pages/Dashboard.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface Props {
  organizationId: string;
  pluginId: string;
  api: any;
  components: any;
}

const props = defineProps<Props>();
const { Card, CardHeader, CardTitle, CardContent } = props.components;

const activeTab = ref('overview');
const stats = ref<any>({});

const loadStats = async () => {
  stats.value = await props.api.callTool('get_stats', {});
};

onMounted(loadStats);
</script>

<template>
  <div class="plugin-dashboard">
    <Tabs v-model="activeTab">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tickets">Tickets</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Total Tickets: {{ stats.totalTickets }}</p>
            <p>Open: {{ stats.openTickets }}</p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="tickets">
        <!-- Tickets content -->
      </TabsContent>

      <TabsContent value="analytics">
        <!-- Analytics content -->
      </TabsContent>
    </Tabs>
  </div>
</template>
```

### 5.3 Sidebar Navigation for Plugin Pages

**Update**: `dashboard/components/layout/Sidebar.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Hay } from '@/utils/api';

const installedPlugins = await Hay.plugins.listInstalled();

// Group plugins by whether they have standalone pages
const pluginsWithPages = computed(() => {
  return installedPlugins.filter(p => {
    const standalonePages = p.pages?.filter((page: any) => page.slot === 'standalone');
    return standalonePages && standalonePages.length > 0;
  });
});

const pluginMenuItems = computed(() => {
  return pluginsWithPages.value.map(plugin => {
    const standalonePages = plugin.pages.filter((p: any) => p.slot === 'standalone');

    return {
      label: plugin.name,
      icon: plugin.icon,
      children: standalonePages.map((page: any) => ({
        label: page.title,
        to: `/plugins/${plugin.id}${page.route}`,
        icon: page.icon,
      })),
    };
  });
});
</script>

<template>
  <nav class="sidebar">
    <!-- Standard navigation -->
    <NavItem to="/conversations">Conversations</NavItem>
    <NavItem to="/customers">Customers</NavItem>

    <!-- Plugin navigation -->
    <NavGroup v-if="pluginMenuItems.length > 0" label="Plugins">
      <NavItem
        v-for="plugin in pluginMenuItems"
        :key="plugin.label"
        :icon="plugin.icon"
      >
        <template #label>{{ plugin.label }}</template>
        <NavSubItem
          v-for="page in plugin.children"
          :key="page.to"
          :to="page.to"
          :icon="page.icon"
        >
          {{ page.label }}
        </NavSubItem>
      </NavItem>
    </NavGroup>
  </nav>
</template>
```

---

## Future Enhancements

### 1. **Shared Component Library**
Allow plugins to use Hay UI components (Button, Input, Tabs, etc.):

```typescript
// Plugin imports shared components
import { Button, Input, Tabs } from '@hay/ui-components';
```

This requires:
- Exporting UI components as UMD bundle
- Loading shared bundle before plugin bundles
- Configuring Vite to externalize these imports

**Status**: Can be done later, plugins currently build with Vue externalized

### 3. **Plugin-to-Plugin Communication**
Allow plugins to interact:

```typescript
// In plugin component
const stripe = usePlugin('hay-plugin-stripe');
const paymentMethods = await stripe.getPaymentMethods();
```

### 4. **Hot Module Replacement (HMR)**
In development, support hot reload of plugin components without full page refresh.

---

## Open Questions

- [x] ~~Build system for plugin UI bundles~~ → Use Vite with lib mode
- [x] ~~Where to copy built bundles~~ → `dashboard/public/plugins/{id}/`
- [x] ~~How to handle images and static assets~~ → Copy to same directory
- [ ] Should we version plugin UI bundles? (e.g., `ui.v1.js`)
- [ ] How to handle breaking changes in Vue or dashboard updates?
- [ ] Should plugins be able to register multiple pages with standalone routes?
- [ ] Do we need a plugin component playground/preview for development?

---

## Implementation Timeline

**Phase 1 (Core Infrastructure)**: 4-6 hours
- Manifest schema update
- SDK types update
- Build system setup
- Build script updates

**Phase 2 (Dashboard Integration)**: 2-3 hours
- Plugin registry composable
- PluginPageSlot component
- Settings page integration

**Phase 3 (Server Support)**: 1 hour
- Metadata endpoint enhancement
- Static asset serving verification

**Phase 4 (Migration)**: 2-3 hours
- Migrate Zendesk plugin
- Migrate Shopify plugin
- Test both plugins

**Total**: ~9-13 hours

**Phase 5 (Optional)**: 2-3 hours
- Standalone page routing
- Sidebar navigation updates
- Tab example documentation

---

## Success Criteria

### Core Requirements (Phases 1-4)
✅ Zendesk plugin shows setup guide below settings form
✅ Shopify plugin shows setup guide below settings form
✅ Images load correctly from plugin assets
✅ No server restart needed when installing new plugins
✅ Plugin components are isolated and can't break dashboard
✅ TypeScript types are correct for plugin developers
✅ Build process is documented and reproducible

### Enhanced Requirements (Phase 5 - Optional)
✅ Plugins can register standalone pages with custom routes
✅ Plugin pages show in sidebar navigation
✅ Plugins can use Tabs component for multi-section pages
✅ Dynamic routes work without server restart

---

## References

- Related migration doc: `PLUGIN_SDK_MIGRATION_PROGRESS.md`
- Plugin manifest schema: `plugins/base/plugin-manifest.schema.json`
- SDK V2 types: `plugin-sdk-v2/src/types.ts`
- Current Zendesk implementation: `plugins/core/zendesk/src/index.ts`
- Current Shopify implementation: `plugins/core/shopify/src/index.ts`
