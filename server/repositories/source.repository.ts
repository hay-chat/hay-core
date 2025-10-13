import { AppDataSource } from "../database/data-source";
import { Source } from "../database/entities/source.entity";
import { Repository } from "typeorm";
import { SourceCategory } from "../types/source.types";
import type { CreateSourceInput } from "../types/source.types";

export class SourceRepository {
  private repository: Repository<Source>;

  constructor() {
    this.repository = AppDataSource.getRepository(Source);
  }

  async findAll(): Promise<Source[]> {
    return this.repository.find({
      where: { isActive: true },
      order: { name: "ASC" },
    });
  }

  async findById(id: string): Promise<Source | null> {
    return this.repository.findOne({
      where: { id, isActive: true },
    });
  }

  async findByPlugin(pluginId: string): Promise<Source[]> {
    return this.repository.find({
      where: { pluginId, isActive: true },
      order: { name: "ASC" },
    });
  }

  async findByCategory(category: SourceCategory): Promise<Source[]> {
    return this.repository.find({
      where: { category, isActive: true },
      order: { name: "ASC" },
    });
  }

  async register(data: CreateSourceInput): Promise<Source> {
    // Check if source already exists
    const existing = await this.repository.findOne({
      where: { id: data.id },
    });

    if (existing) {
      throw new Error(`Source with id "${data.id}" already exists`);
    }

    const source = this.repository.create({
      id: data.id,
      name: data.name,
      description: data.description || null,
      category: data.category,
      pluginId: data.pluginId || null,
      icon: data.icon || null,
      metadata: data.metadata || null,
      isActive: true,
    });

    return this.repository.save(source);
  }

  async deactivate(id: string): Promise<boolean> {
    const result = await this.repository.update(
      { id },
      { isActive: false }
    );
    return (result.affected || 0) > 0;
  }

  async activate(id: string): Promise<boolean> {
    const result = await this.repository.update(
      { id },
      { isActive: true }
    );
    return (result.affected || 0) > 0;
  }
}
