import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import { id } from '../shared/ids';

export interface StoredObject {
  key: string;
  body: string;
  contentType: string;
  createdAt: string;
}

@Injectable()
export class ObjectStorageService {
  private readonly objects = new Map<string, StoredObject>();

  async putObject(input: { body: string; contentType: string; key?: string; publicBaseUrl?: string }): Promise<{ key: string; url: string }> {
    const config = gatewayConfig();
    const key = input.key || `${id('object')}.html`;
    const publicBaseUrl = (input.publicBaseUrl || config.publicGatewayUrl).replace(/\/$/, '');

    if (config.objectStorageMode !== 'memory') {
      // Production adapters should write to S3/MinIO here and return CDN URLs.
      // This gateway keeps the contract stable while storage implementation is swapped.
      return { key, url: `${config.cdnBaseUrl.replace(/\/$/, '')}/objects/${encodeURIComponent(key)}` };
    }

    const storedObject = {
      key,
      body: input.body,
      contentType: input.contentType,
      createdAt: new Date().toISOString(),
    };
    this.objects.set(key, storedObject);
    this.writeLocalObject(config.localObjectStorePath, storedObject);
    return { key, url: `${publicBaseUrl}/v1/objects/${encodeURIComponent(key)}` };
  }

  getObject(key: string): StoredObject | null {
    return this.objects.get(key) || this.readLocalObject(gatewayConfig().localObjectStorePath, key);
  }

  private writeLocalObject(root: string, object: StoredObject) {
    const filePath = this.localObjectPath(root, object.key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(object), 'utf8');
  }

  private readLocalObject(root: string, key: string): StoredObject | null {
    const filePath = this.localObjectPath(root, key);
    if (!fs.existsSync(filePath)) return null;
    const object = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredObject;
    this.objects.set(key, object);
    return object;
  }

  private localObjectPath(root: string, key: string): string {
    const safeKey = Buffer.from(key).toString('base64url');
    return path.resolve(process.cwd(), root, safeKey);
  }
}
