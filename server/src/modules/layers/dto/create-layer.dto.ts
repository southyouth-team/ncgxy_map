import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const FEATURE_TYPES = ['building', 'road', 'water', 'green', 'sports', 'boundary', 'poi', 'custom'];

export class CreateLayerDto {
  @IsString()
  @MaxLength(80)
  key: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsIn(FEATURE_TYPES)
  featureType: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}
