import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExperienceCompilerService } from '../compiler/experience-compiler.service';
import { IrxService } from '../irx/irx.service';
import { PersonNode, PersonNodeAdapterService } from '../person-node/person-node.adapter';
import { id } from '../shared/ids';
import { Account, CreateAccountInput, UpdateAccountInput } from './account.types';
import { AccountStore } from './accounts.store';

@Injectable()
export class AccountsService {
  constructor(
    private readonly store: AccountStore,
    private readonly personNodeAdapter: PersonNodeAdapterService,
    private readonly irx: IrxService,
    private readonly compiler: ExperienceCompilerService,
  ) {}

  // --- CRUD (full control for the admin console) -------------------------

  list(): Account[] {
    return this.store.list();
  }

  get(accountId: string): Account {
    const account = this.store.get(accountId);
    if (!account) throw new NotFoundException(`Account ${accountId} not found.`);
    return account;
  }

  create(input: CreateAccountInput): Account {
    const email = String(input?.email || '').trim();
    if (!email) throw new BadRequestException('email is required.');
    if (this.store.findByEmail(email)) throw new ConflictException(`An account with email ${email} already exists.`);

    const now = new Date().toISOString();
    const account: Account = {
      id: id('account'),
      email,
      displayName: String(input.displayName || email.split('@')[0]),
      role: input.role || 'user',
      status: input.status || 'active',
      createdAt: now,
      updatedAt: now,
      personNode: input.personNode || null,
      personNodeUpdatedAt: input.personNode ? now : null,
      metadata: input.metadata || {},
    };
    return this.store.save(account);
  }

  update(accountId: string, patch: UpdateAccountInput): Account {
    const account = this.get(accountId);
    if (patch.email && patch.email.toLowerCase() !== account.email.toLowerCase()) {
      const clash = this.store.findByEmail(patch.email);
      if (clash && clash.id !== accountId) throw new ConflictException(`Email ${patch.email} is already in use.`);
    }
    const next: Account = {
      ...account,
      ...patch,
      id: account.id,
      createdAt: account.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return this.store.save(next);
  }

  delete(accountId: string): { ok: true; id: string } {
    if (!this.store.delete(accountId)) throw new NotFoundException(`Account ${accountId} not found.`);
    return { ok: true, id: accountId };
  }

  // --- Person Node lifecycle --------------------------------------------

  /** Attach/replace the training-pipeline Person Node for an account. */
  async attachPersonNode(accountId: string, personNode: PersonNode): Promise<Account> {
    const account = this.get(accountId);
    const validation = await this.personNodeAdapter.validate(personNode);
    if (!validation.valid) {
      throw new BadRequestException(`Invalid Person Node: ${validation.errors.join(' ')}`);
    }
    return this.store.save({
      ...account,
      personNode,
      personNodeUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // --- Person Node → ExperienceManifest ---------------------------------

  /**
   * Compile an ExperienceManifest for one account's Person Node. This is the
   * handoff: the AdminConsole-built Person Node → the shared adapter →
   * IRX/preprocessing → the AI compiler that emits the ExperienceManifest.
   */
  async compileExperienceForAccount(accountId: string, options: Record<string, unknown> = {}): Promise<any> {
    const account = this.get(accountId);
    if (!account.personNode) {
      throw new BadRequestException(`Account ${accountId} has no Person Node yet. Attach one first.`);
    }
    return this.compileFromPersonNode(account.personNode, { accountId, ...options });
  }

  /** Compile an ExperienceManifest directly from a Person Node (no account). */
  async compileFromPersonNode(personNode: PersonNode, options: Record<string, unknown> = {}): Promise<any> {
    const validation = await this.personNodeAdapter.validate(personNode);
    if (!validation.valid) {
      throw new BadRequestException(`Invalid Person Node: ${validation.errors.join(' ')}`);
    }

    const irxRequest = await this.personNodeAdapter.toIrxRequest(personNode, options);
    // Run the existing IRX → preprocessing chain, producing a compiler-ready source.
    const normalized = this.irx.normalize(irxRequest);

    const compileOptions = { ...(irxRequest.options || {}), ...options };
    if (!this.compiler.canCompile(compileOptions)) {
      // No AI key configured: still return the fully prepared pipeline output so
      // the Person Node → manifest handoff is verifiable without external calls.
      return {
        ok: true,
        compiled: false,
        reason: 'No AI provider/key supplied; returning prepared IRX source. Provide options.provider + apiKeys to emit the ExperienceManifest.',
        personNodeId: personNode.id || null,
        irx: normalized.irx,
        source: normalized.source,
      };
    }

    const pkg = await this.compiler.compileWithAi(normalized.source, compileOptions);
    return {
      ok: true,
      compiled: true,
      personNodeId: personNode.id || null,
      package: pkg,
      experienceManifest: pkg.specification?.experienceManifest,
    };
  }
}
