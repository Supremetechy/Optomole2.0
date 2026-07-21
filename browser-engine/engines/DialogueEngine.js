/**
 * DialogueEngine — branching conversations with player choices.
 *
 * Consumes a dialogue tree (nodes keyed by id) or synthesizes a short one from
 * an NPC spec + the room's learning content. Each node has text and choices;
 * choices can set flags, trigger quest objectives, or jump to another node.
 * The DialogueScene renders whatever `current()` returns.
 *
 * Tree shape:
 *   { start: 'intro', nodes: { intro: { speaker, text, choices:[
 *       { label, next, effect:{ setFlag, completeObjective, grantKey } } ] } } }
 */
export class DialogueEngine {
  constructor({ state, quests, audio } = {}) {
    this.state = state;
    this.quests = quests;
    this.audio = audio;
    this.tree = null;
    this.nodeId = null;
    this._onEnd = null;
  }

  start(tree, onEnd) {
    this.tree = tree;
    this.nodeId = tree.start || Object.keys(tree.nodes || {})[0];
    this._onEnd = onEnd || null;
    this.audio?.play('talk');
    return this.current();
  }

  current() {
    if (!this.tree || !this.nodeId) return null;
    const node = this.tree.nodes[this.nodeId];
    if (!node) return null;
    return {
      speaker: node.speaker || 'NPC',
      text: node.text || '',
      portrait: node.portrait || 'npc',
      choices: (node.choices || []).map((c, i) => ({ index: i, label: c.label })),
      terminal: !node.choices || node.choices.length === 0,
    };
  }

  choose(index) {
    const node = this.tree?.nodes?.[this.nodeId];
    if (!node) return this._end();
    const choice = (node.choices || [])[index];
    if (!choice) return this._end();

    const effect = choice.effect || {};
    if (effect.setFlag) this.state?.setFlag(effect.setFlag, effect.flagValue ?? true);
    if (effect.completeObjective) this.quests?.complete(effect.completeObjective);
    if (effect.grantKey) {
      this.state?.addKey(effect.grantKey.id, effect.grantKey);
      this.audio?.play('pickup');
    }
    if (effect.log) this.state?.logEvent(effect.log);

    if (choice.next && this.tree.nodes[choice.next]) {
      this.nodeId = choice.next;
      this.audio?.play('talk');
      return this.current();
    }
    return this._end();
  }

  _end() {
    const cb = this._onEnd;
    this.tree = null;
    this.nodeId = null;
    this._onEnd = null;
    cb?.();
    return null;
  }

  /** Build a short teaching dialogue from an NPC spec + room facts. */
  static synthesize(npc, room) {
    const speaker = npc?.label || 'Facility Guide';
    const keyItems = (room?.entities || []).filter((e) => e.entityType === 'key-item');
    const hazards = (room?.entities || []).filter((e) => e.entityType === 'hazard');
    const briefing =
      npc?.description ||
      `Welcome to ${room?.title || 'the facility'}. Collect the evidence you need, avoid the hazards, then unlock the gate.`;

    const nodes = {
      intro: {
        speaker,
        text: briefing,
        choices: [
          { label: 'What do I need to collect?', next: 'keys' },
          { label: 'What should I avoid?', next: 'hazards' },
          { label: "I'm ready — let me in.", effect: { log: `${speaker}: Good luck.` } },
        ],
      },
      keys: {
        speaker,
        text: keyItems.length
          ? `Find and collect: ${keyItems.map((k) => k.label).join(', ')}. Each one is evidence that unlocks the gate.`
          : 'Complete the room objectives and the gate will open.',
        choices: [{ label: 'Got it.', next: 'intro' }],
      },
      hazards: {
        speaker,
        text: hazards.length
          ? `Watch for: ${hazards.map((h) => h.label).join(', ')}. Touching one costs you focus.`
          : 'No major hazards here — stay sharp anyway.',
        choices: [{ label: 'Understood.', next: 'intro' }],
      },
    };
    return { start: 'intro', nodes };
  }
}