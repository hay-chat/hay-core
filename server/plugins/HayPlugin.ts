export interface PluginSettings {
  [key: string]: any;
}

export interface HayPluginConfig {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  settings: PluginSettings;
  enabled?: boolean;
  dependencies?: string[];
}

export class HayPlugin {
  public name: string;
  public version: string;
  public description: string;
  public author: string;
  public settings: PluginSettings;
  public enabled: boolean;
  public dependencies: string[];

  constructor(config: HayPluginConfig) {
    this.name = config.name;
    this.version = config.version || '1.0.0';
    this.description = config.description || '';
    this.author = config.author || '';
    this.settings = config.settings;
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.dependencies = config.dependencies || [];
  }

  public async initialize(): Promise<void> {
    console.log(`Initializing plugin: ${this.name} v${this.version}`);
  }

  public async shutdown(): Promise<void> {
    console.log(`Shutting down plugin: ${this.name}`);
  }

  public validateSettings(): boolean {
    return true;
  }

  public getConfig(): HayPluginConfig {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      settings: this.settings,
      enabled: this.enabled,
      dependencies: this.dependencies
    };
  }
}