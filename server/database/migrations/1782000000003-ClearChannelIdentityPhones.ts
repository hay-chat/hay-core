import { MigrationInterface, QueryRunner } from "typeorm";

export class ClearChannelIdentityPhones1782000000003 implements MigrationInterface {
  name = "ClearChannelIdentityPhones1782000000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The inbound `messages.receive` handler used to copy the channel-scoped
    // identity (`from`, e.g. "instagram:<psid>") into customers.phone as a
    // fallback. That polluted the phone column with non-phone data. Null out
    // those rows: any phone equal to the external_id, or carrying a channel
    // prefix like "instagram:" / "whatsapp:". Real phone numbers (digits, "+")
    // do not match either condition and are left untouched.
    await queryRunner.query(`
      UPDATE customers
      SET phone = NULL
      WHERE phone IS NOT NULL
        AND (phone = external_id OR phone ~ '^[a-z][a-z0-9_-]*:');
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible by design: the cleared values were never valid phone numbers,
    // and the original identity is still available in customers.external_id.
    console.warn(
      "Warning: ClearChannelIdentityPhones cannot be reversed; cleared phones were channel identities, still present in external_id.",
    );
  }
}
