import type { PersonNode } from '../person-node/person-node.adapter';

export type AccountRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'invited';

/**
 * Account — a user record the admin console has full backend control over.
 * `personNode` holds the output of the AdminConsole training pipeline for this
 * user; it is what the Optomole engine compiles an ExperienceManifest from.
 */
export interface Account {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  personNode?: PersonNode | null;
  personNodeUpdatedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateAccountInput {
  email: string;
  displayName?: string;
  role?: AccountRole;
  status?: AccountStatus;
  personNode?: PersonNode | null;
  metadata?: Record<string, unknown>;
}

export type UpdateAccountInput = Partial<Omit<Account, 'id' | 'createdAt'>>;
