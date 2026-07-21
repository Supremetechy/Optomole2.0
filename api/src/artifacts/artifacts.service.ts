import { Injectable } from '@nestjs/common';
import { BuildsService } from '../builds/builds.service';
import { ObjectStorageService } from '../integrations/object-storage.service';

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly builds: BuildsService,
    private readonly storage: ObjectStorageService,
  ) {}

  list() {
    return { ok: true, artifacts: this.builds.listArtifacts() };
  }

  get(id: string) {
    return this.builds.getArtifact(id);
  }

  getObject(key: string) {
    return this.storage.getObject(key);
  }
}
