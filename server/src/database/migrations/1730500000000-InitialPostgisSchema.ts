import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialPostgisSchema1730500000000 implements MigrationInterface {
  name = 'InitialPostgisSchema1730500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const schemaPath = path.resolve(process.cwd(), '../docs/multi-campus-database-v1.sql');
    const sql = await fs.readFile(schemaPath, 'utf8');
    await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS campus_version CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS campus_asset CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS campus_feature CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS campus_layer CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS campus_map CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS campus_member CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS campus CASCADE`);
  }
}
