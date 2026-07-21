# AGENTS - Knowledge Specialist RPG

- **Project Summary**: A character progression RPG where players act as a knowledge specialist. Users triage an inbox of research items, converting them into XP across four domains: Strategy, Science, Defense, and Engineering.
- **Core Loop**: Receive Quest Card -> Analyze Summary -> Select Supporting Evidence Snippets -> Earn XP and Level Up.
- **Important Files**:
    - `main.js`: Core game logic, state management, and UI controller.
    - `index.html`: Styles and DOM structure for the cyber-corporate interface.
- **Assets & Audio**:
    - `assets/data-workstation-bg.webp`: Background.
    - `assets/specialist-avatar.webp`: Player avatar.
    - `assets/audio/neural-focus-loop.mp3`: Ambient BGM.
    - `assets/audio/data-ping.mp3`, `assets/audio/analysis-success.mp3`: UI SFX.
- **Controls**: Mouse only. Click quest cards in the inbox, click snippets to select/deselect evidence, click "Confirm Analysis" to submit.
- **Status**: Validation and runtime checks passed. Game is fully playable with infinite quest cycling.