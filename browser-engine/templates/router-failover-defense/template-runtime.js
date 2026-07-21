import { createArcadeRuntime } from '../arcade-collect-avoid/template-runtime.js';

export function createRouterFailoverRuntime(manifest, meta = {}) {
  return createArcadeRuntime(manifest, {
    subtitle: 'Network Ops · Router Failover Defense',
    briefing: 'Restore the network by collecting correct runbook actions while avoiding attack traffic and unsafe operations.',
    ...meta,
  });
}
