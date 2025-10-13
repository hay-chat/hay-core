import { SourceRepository } from "../repositories/source.repository";
import { Source } from "../database/entities/source.entity";
import { SourceCategory } from "../types/source.types";
import type { CreateSourceInput } from "../types/source.types";

export class SourceService {
  private sourceRepository: SourceRepository;

  constructor() {
    this.sourceRepository = new SourceRepository();
  }

  async getAllSources(): Promise<Source[]> {
    return this.sourceRepository.findAll();
  }

  async getSourceById(id: string): Promise<Source | null> {
    return this.sourceRepository.findById(id);
  }

  async getSourcesByPlugin(pluginId: string): Promise<Source[]> {
    return this.sourceRepository.findByPlugin(pluginId);
  }

  async getSourcesByCategory(category: SourceCategory): Promise<Source[]> {
    return this.sourceRepository.findByCategory(category);
  }

  async registerSource(data: CreateSourceInput): Promise<Source> {
    // Validate source ID format (lowercase, alphanumeric, dashes, underscores, colons)
    const validIdPattern = /^[a-z0-9_:-]+$/;
    if (!validIdPattern.test(data.id)) {
      throw new Error(
        "Source ID must be lowercase alphanumeric with dashes, underscores, or colons only"
      );
    }

    // Prevent modification of core sources
    const coreSources = ["playground", "webchat"];
    if (coreSources.includes(data.id)) {
      throw new Error(`Cannot register core source: ${data.id}`);
    }

    return this.sourceRepository.register(data);
  }

  async deactivateSource(id: string): Promise<boolean> {
    // Prevent deactivation of core sources
    const coreSources = ["playground", "webchat"];
    if (coreSources.includes(id)) {
      throw new Error(`Cannot deactivate core source: ${id}`);
    }

    return this.sourceRepository.deactivate(id);
  }

  async activateSource(id: string): Promise<boolean> {
    return this.sourceRepository.activate(id);
  }
}
