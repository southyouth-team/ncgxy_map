import { IsInt, IsObject, Min } from 'class-validator';

export class SaveIndoorBuildingDto {
  @IsInt()
  @Min(0)
  revision: number;

  @IsObject()
  definition: Record<string, unknown>;
}
