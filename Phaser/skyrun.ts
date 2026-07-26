import type { Entity, Game, Scene, StateMachine, Trigger } from "./dsl/types";
import type { GameplayBundle } from "./runtime/GameplayBundle";
import gameJson from "../game/game.json";
import level1Json from "../game/scenes/level_1.json";
import playerJson from "../game/entities/player.json";
import ground1Json from "../game/entities/ground_1.json";
import ground2Json from "../game/entities/ground_2.json";
import enemyJson from "../game/entities/enemy_1.json";
import goalJson from "../game/entities/goal_flag.json";
import playerSmJson from "../game/stateMachines/player_state_machine.json";
import enemySmJson from "../game/stateMachines/enemy_state_machine.json";
import triggersJson from "../game/triggers/triggers.json";

/**
 * SkyRun — the hand-authored reference bundle in /game, assembled into the
 * same GameplayBundle shape the API's GameplayDslService emits. It is what
 * runs when no `?bundle=` URL is supplied, and the fixture that proves an
 * adapter works before any compiled content exists.
 */
export const SKYRUN_BUNDLE: GameplayBundle = {
  game: gameJson as unknown as Game,
  scenes: [level1Json as unknown as Scene],
  entities: [playerJson, ground1Json, ground2Json, enemyJson, goalJson] as unknown as Entity[],
  stateMachines: [playerSmJson, enemySmJson] as unknown as StateMachine[],
  triggers: triggersJson as unknown as Trigger[],
};
