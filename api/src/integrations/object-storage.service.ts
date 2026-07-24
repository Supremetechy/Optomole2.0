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
  /** How `body` is encoded. Binary artifacts (e.g. engine-build zips) are base64. */
  encoding?: 'utf8' | 'base64';
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

  /**
   * Store a binary object (kept as base64 in the same JSON-file backend the text
   * objects use). This is the no-MinIO fallback that lets the worker push a
   * finished engine-build zip to the gateway so it's downloadable via
   * /v1/objects. In s3/minio mode this returns the CDN URL without storing, same
   * as putObject.
   */
  async putBinaryObject(input: { body: Buffer; contentType: string; key: string; publicBaseUrl?: string }): Promise<{ key: string; url: string }> {
    const config = gatewayConfig();
    const publicBaseUrl = (input.publicBaseUrl || config.publicGatewayUrl).replace(/\/$/, '');
    if (config.objectStorageMode !== 'memory') {
      return { key: input.key, url: `${config.cdnBaseUrl.replace(/\/$/, '')}/objects/${encodeURIComponent(input.key)}` };
    }
    const storedObject: StoredObject = {
      key: input.key,
      body: input.body.toString('base64'),
      contentType: input.contentType,
      encoding: 'base64',
      createdAt: new Date().toISOString(),
    };
    this.objects.set(input.key, storedObject);
    this.writeLocalObject(config.localObjectStorePath, storedObject);
    return { key: input.key, url: `${publicBaseUrl}/v1/objects/${encodeURIComponent(input.key)}` };
  }

  getObject(key: string): StoredObject | null {
    return this.objects.get(key) || this.readLocalObject(gatewayConfig().localObjectStorePath, key);
  }

  /**
   * Delete a stored object from memory and (in local mode) from disk. Returns
   * true if anything was removed. Used when deleting a build so its manifest
   * isn't re-discovered by BuildsService.recoverPersistedBuilds on the next list.
   */
  deleteObject(key: string): boolean {
    if (!key) return false;
    const hadMemory = this.objects.delete(key);
    let hadFile = false;
    if (gatewayConfig().objectStorageMode === 'memory') {
      const filePath = this.localObjectPath(gatewayConfig().localObjectStorePath, key);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
        hadFile = true;
      }
    }
    return hadMemory || hadFile;
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

  /**
   * Enumerate stored objects without reading their bodies. Keys are recovered by
   * decoding the base64url filename and timestamps come from the file itself, so
   * listing stays cheap even when individual manifests are tens of megabytes.
   */
  listObjectKeys(): Array<{ key: string; createdAt: string }> {
    const root = path.resolve(process.cwd(), gatewayConfig().localObjectStorePath);
    if (!fs.existsSync(root)) return [];
    const entries: Array<{ key: string; createdAt: string }> = [];
    for (const fileName of fs.readdirSync(root)) {
      let key: string;
      try {
        key = Buffer.from(fileName, 'base64url').toString('utf8');
      } catch (_) {
        continue; // Not one of ours.
      }
      if (!key) continue;
      try {
        entries.push({ key, createdAt: fs.statSync(path.join(root, fileName)).mtime.toISOString() });
      } catch (_) {
        // File vanished between readdir and stat — skip it.
      }
    }
    return entries;
  }

  private localObjectPath(root: string, key: string): string {
    const safeKey = Buffer.from(key).toString('base64url');
    return path.resolve(process.cwd(), root, safeKey);
  }
}
