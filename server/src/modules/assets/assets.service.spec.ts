import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetsService } from './assets.service';
import { createObjectModelParameterContractCases } from '../../shared/object-model-parameter-contract.fixtures';

describe('AssetsService ObjectModelSpec parameter contract', () => {
  let storageDir: string;
  let service: AssetsService;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'ncgxy-object-model-contract-'));
    service = new AssetsService({} as never, {
      get: (key: string) => key === 'ASSET_STORAGE_DIR' ? storageDir : undefined,
    } as never);
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  it('applies the same parameter contract cases to asset save and read', async () => {
    for (const contract of createObjectModelParameterContractCases()) {
      if (contract.validator !== 'accept') {
        await expect(service.saveObjectSculptAsset('contract-user', {
          name: contract.id,
          objectSculptSpec: structuredClone(contract.spec),
        })).rejects.toBeInstanceOf(BadRequestException);
        continue;
      }

      const saved = await service.saveObjectSculptAsset('contract-user', {
        name: contract.id,
        objectSculptSpec: structuredClone(contract.spec),
      });
      const loaded = await service.getObjectSculptAsset('contract-user', saved.assetId);
      expect(loaded.spec).toEqual(saved.spec);
    }
  });
});
