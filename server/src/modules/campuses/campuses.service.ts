import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateCampusDto } from './dto/create-campus.dto';

@Injectable()
export class CampusesService {
  constructor(private readonly dataSource: DataSource) {}
  async create(userId: string, dto: CreateCampusDto) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      const rows = await runner.query(
        `INSERT INTO campus (slug,name,description,address,created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id,slug,name,description,address,status,created_at,updated_at`,
        [dto.slug,dto.name,dto.description ?? null,dto.address ?? null,userId],
      );
      await runner.query("INSERT INTO campus_member (campus_id,user_id,role) VALUES ($1,$2,'owner')",[rows[0].id,userId]);
      await runner.commitTransaction(); return rows[0];
    } catch (error) {
      await runner.rollbackTransaction();
      if (this.isUniqueViolation(error)) throw new ConflictException('学校标识 slug 已存在');
      throw error;
    } finally { await runner.release(); }
  }
  findAll(userId: string) {
    return this.dataSource.query(
      `SELECT c.id,c.slug,c.name,c.description,c.address,c.status,c.created_at,c.updated_at,m.role
       FROM campus c JOIN campus_member m ON m.campus_id=c.id
       WHERE m.user_id=$1 ORDER BY c.id`,[userId],
    );
  }
  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}