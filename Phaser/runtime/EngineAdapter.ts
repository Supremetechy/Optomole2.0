import { Scene, Entity, Event, Action, Vector3 } from "../dsl/types";

// The contract every engine adapter (Phaser, Unity, Unreal, Pixi…) implements.
// The RuntimeCore only ever talks to this interface.
export interface EngineAdapter {
  // Scene lifecycle
  createScene(scene: Scene): void;
  destroyScene(sceneId: string): void;

  // Entity lifecycle
  createEntity(entity: Entity): void;
  destroyEntity(entityId: string): void;

  // Event bridge (engine → core)
  pollEngineEvents(): Event[];

  // Action bridge (core → engine)
  applyAction(action: Action): void;

  // Frame update (core → engine, once per tick after event processing)
  update(deltaTime: number): void;

  // Utility: engine-native handle for an entity (sprite, GameObject, actor)
  getEntityHandle(entityId: string): unknown;

  /**
   * World position in DSL units (meters, y-up), or undefined for an entity the
   * adapter does not hold.
   *
   * The core needs this to answer distance and perception conditions and to
   * resolve `targetTag` into a concrete target before handing a movement action
   * over. Keeping the query here — rather than duplicating a transform cache in
   * the core — is what lets one compiled behavior tree run in any engine: the
   * core asks "where is it", never "how is it stored".
   */
  getEntityPosition(entityId: string): Vector3 | undefined;
}
