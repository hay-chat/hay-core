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
   * Write only the given columns (no read-modify-write of the whole row), for
   * background writers such as install detection and the branding import.
   */
  async patch(
    organizationId: string,
    data: Partial<
      Pick<
        WebchatSettings,
        | "lastSeenAt"
        | "lastSeenOrigin"
        | "brandingImportedAt"
        | "brandPalette"
        | "logoUploadId"
        | "logoSource"
      >
    >,
  ): Promise<void> {
    await this.repository.update({ organizationId }, data);
  }

  /**
   * Imported website colours: the palette always, the brand colour only while
   * the merchant has not picked one.
   */
  async applyImportedColors(organizationId: string, palette: string[]): Promise<void> {
    await this.repository.query(
      `UPDATE webchat_settings SET brand_palette = $2 WHERE organization_id = $1`,
      [organizationId, palette],
    );
    if (palette.length === 0) return;
    await this.repository.query(
      `UPDATE webchat_settings
          SET brand_color = $2, brand_color_source = 'website'
        WHERE organization_id = $1
          AND brand_color_source IS DISTINCT FROM 'custom'`,
      [organizationId, palette[0]],
    );
  }

  /**
   * Point the widget logo at an imported upload unless the merchant set their
   * own logo meanwhile. Returns whether it was applied and the upload it replaced.
   */
  async applyImportedLogo(
    organizationId: string,
    uploadId: string,
  ): Promise<{ applied: boolean; previousUploadId: string | null }> {
    // TypeORM's postgres driver returns [rows, affectedCount] for UPDATE ... RETURNING.
    const [rows]: [Array<{ previous_upload_id: string | null }>, number] =
      await this.repository.query(
        `UPDATE webchat_settings w
            SET logo_upload_id = $2, logo_source = 'website'
           FROM (SELECT id, logo_upload_id FROM webchat_settings
                  WHERE organization_id = $1 FOR UPDATE) previous
          WHERE w.id = previous.id
            AND w.logo_source IS DISTINCT FROM 'custom'
        RETURNING previous.logo_upload_id AS previous_upload_id`,
        [organizationId, uploadId],
      );
    if (!rows.length) return { applied: false, previousUploadId: null };
    return { applied: true, previousUploadId: rows[0].previous_upload_id };
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
