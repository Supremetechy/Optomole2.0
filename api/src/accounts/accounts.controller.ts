import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../shared/admin.guard';
import { PersonNode } from '../person-node/person-node.adapter';
import { AccountsService } from './accounts.service';
import { CreateAccountInput, UpdateAccountInput } from './account.types';

/**
 * AccountsController — the admin console's backend surface for full control over
 * user account info. Every route is behind AdminGuard (x-admin-token). Includes
 * the Person Node → ExperienceManifest handoff so the console can drive the
 * Optomole engine directly from an account's training data.
 */
@ApiTags('accounts')
@ApiSecurity('admin-token')
@UseGuards(AdminGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list() {
    return { ok: true, accounts: this.accounts.list() };
  }

  @Post()
  create(@Body() body: CreateAccountInput) {
    return { ok: true, account: this.accounts.create(body) };
  }

  // Compile straight from a Person Node payload, no stored account required.
  @Post('person-node/compile')
  compileFromPersonNode(@Body() body: { personNode: PersonNode; options?: Record<string, unknown> }) {
    return this.accounts.compileFromPersonNode(body.personNode, body.options || {});
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return { ok: true, account: this.accounts.get(id) };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateAccountInput) {
    return { ok: true, account: this.accounts.update(id, body) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.delete(id);
  }

  @Put(':id/person-node')
  attachPersonNode(@Param('id') id: string, @Body() body: { personNode: PersonNode }) {
    return this.accounts.attachPersonNode(id, body.personNode);
  }

  @Post(':id/experience-manifest')
  compileExperience(@Param('id') id: string, @Body() body: { options?: Record<string, unknown> }) {
    return this.accounts.compileExperienceForAccount(id, body?.options || {});
  }
}
