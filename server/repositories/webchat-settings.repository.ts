import { AppDataSource } from "@server/database/data-source";
import { WebchatSettings } from "@server/database/entities/webchat-settings.entity";
import { Repository } from "typeorm";

class WebchatSettingsRepository {
  private repository: Repository<WebchatSettings>;

  constructor() {
    this.repository = AppDataSource.getRepository(WebchatSettings);
  }

  /**
   * Get webchat settings for an organization
   */
  async findByOrganizationId(organizationId: string): Promise<WebchatSettings | null> {
    return await this.repository.findOne({
      where: { organizationId },
    });
  }

  /**
   * Create default webchat settings for an organization
   */
  async createDefault(organizationId: string): Promise<WebchatSettings> {
    const settings = this.repository.create({
      organizationId,
      // Defaults are already set in the entity
    });

    return await this.repository.save(settings);
  }

  /**
   * Get or create webchat settings for an organization
   */
  async getOrCreate(organizationId: string): Promise<WebchatSettings> {
    let settings = await this.findByOrganizationId(organizationId);

    if (!settings) {
      settings = await this.createDefault(organizationId);
    }

    return settings;
  }

  /**
   * Update webchat settings
   */
  async update(
    organizationId: string,
    data: Partial<Omit<WebchatSettings, "id" | "organizationId" | "createdAt" | "updatedAt">>,
  ): Promise<WebchatSettings> {
    const settings = await this.getOrCreate(organizationId);

    // Update fields
    Object.assign(settings, data);

    return await this.repository.save(settings);
  }

  /**
   * Delete webchat settings
   */
  async delete(organizationId: string): Promise<void> {
    await this.repository.delete({ organizationId });
  }

  /**
   * Check if webchat is enabled for an organization
   */
  async isEnabled(organizationId: string): Promise<boolean> {
    const settings = await this.findByOrganizationId(organizationId);
    return settings?.isEnabled ?? true; // Default to enabled if no settings
  }
}

export const webchatSettingsRepository = new WebchatSettingsRepository();
