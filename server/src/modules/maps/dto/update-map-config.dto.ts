import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

export class UpdateMapConfigDto {
  @IsInt() @Min(1) revision: number;
  @IsOptional() @IsObject() coordinateConfig?: Record<string, unknown>;
}