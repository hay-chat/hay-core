import * as fs from "fs";
import * as path from "path";
import { hookManager } from "../hooks/hook-manager";
import { Express } from "express";

export interface ExtensionCore {
  hookManager: typeof hookManager;
  app: Express;
  router: any; // AppRouter type
  dashboard?: {
    addRoute: (path: string, loader: () => Promise<any>) => void;
  };
}

export interface Extension {
  initialize: (core: ExtensionCore) => Promise<void>;
  shutdown?: () => Promise<void>;
}

export class ExtensionLoader {
  private static instance: ExtensionLoader;
  private extensions: Extension[] = [];
  private app: Express | null = null;
  private router: any | null = null;

  private constructor() {}

  static getInstance(): ExtensionLoader {
    if (!ExtensionLoader.instance) {
      ExtensionLoader.instance = new ExtensionLoader();
    }
    return ExtensionLoader.instance;
  }

  setApp(app: Express): void {
    this.app = app;
  }

  setRouter(router: any): void {
    this.router = router;
  }

  async loadExtensions(): Promise<void> {
    const extensionPath = process.env.HAY_EXTENSIONS_PATH;

    if (!extensionPath) {
      console.log("[ExtensionLoader] No extensions path configured");
      return;
    }

    if (!fs.existsSync(extensionPath)) {
      console.log(`[ExtensionLoader] Extensions path does not exist: ${extensionPath}`);
      return;
    }

    if (!this.app || !this.router) {
      console.error("[ExtensionLoader] App or router not set, cannot load extensions");
      return;
    }

    try {
      console.log(`[ExtensionLoader] Loading extensions from: ${extensionPath}`);

      const core: ExtensionCore = {
        hookManager,
        app: this.app,
        router: this.router,
        // Dashboard integration will be added later if needed
      };

      // Dynamic import of the extension module
      const extensionModule = await import(extensionPath);

      if (typeof extensionModule.initialize === "function") {
        await extensionModule.initialize(core);
        this.extensions.push(extensionModule);
        console.log("[ExtensionLoader] Extension loaded successfully");
      } else {
        console.error("[ExtensionLoader] Extension does not export an initialize function");
      }
    } catch (error) {
      console.error("[ExtensionLoader] Failed to load extensions:", error);
    }
  }

  async shutdown(): Promise<void> {
    for (const extension of this.extensions) {
      if (extension.shutdown) {
        try {
          await extension.shutdown();
        } catch (error) {
          console.error("[ExtensionLoader] Error shutting down extension:", error);
        }
      }
    }
    this.extensions = [];
  }

  getLoadedExtensions(): Extension[] {
    return [...this.extensions];
  }
}

export const extensionLoader = ExtensionLoader.getInstance();