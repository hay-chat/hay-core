import { HayPlugin } from './HayPlugin';
import * as fs from 'fs';
import * as path from 'path';

export class PluginManager {
  private plugins: Map<string, HayPlugin> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.autoRegisterPlugins();
  }

  private async autoRegisterPlugins(): Promise<void> {
    const pluginsDir = __dirname;
    
    try {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = path.join(pluginsDir, entry.name, 'manifest.ts');
          
          if (fs.existsSync(manifestPath)) {
            try {
              const pluginModule = await import(manifestPath);
              
              const pluginExports = Object.values(pluginModule);
              const plugin = pluginExports.find((exp: any) => exp instanceof HayPlugin);
              
              if (plugin) {
                this.registerPlugin(plugin as HayPlugin);
              } else {
                console.warn(`No HayPlugin instance found in ${entry.name}/manifest.ts`);
              }
            } catch (error) {
              console.error(`Failed to load plugin from ${entry.name}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error auto-registering plugins:', error);
    }
  }

  private registerPlugin(plugin: HayPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered`);
      return;
    }
    this.plugins.set(plugin.name, plugin);
    console.log(`Registered plugin: ${plugin.name} v${plugin.version}`);
  }

  public async initializeAll(): Promise<void> {
    if (this.initialized) {
      console.warn('Plugins already initialized');
      return;
    }

    console.log('Initializing all plugins...');
    
    for (const [name, plugin] of this.plugins) {
      if (plugin.enabled) {
        try {
          if (plugin.validateSettings()) {
            await plugin.initialize();
            console.log(` Plugin ${name} initialized successfully`);
          } else {
            console.error(` Plugin ${name} has invalid settings`);
          }
        } catch (error) {
          console.error(` Failed to initialize plugin ${name}:`, error);
        }
      } else {
        console.log(`- Plugin ${name} is disabled`);
      }
    }
    
    this.initialized = true;
    console.log('Plugin initialization complete');
  }

  public async shutdownAll(): Promise<void> {
    console.log('Shutting down all plugins...');
    
    for (const [name, plugin] of this.plugins) {
      if (plugin.enabled) {
        try {
          await plugin.shutdown();
          console.log(` Plugin ${name} shut down successfully`);
        } catch (error) {
          console.error(` Failed to shut down plugin ${name}:`, error);
        }
      }
    }
    
    this.initialized = false;
    console.log('Plugin shutdown complete');
  }

  public getPlugin(name: string): HayPlugin | undefined {
    return this.plugins.get(name);
  }

  public getAllPlugins(): HayPlugin[] {
    return Array.from(this.plugins.values());
  }

  public getEnabledPlugins(): HayPlugin[] {
    return this.getAllPlugins().filter(plugin => plugin.enabled);
  }

  public getPluginConfig(name: string): any {
    const plugin = this.getPlugin(name);
    return plugin ? plugin.getConfig() : null;
  }

  public getAllPluginConfigs(): any[] {
    return this.getAllPlugins().map(plugin => plugin.getConfig());
  }
}

export const pluginManager = new PluginManager();

export { HayPlugin } from './HayPlugin';