import { createKeyLockRuntime } from '../action-adventure-key-lock/template-runtime.js';

export function createMemoryPalaceRuntime(manifest, meta = {}) {
  return createKeyLockRuntime(manifest, {
    subtitle: 'Learning Navigation · Memory Palace',
    briefing: 'Move through each memory room, inspect the anchors that prove recall, avoid confusion traps, and unlock the next chamber.',
    roomSize: 5,
    ...meta,
  });
}
