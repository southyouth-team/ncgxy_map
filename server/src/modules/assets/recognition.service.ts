import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

@Injectable()
export class RecognitionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecognitionService.name);
  private readonly storageDir: string;
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly db: DataSource, private readonly config: ConfigService) {
    this.storageDir = resolve(config.get<string>('ASSET_STORAGE_DIR', './uploads'));
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.processNext(), 1200);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async recognize(userId: string, campusId: string, mapId: string, assetId: string) {
    await this.requireRole(userId, campusId, ['owner', 'admin', 'editor']);
    const assets = await this.db.query(`SELECT id FROM campus_asset WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND asset_type='base-map'`, [assetId,campusId,mapId]);
    if (!assets.length) throw new NotFoundException('底图资源不存在或不属于当前地图');
    if (!this.config.get<string>('VISION_API_KEY') || !this.config.get<string>('VISION_MODEL')) {
      throw new ServiceUnavailableException('尚未配置视觉模型：请设置 VISION_API_KEY、VISION_MODEL；兼容接口可设置 VISION_API_BASE_URL。');
    }
    const existing = await this.db.query(`SELECT id,status,created_at FROM campus_recognition_result WHERE asset_id=$1 AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1`, [assetId]);
    if (existing.length) return { id: String(existing[0].id), status: existing[0].status, createdAt: existing[0].created_at };
    const rows = await this.db.query(`INSERT INTO campus_recognition_result (campus_id,map_id,asset_id,result,created_by,status) VALUES ($1,$2,$3,'{}'::jsonb,$4,'queued') RETURNING id,status,created_at`, [campusId,mapId,assetId,userId]);
    void this.processNext();
    return { id: String(rows[0].id), status: rows[0].status, createdAt: rows[0].created_at };
  }

  async getJob(userId: string, campusId: string, mapId: string, jobId: string) {
    await this.requireRole(userId, campusId, ['owner','admin','editor','viewer']);
    const rows = await this.db.query(`SELECT id,status,result,error_message,created_at,started_at,completed_at FROM campus_recognition_result WHERE id=$1 AND campus_id=$2 AND map_id=$3`, [jobId,campusId,mapId]);
    if (!rows.length) throw new NotFoundException('识图任务不存在');
    return { ...rows[0], id: String(rows[0].id), ...(rows[0].status === 'completed' ? (rows[0].result || {}) : {}) };
  }

  private async processNext() {
    if (this.busy) return;
    this.busy = true;
    try {
      // 使用 CTE 锁定一条待处理任务，再通过 UPDATE ... FROM 原子领取，避免并发 worker 重复领取。
      const claimed = await this.db.query(`
        WITH picked AS (
          SELECT id
          FROM campus_recognition_result
          WHERE status = 'queued'
             OR (status = 'processing' AND started_at < now() - interval '10 minutes')
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE campus_recognition_result AS job
        SET status = 'processing', started_at = now()
        FROM picked
        WHERE job.id = picked.id
        RETURNING job.id, job.campus_id, job.map_id, job.asset_id
      `);
      if (Array.isArray(claimed) && claimed.length > 0) {
        // TypeORM PostgreSQL driver 正常返回对象数组；兼容部分驱动包装的 rows 结构。
        const resultRows = Array.isArray(claimed[0]) ? claimed[0] : claimed;
        const row = resultRows[0];
        if (!row || typeof row !== 'object') {
          this.logger.error('识图任务领取结果结构异常：' + JSON.stringify(claimed).slice(0, 1200));
          return;
        }
        const job = {
          id: String(row.id ?? row.ID ?? ''),
          campus_id: String(row.campus_id ?? row.CAMPUS_ID ?? ''),
          map_id: String(row.map_id ?? row.MAP_ID ?? ''),
          asset_id: String(row.asset_id ?? row.ASSET_ID ?? ''),
        };
        if (!job.id || !job.asset_id) {
          this.logger.error('识图任务已被领取，但返回字段不完整：' + JSON.stringify(row).slice(0, 1200));
          // 将异常任务释放回队列，避免一直卡在 processing。
          if (job.id) await this.db.query(`UPDATE campus_recognition_result SET status='queued', started_at=NULL WHERE id=$1`, [job.id]);
          return;
        }
        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error('识图队列执行失败', error instanceof Error ? error.stack : String(error));
    } finally { this.busy = false; }
  }

  private async processJob(job: {id:string;campus_id:string;map_id:string;asset_id:string}) {
    try {
      const assets = await this.db.query(`SELECT id,object_key,mime_type,storage_provider FROM campus_asset WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND asset_type='base-map'`, [job.asset_id,job.campus_id,job.map_id]);
      if (!assets.length) throw new Error('底图资源记录不存在：assetId=' + job.asset_id + ', campusId=' + job.campus_id + ', mapId=' + job.map_id);
      if (assets[0].storage_provider !== 'local-filesystem') throw new Error('底图存储方式暂不支持：' + String(assets[0].storage_provider));
      if (!assets[0].object_key) throw new Error('底图资源缺少 object_key');
      const absolutePath = resolve(this.storageDir, assets[0].object_key);
      const rel = relative(this.storageDir, absolutePath);
      if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('底图资源路径无效');
      let image: Buffer;
      try { image = await readFile(absolutePath); } catch { throw new Error('底图文件在服务器存储目录中不存在：' + absolutePath); }
      const mime = assets[0].mime_type;
      const model = this.config.get<string>('VISION_MODEL')!;
      // 本服务调用 OpenAI 兼容的 /chat/completions；DeepSeek 应配置 https://api.deepseek.com，不要填写 Anthropic 路径。
      const baseUrl = (this.config.get<string>('VISION_API_BASE_URL','https://api.openai.com/v1') || '').replace(/\/+$/,'');
      const response = await fetch(baseUrl + '/chat/completions', {
        method:'POST', headers:{Authorization:'Bearer '+this.config.get<string>('VISION_API_KEY'), 'Content-Type':'application/json'},
        signal:AbortSignal.timeout(180000),
        body:JSON.stringify({model,temperature:0.1,response_format:{type:'json_object'},messages:[
          {role:'system',content:'你是 GIS 制图识别助手。只返回 JSON：{"imageSummary":"...","features":[{"type":"building|road|green|water|sports|plaza|parking|facility","name":"...","confidence":0.0,"geometry":{"type":"Polygon|LineString","coordinates":[]},"properties":{}}]}。坐标为图片原始像素，原点左上。Polygon coordinates 为 [外环] 且首尾闭合；LineString 至少两个点。识别建筑、道路、绿地、水体、运动场、广场、停车场和设施；忽略文字、图例、指北针和图框；不确定时降低置信度，不要臆造。规划图优先提取建筑边界与道路边界。'},
          {role:'user',content:[{type:'text',text:'提取这张校园地图中的全部可见空间要素。'},{type:'image_url',image_url:{url:'data:'+mime+';base64,'+image.toString('base64'),detail:'high'}}]},
        ]}),
      });
      if (!response.ok) throw new Error('视觉模型 HTTP '+response.status+'：'+(await response.text()).slice(0,1000));
      const payload = await response.json() as any;
      const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || '{}');
      if (!Array.isArray(parsed.features) || parsed.features.length > 20000) throw new Error('识别结果格式无效');
      const allowed = ['building','road','green','water','sports','plaza','parking','facility'];
      const features = parsed.features.map((item:any,index:number) => {
        if (!allowed.includes(item?.type) || !['Polygon','LineString'].includes(item?.geometry?.type)) throw new Error('第 '+(index+1)+' 个要素类型或几何无效');
        const coords = item.geometry.type === 'Polygon' ? item.geometry.coordinates?.[0] : item.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < (item.geometry.type === 'Polygon' ? 4 : 2) || coords.some((p:any)=>!Array.isArray(p)||p.length!==2||p.some((v:any)=>!Number.isFinite(Number(v))))) throw new Error('第 '+(index+1)+' 个要素坐标无效');
        const confidence=Number(item.confidence);
        if (!Number.isFinite(confidence)||confidence<0||confidence>1) throw new Error('第 '+(index+1)+' 个要素置信度无效');
        return {type:item.type,name:String(item.name||item.type).slice(0,120),confidence,geometry:item.geometry,properties:item.properties||{},source:'ai-vision',reviewRequired:confidence<0.75};
      });
      const result={provider:baseUrl,model,imageSummary:String(parsed.imageSummary||''),featureCount:features.length,features};
      await this.db.query(`UPDATE campus_recognition_result SET status='completed',result=$1::jsonb,completed_at=now() WHERE id=$2`,[JSON.stringify(result),job.id]);
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      await this.db.query(`UPDATE campus_recognition_result SET status='failed',error_message=$1,completed_at=now() WHERE id=$2`,[message.slice(0,4000),job.id]);
      this.logger.error('识图任务 '+job.id+' 失败：'+message);
    }
  }

  private async requireRole(userId:string,campusId:string,allowed:string[]) {
    const rows=await this.db.query('SELECT role FROM campus_member WHERE campus_id=$1 AND user_id=$2',[campusId,userId]);
    if(!rows.length) throw new NotFoundException('学校不存在或无权访问');
    if(!allowed.includes(rows[0].role)) throw new ForbiddenException('当前角色无权执行此操作');
  }
}