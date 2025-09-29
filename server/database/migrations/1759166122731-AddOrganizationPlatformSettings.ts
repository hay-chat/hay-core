import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationPlatformSettings1759166122731 implements MigrationInterface {
    name = 'AddOrganizationPlatformSettings1759166122731'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."organizations_date_format_enum" AS ENUM('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY')`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "date_format" "public"."organizations_date_format_enum" NOT NULL DEFAULT 'MM/DD/YYYY'`);
        await queryRunner.query(`CREATE TYPE "public"."organizations_time_format_enum" AS ENUM('12h', '24h')`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "time_format" "public"."organizations_time_format_enum" NOT NULL DEFAULT '12h'`);
        await queryRunner.query(`CREATE TYPE "public"."organizations_timezone_enum" AS ENUM('UTC', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Rome', 'Europe/Zurich', 'Europe/Stockholm', 'Europe/Athens', 'Europe/Dublin', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Bucharest', 'Europe/Helsinki', 'Europe/Moscow', 'Atlantic/Azores', 'Atlantic/Madeira', 'Atlantic/Canary', 'Atlantic/Cape_Verde', 'Africa/Casablanca', 'Africa/Algiers', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Accra', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Jerusalem', 'Asia/Beirut', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Tehran', 'Asia/Baghdad', 'Asia/Qatar', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Yangon', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Ho_Chi_Minh', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu', 'America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'America/Vancouver', 'America/Mexico_City', 'America/Puerto_Rico', 'America/Bogota', 'America/Lima', 'America/Quito', 'America/Caracas', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'America/Montevideo')`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "timezone" "public"."organizations_timezone_enum" NOT NULL DEFAULT 'UTC'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "timezone"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_timezone_enum"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "time_format"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_time_format_enum"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "date_format"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_date_format_enum"`);
    }

}
