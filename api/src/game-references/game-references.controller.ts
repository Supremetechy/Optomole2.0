import { Body, Controller, Delete, Get, Param, Post, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GameReferencesService } from './game-references.service';

@ApiTags('game-references')
@Controller('game-references')
export class GameReferencesController {
  constructor(private readonly references: GameReferencesService) {}

  @Get()
  list() {
    return {
      ok: true,
      games: this.references.list(),
      grouped: this.references.grouped(),
    };
  }

  /**
   * Import GameDuplicator user games. Body may be `{ games }` / `{ projects }`,
   * a raw array (including the `gameDuplicatorProjects` localStorage shape), or a
   * single game object — the service normalizes all of them.
   */
  @Post('import')
  import(@Body() body: any) {
    const payload = body?.games ?? body?.projects ?? body;
    const imported = this.references.importUserGames(payload);
    return { ok: true, importedCount: imported.length, imported };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const game = this.references.get(id);
    if (!game) throw new NotFoundException(`Unknown game reference: ${id}`);
    return { ok: true, game };
  }

  @Delete('user/:id')
  removeUserGame(@Param('id') id: string) {
    const removed = this.references.removeUserGame(id);
    if (!removed) throw new NotFoundException(`Unknown user game: ${id}`);
    return { ok: true, removed: id };
  }
}
