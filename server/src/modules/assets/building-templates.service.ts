import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BuildingTemplatesService {
  constructor(private readonly config: ConfigService) {}
  list() {
    return { schemaVersion: 1, templates: [] };
  }
}
