import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFeatureDto {
  @IsString()
  @MaxLength(100)
  featureKey: string;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  name?: string;

  @IsString()
  layerId: string;

  @IsObject()
  geometry: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  properties?: Record<string, unknown>;
}
