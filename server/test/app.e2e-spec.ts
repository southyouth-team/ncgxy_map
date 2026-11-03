import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { LayersModule } from '../src/modules/layers/layers.module';
import { LayersService } from '../src/modules/layers/layers.service';
import { FeaturesModule } from '../src/modules/features/features.module';
import { FeaturesService } from '../src/modules/features/features.service';
import { MapsModule } from '../src/modules/maps/maps.module';
import { MapsService } from '../src/modules/maps/maps.service';

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
    const persisted = await db.query('SELECT id,layer_id,revision FROM campus_feature WHERE id=$1',[featureId]);
    expect(persisted).toHaveLength(1);
    expect(String(persisted[0].layer_id)).toBe(layerId);
    expect(Number(persisted[0].revision)).toBe(1);
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
    // 先直接验证 Service 的业务分支，区分 Service 逻辑与 HTTP 路由/异常映射问题。
    const layersService = app.select(LayersModule).get(LayersService);
    await expect(layersService.remove(ownerId, campusId, mapId, layerId))
      .rejects.toMatchObject({ status: 409 });

    const response = await request(app.getHttpServer())
      .delete(`${base}/campuses/${campusId}/maps/${mapId}/layers/${layerId}`)
      .set(auth);
    const layerRows = await db.query('SELECT id FROM campus_layer WHERE id=$1', [layerId]);
    const featureRows = await db.query('SELECT id,layer_id FROM campus_feature WHERE id=$1', [featureId]);
    expect({
      status: response.status,
      body: response.body,
      remainingLayers: layerRows.length,
      remainingFeatures: featureRows,
    }).toEqual({
      status: 409,
      body: expect.any(Object),
      remainingLayers: 1,
      remainingFeatures: [expect.objectContaining({ id: featureId, layer_id: layerId })],
    });
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
    // 先直接验证 Service 对过期 revision 的处理，再验证 HTTP 层响应。
    const featuresService = app.select(FeaturesModule).get(FeaturesService);
    await expect(featuresService.update(ownerId, campusId, mapId, featureId, {
      revision: 0,
      name: '直接调用过期更新',
    })).rejects.toMatchObject({ status: 409 });

    await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/features/${featureId}`)
      .set(auth)
      .send({ revision: 1, name: '第一次更新' })
      .expect(200);
    const updated = await db.query('SELECT revision FROM campus_feature WHERE id=$1',[featureId]);
    expect(Number(updated[0].revision)).toBe(2);
    const staleResponse = await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/features/${featureId}`)
      .set(auth)
      .send({ revision: 1, name: '过期更新' });
    const afterStale = await db.query('SELECT revision,name FROM campus_feature WHERE id=$1', [featureId]);
    expect({
      status: staleResponse.status,
      body: staleResponse.body,
      persisted: afterStale,
    }).toEqual({
      status: 409,
      body: expect.any(Object),
      persisted: [expect.objectContaining({ revision: '2', name: '第一次更新' })],
    });
  });


  it('persists map coordinate configuration with optimistic revision checks', async () => {
    const current = await request(app.getHttpServer())
      .get(`${base}/campuses/${campusId}/maps`).set(auth).expect(200);
    const map = current.body.find((item: any) => String(item.id) === mapId);
    expect(map).toBeTruthy();
    const config = { baseMapTransform: { x: 12, y: -8, scale: 1.25, rotation: 3, opacity: 0.7 } };
    const saved = await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/config`)
      .set(auth).send({ revision: Number(map.revision), coordinateConfig: config }).expect(200);
    const persistedConfig = await db.query('SELECT coordinate_config,revision FROM campus_map WHERE id=$1 AND campus_id=$2',[mapId,campusId]);
    expect(persistedConfig[0].coordinate_config).toEqual(config);
    expect(Number(persistedConfig[0].revision)).toBe(Number(map.revision) + 1);

    const mapsService = app.select(MapsModule).get(MapsService);
    await expect(mapsService.updateConfig(ownerId, campusId, mapId, {
      revision: Number(map.revision),
      coordinateConfig: {},
    })).rejects.toMatchObject({ status: 409 });

    const staleResponse = await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/config`)
      .set(auth).send({ revision: Number(map.revision), coordinateConfig: {} });
    const afterStaleConfig = await db.query('SELECT coordinate_config,revision FROM campus_map WHERE id=$1 AND campus_id=$2',[mapId,campusId]);
    expect({
      status: staleResponse.status,
      revision: Number(afterStaleConfig[0].revision),
      coordinateConfig: afterStaleConfig[0].coordinate_config,
    }).toEqual({
      status: 409,
      revision: Number(persistedConfig[0].revision),
      coordinateConfig: config,
    });

    const viewerId = `e2e-config-viewer-${Date.now()}`;
    await db.query("INSERT INTO campus_member (campus_id,user_id,role) VALUES ($1,$2,'viewer')", [campusId, viewerId]);
    await request(app.getHttpServer())
      .put(`${base}/campuses/${campusId}/maps/${mapId}/config`)
      .set('X-Dev-User-Id', viewerId)
      .send({ revision: Number(persistedConfig[0].revision), coordinateConfig: {} }).expect(403);
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

  it('loads an empty scene and persists a scene document with revision checks', async () => {
    const sceneUrl = `${base}/campuses/${campusId}/maps/${mapId}/scene`;

    const empty = await request(app.getHttpServer())
      .get(sceneUrl)
      .set(auth)
      .expect(200);
    expect(Number(empty.body.revision)).toBe(0);
    expect(empty.body.document).toBeNull();

    const document = {
      schemaVersion: 2,
      id: 'campus-scene',
      name: '测试三维场景',
      campusId,
      mapId,
      coordinateSystem: 'campus-local',
      coordinateMapping: { groundPlane: 'XZ', verticalAxis: 'Y', unit: 'scene-unit' },
      revision: 0,
      objects: [{
        id: 'scene-building-1',
        type: 'building',
        name: '测试建筑',
        featureId,
        layerId: 'default',
        elevation: 0,
        modelTransform: { rotation: [0, 0, 0], scale: [1, 1, 1] },
        properties: { floors: 3, floorHeight: 3.3 },
      }],
      layers: [{ id: 'default', name: '默认图层', visible: true, locked: false }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await request(app.getHttpServer())
      .put(sceneUrl)
      .set(auth)
      .send({ revision: 0, document })
      .expect(200);
    expect(Number(saved.body.revision)).toBe(1);
    expect(saved.body.document.mapId).toBe(mapId);

    const loaded = await request(app.getHttpServer())
      .get(sceneUrl)
      .set(auth)
      .expect(200);
    expect(Number(loaded.body.revision)).toBe(1);
    expect(loaded.body.document.objects[0].featureId).toBe(featureId);

    await request(app.getHttpServer())
      .put(sceneUrl)
      .set(auth)
      .send({ revision: 0, document })
      .expect(409);
  });

  it('persists indoor building layouts with revision history and access control', async () => {
    const buildingId = 'west-north-01';
    const url = `${base}/campuses/${campusId}/maps/${mapId}/scene/indoor-buildings/${buildingId}`;
    const empty = await request(app.getHttpServer()).get(url).set(auth).expect(200);
    expect(Number(empty.body.revision)).toBe(0);
    expect(empty.body.definition).toBeNull();

    const definition = {
      id: buildingId,
      name: '西北组团 01',
      floorHeight: 3.6,
      footprintSize: { width: 12, depth: 8 },
      layoutStatus: 'procedural-template',
      floors: [{
        level: 1, width: 12, depth: 12, rooms: [], walls: [], doors: [],
        stairPoint: { x: 4, z: 0, direction: 'south' },
      }],
    };
    const saved = await request(app.getHttpServer())
      .put(url).set(auth).send({ revision: 0, definition }).expect(200);
    expect(Number(saved.body.revision)).toBe(1);
    expect(saved.body.definition.id).toBe(buildingId);

    const loaded = await request(app.getHttpServer()).get(url).set(auth).expect(200);
    expect(Number(loaded.body.revision)).toBe(1);
    expect(loaded.body.definition.floors[0].stairPoint.x).toBe(4);

    const versions = await request(app.getHttpServer())
      .get(url + '/versions').set(auth).expect(200);
    expect(versions.body).toHaveLength(1);
    expect(Number(versions.body[0].revision)).toBe(1);

    await request(app.getHttpServer())
      .put(url).set(auth).send({ revision: 0, definition }).expect(409);

    const viewerId = `e2e-indoor-viewer-${Date.now()}`;
    await db.query("INSERT INTO campus_member (campus_id,user_id,role) VALUES ($1,$2,'viewer')", [campusId, viewerId]);
    await request(app.getHttpServer()).get(url).set('X-Dev-User-Id', viewerId).expect(200);
    await request(app.getHttpServer())
      .put(url).set('X-Dev-User-Id', viewerId)
      .send({ revision: 1, definition }).expect(403);
  });

});
