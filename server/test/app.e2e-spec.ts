import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Campus map API (PostGIS integration)', () => {
  let app: INestApplication;
  let db: DataSource;
  let campusId: string;
  let mapId: string;
  let layerId: string;
  let featureId: string;
  const ownerId = `e2e-owner-${Date.now()}`;
  const base = '/api/v1';
  const auth = { 'X-Dev-User-Id': ownerId };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
    db = app.get(DataSource);

    const campus = await request(app.getHttpServer())
      .post(`${base}/campuses`).set(auth)
      .send({ slug: `e2e-${Date.now()}`, name: 'API 集成测试学校' })
      .expect(201);
    campusId = String(campus.body.id);

    const map = await request(app.getHttpServer())
      .post(`${base}/campuses/${campusId}/maps`).set(auth)
      .send({ slug: 'main', name: '主校区测试地图' })
      .expect(201);
    mapId = String(map.body.id);

    const layer = await request(app.getHttpServer())
      .post(`${base}/campuses/${campusId}/maps/${mapId}/layers`).set(auth)
      .send({ key: 'buildings', name: '建筑', featureType: 'building' })
      .expect(201);
    layerId = String(layer.body.id);

    const feature = await request(app.getHttpServer())
      .post(`${base}/campuses/${campusId}/maps/${mapId}/features`).set(auth)
      .send({
        featureKey: 'e2e-building-1',
        layerId,
        name: '测试建筑',
        geometry: { type: 'Point', coordinates: [100, 120] },
        properties: { source: 'e2e' },
      })
      .expect(201);
    featureId = String(feature.body.id);
  });

  afterAll(async () => {
    if (db?.isInitialized && campusId) {
      await db.query('DELETE FROM campus WHERE id=$1', [campusId]);
    }
    await app?.close();
  });

  it('rejects a map ID outside the requested campus', async () => {
    await request(app.getHttpServer())
      .get(`${base}/campuses/${campusId}/maps/999999999/features`)
      .set(auth)
      .expect(404);
  });

  it('does not delete a layer that still contains features', async () => {
    await request(app.getHttpServer())
      .delete(`${base}/campuses/${campusId}/maps/${mapId}/layers/${layerId}`)
      .set(auth)
      .expect(409);
    const rows = await db.query('SELECT id FROM campus_feature WHERE id=$1', [featureId]);
    expect(rows).toHaveLength(1);
  });

  it('enforces viewer read-only permissions', async () => {
    const viewerId = `e2e-viewer-${Date.now()}`;
    await db.query(
      "INSERT INTO campus_member (campus_id,user_id,role) VALUES ($1,$2,'viewer')",
      [campusId, viewerId],
    );
    await request(app.getHttpServer())
      .post(`${base}/campuses/${campusId}/maps/${mapId}/layers`)
      .set('X-Dev-User-Id', viewerId)
      .send({ key: 'blocked', name: '不允许创建', featureType: 'building' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/campuses/${campusId}/maps/${mapId}/features`)
      .set('X-Dev-User-Id', viewerId)
      .expect(200);
  });

  it('uses optimistic revision checks for feature updates', async () => {
    await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/features/${featureId}`)
      .set(auth)
      .send({ revision: 1, name: '第一次更新' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/features/${featureId}`)
      .set(auth)
      .send({ revision: 1, name: '过期更新' })
      .expect(409);
  });

  it('rejects invalid GeoJSON geometry', async () => {
    await request(app.getHttpServer())
      .post(`${base}/campuses/${campusId}/maps/${mapId}/features`)
      .set(auth)
      .send({
        featureKey: 'e2e-invalid',
        layerId,
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]] },
      })
      .expect(400);
  });
});
