import { MigrationInterface, QueryRunner } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class InitialPostgisSchema1730500000000 implements MigrationInterface {
  name = 'InitialPostgisSchema1730500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS postgis');
    // __dirname 在 ts-node 和编译后的 dist 目录中均指向 migrations；
    // schema.sql 作为数据库模块资产随源码/构建产物部署。
    const schemaPath = resolve(__dirname, '../schema.sql');
    const sql = await readFile(schemaPath, 'utf8');
    await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE IF EXISTS campus_map DROP CONSTRAINT IF EXISTS fk_map_published_version');
    await queryRunner.query('DROP TABLE IF EXISTS campus_version CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS campus_asset CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS campus_feature CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS campus_layer CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS campus_map CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS campus_member CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS campus CASCADE');
  }
}
