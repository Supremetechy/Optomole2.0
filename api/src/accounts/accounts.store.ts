import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import { Account } from './account.types';

/**
 * AccountStore — persistence for user accounts, mirroring the local-JSON pattern
 * ObjectStorageService uses (in-memory Map + one JSON file per record under a
 * configured directory) but with list-all support the admin console needs. Swap
 * the file backend for a real DB later without touching AccountsService.
 */
@Injectable()
export class AccountStore {
  private readonly accounts = new Map<string, Account>();
  private hydrated = false;

  list(): Account[] {
    this.hydrate();
    return [...this.accounts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Account | null {
    this.hydrate();
    return this.accounts.get(id) || null;
  }

  findByEmail(email: string): Account | null {
    this.hydrate();
    const target = String(email || '').toLowerCase();
    return this.list().find((account) => account.email.toLowerCase() === target) || null;
  }

  save(account: Account): Account {
    this.hydrate();
    this.accounts.set(account.id, account);
    this.writeFile(account);
    return account;
  }

  delete(id: string): boolean {
    this.hydrate();
    const existed = this.accounts.delete(id);
    if (existed) this.removeFile(id);
    return existed;
  }

  // --- local file backend ------------------------------------------------

  private root(): string {
    return path.resolve(process.cwd(), gatewayConfig().accountStorePath);
  }

  private filePath(id: string): string {
    const safe = Buffer.from(id).toString('base64url');
    return path.join(this.root(), `${safe}.json`);
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const dir = this.root();
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const account = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Account;
        if (account?.id) this.accounts.set(account.id, account);
      } catch {
        // Skip unreadable/corrupt records rather than failing the whole console.
      }
    }
  }

  private writeFile(account: Account): void {
    const dir = this.root();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath(account.id), JSON.stringify(account, null, 2), 'utf8');
  }

  private removeFile(id: string): void {
    const file = this.filePath(id);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
