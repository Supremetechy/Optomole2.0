import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import type { NormalizeIrxRequest } from '../irx/irx.service';

/**
 * PersonNode — the shape the AdminConsole training pipeline produces (structural
 * contract in shared/person-node/person-node.schema.json). Loosely typed here on
 * purpose: the authoritative schema lives in the shared module, and the adapter
 * logic is imported from it rather than re-implemented.
 */
export type PersonNode = Record<string, unknown> & {
  id?: string;
  identity?: Record<string, unknown>;
  system?: Record<string, unknown>;
  optomoleProfile?: Record<string, unknown>;
  evidenceGraph?: Record<string, unknown>;
};

interface SharedPersonNodeModule {
  personNodeToIrxRequest: (personNode: PersonNode, options?: Record<string, unknown>) => NormalizeIrxRequest;
  knowledgeGraphToPersonNode: (input: Record<string, unknown>) => PersonNode;
  validatePersonNode: (personNode: unknown) => { valid: boolean; errors: string[] };
  personNodeDisplayName: (personNode: PersonNode) => string;
  PERSON_NODE_SCHEMA_VERSION: string;
}

/**
 * PersonNodeAdapterService — the bridge from a Person Node to the api's IRX
 * pipeline. It loads the SHARED, framework-free adapter module at runtime (the
 * same person-node.js the AdminConsole imports) so there is exactly one
 * implementation of the contract. The api is compiled to CommonJS, so it reaches
 * the ESM shared module via dynamic import().
 */
@Injectable()
export class PersonNodeAdapterService {
  private modulePromise: Promise<SharedPersonNodeModule> | null = null;

  // The api compiles to CommonJS, where tsc rewrites a literal `import()` into a
  // `require()` that cannot load ESM. This indirection preserves a genuine
  // dynamic import in the emitted output so the shared .mjs loads as ESM on any
  // supported Node version.
  private static readonly dynamicImport: (specifier: string) => Promise<unknown> = new Function(
    'specifier',
    'return import(specifier)',
  ) as (specifier: string) => Promise<unknown>;

  private load(): Promise<SharedPersonNodeModule> {
    if (!this.modulePromise) {
      const abs = path.resolve(process.cwd(), gatewayConfig().personNodeModulePath);
      this.modulePromise = PersonNodeAdapterService.dynamicImport(pathToFileURL(abs).href) as Promise<SharedPersonNodeModule>;
    }
    return this.modulePromise;
  }

  async validate(personNode: unknown): Promise<{ valid: boolean; errors: string[] }> {
    const mod = await this.load();
    return mod.validatePersonNode(personNode);
  }

  async displayName(personNode: PersonNode): Promise<string> {
    const mod = await this.load();
    return mod.personNodeDisplayName(personNode);
  }

  /** Person Node → the api's NormalizeIrxRequest, ready for IrxService.normalize. */
  async toIrxRequest(personNode: PersonNode, options: Record<string, unknown> = {}): Promise<NormalizeIrxRequest> {
    const mod = await this.load();
    return mod.personNodeToIrxRequest(personNode, options);
  }
}
