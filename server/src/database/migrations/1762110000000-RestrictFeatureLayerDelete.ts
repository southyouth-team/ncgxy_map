import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 图层存在空间要素时禁止删除。
 * 通过数据库外键保证并发场景下也不会因级联删除而丢失要素。
 */
export class RestrictFeatureLayerDelete1762110000000 implements MigrationInterface {
  name = 'RestrictFeatureLayerDelete1762110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE campus_feature DROP CONSTRAINT fk_feature_layer_scope',
    );
    await queryRunner.query(`
      ALTER TABLE campus_feature
      ADD CONSTRAINT fk_feature_layer_scope
      FOREIGN KEY (layer_id, campus_id, map_id)
      REFERENCES campus_layer(id, campus_id, map_id)
      ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE campus_feature DROP CONSTRAINT fk_feature_layer_scope',
    );
    await queryRunner.query(`
      ALTER TABLE campus_feature
      ADD CONSTRAINT fk_feature_layer_scope
      FOREIGN KEY (layer_id, campus_id, map_id)
      REFERENCES campus_layer(id, campus_id, map_id)
      ON DELETE CASCADE
    `);
  }
}
