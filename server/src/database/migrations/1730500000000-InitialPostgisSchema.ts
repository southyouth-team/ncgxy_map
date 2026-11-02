import { MigrationInterface, QueryRunner } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class InitialPostgisSchema1730500000000 implements MigrationInterface {
  name = 'InitialPostgisSchema1730500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS postgis');
    // 开发环境从 src 执行，生产环境可能从 dist 执行；Docker runtime 将 schema.sql 保留在 src/database。
    const candidates = [
      resolve(__dirname, '../schema.sql'),
      resolve(process.cwd(), 'src/database/schema.sql'),
    ];
    let sql: string | undefined;
    for (const schemaPath of candidates) {
      try {
        sql = await readFile(schemaPath, 'utf8');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (!sql) throw new Error('找不到数据库初始化文件 schema.sql，请检查部署产物是否包含 server/src/database/schema.sql');
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
