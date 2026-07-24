/**
 * CustomizationPanel - Interface for customizing game duplicates
 */

class CustomizationPanel {
    constructor() {
        this.customizations = {
            metadata: {},
            assets: {},
            logic: {},
            ui: {},
            audio: {}
        };
        this.analysisData = null;
        this.previewMode = false;
    }

    /**
     * Initialize customization panel with analysis data
     */
    init(analysisData) {
        this.analysisData = analysisData;
        this.createCustomizationUI();
        this.setupEventListeners();
    }

    /**
     * Create the customization interface
     */
    createCustomizationUI() {
        const customizationHTML = `
        <div id="customizationPanel" class="fixed inset-0 z-50 bg-black bg-opacity-50 hidden">
            <div class="flex h-full">
                <!-- Sidebar -->
                <div class="w-80 bg-gray-800 overflow-y-auto">
                    <div class="p-6 border-b border-gray-700">
                        <h2 class="text-xl font-bold mb-2">Customize Your Game</h2>
                        <p class="text-gray-400 text-sm">Modify the duplicate to make it unique</p>
                    </div>
                    
                    <!-- Customization Tabs -->
                    <div class="p-4">
                        <div class="space-y-2 mb-6">
                            <button class="customization-tab w-full text-left px-4 py-3 rounded-lg bg-purple-600 text-white" data-tab="metadata">
                                <i class="fas fa-info-circle mr-2"></i>Game Info
                            </button>
                            <button class="customization-tab w-full text-left px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-tab="assets">
                                <i class="fas fa-image mr-2"></i>Assets & Graphics
                            </button>
                            <button class="customization-tab w-full text-left px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-tab="logic">
                                <i class="fas fa-cogs mr-2"></i>Game Logic
                            </button>
                            <button class="customization-tab w-full text-left px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-tab="ui">
                                <i class="fas fa-desktop mr-2"></i>User Interface
                            </button>
                            <button class="customization-tab w-full text-left px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-tab="audio">
                                <i class="fas fa-volume-up mr-2"></i>Audio & Music
                            </button>
                        </div>
                        
                        <!-- Tab Content -->
                        <div id="customizationContent">
                            ${this.generateTabContent()}
                        </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="p-6 border-t border-gray-700">
                        <div class="space-y-3">
                            <button id="previewBtn" class="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded-lg font-medium transition">
                                <i class="fas fa-eye mr-2"></i>Preview Changes
                            </button>
                            <button id="generateBtn" class="w-full bg-purple-600 hover:bg-purple-700 px-4 py-3 rounded-lg font-medium transition">
                                <i class="fas fa-magic mr-2"></i>Generate Game
                            </button>
                            <button id="playGameBtn" class="w-full bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg font-medium transition hidden">
                                <i class="fas fa-play mr-2"></i>Play Game
                            </button>
                            <button id="saveCustomizationBtn" class="w-full bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg font-medium transition">
                                <i class="fas fa-save mr-2"></i>Save Settings
                            </button>
                        </div>
                        
                        <!-- Unity Integration -->
                        <div class="mt-6 pt-4 border-t border-gray-700">
                            <h4 class="font-bold mb-3 text-orange-400">
                                <i class="fas fa-cube mr-2"></i>Unity Tools
                            </h4>
                            <div class="space-y-2">
                                <button id="openAssetStoreBtn" class="w-full bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg font-medium transition text-sm">
                                    <i class="fas fa-store mr-2"></i>Browse Assets
                                </button>
                                <button id="openPackageManagerBtn" class="w-full bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-medium transition text-sm">
                                    <i class="fas fa-cube mr-2"></i>Manage Packages
                                </button>
                                <button id="viewUnityAnalysisBtn" class="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition text-sm">
                                    <i class="fas fa-search mr-2"></i>View Analysis
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Main Content Area -->
                <div class="flex-1 bg-gray-900 overflow-y-auto">
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-6">
                            <h3 class="text-xl font-bold">Game Preview</h3>
                            <button id="closeCustomization" class="text-gray-400 hover:text-white">
                                <i class="fas fa-times text-2xl"></i>
                            </button>
                        </div>
                        
                        <!-- Preview Area -->
                        <div id="gamePreview" class="bg-gray-800 rounded-lg h-96 flex items-center justify-center">
                            <div class="text-center text-gray-400">
                                <i class="fas fa-gamepad text-6xl mb-4"></i>
                                <p>Game preview will appear here</p>
                                <p class="text-sm">Make customizations and click "Preview Changes"</p>
                            </div>
                        </div>
                        
                        <!-- Analysis Summary -->
                        <div class="mt-6 bg-gray-800 rounded-lg p-6">
                            <h4 class="text-lg font-bold mb-4">Original Game Analysis</h4>
                            <div id="analysisSummary" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <!-- Analysis data will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', customizationHTML);
        this.populateAnalysisData();
    }

    /**
     * Generate tab content based on analysis data
     */
    generateTabContent() {
        return `
        <!-- Metadata Tab -->
        <div id="metadata-tab" class="tab-content">
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium mb-2">Game Title</label>
                    <input type="text" id="gameTitle" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="Enter game title">
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Genre</label>
                    <select id="gameGenre" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="action">Action</option>
                        <option value="adventure">Adventure</option>
                        <option value="puzzle">Puzzle</option>
                        <option value="platformer">Platformer</option>
                        <option value="racing">Racing</option>
                        <option value="rpg">RPG</option>
                        <option value="strategy">Strategy</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Description</label>
                    <textarea id="gameDescription" rows="3" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="Describe your game"></textarea>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Difficulty Level</label>
                    <input type="range" id="difficultySlider" min="1" max="10" value="5" class="w-full">
                    <div class="flex justify-between text-xs text-gray-400">
                        <span>Easy</span>
                        <span>Normal</span>
                        <span>Hard</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Assets Tab -->
        <div id="assets-tab" class="tab-content hidden">
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium mb-2">Color Scheme</label>
                    <div class="grid grid-cols-3 gap-2">
                        <button class="color-scheme-btn p-3 rounded-lg border-2 border-purple-600 bg-gradient-to-r from-purple-600 to-blue-600" data-scheme="purple-blue">
                            <div class="w-full h-4 rounded"></div>
                        </button>
                        <button class="color-scheme-btn p-3 rounded-lg border-2 border-transparent bg-gradient-to-r from-red-600 to-orange-600" data-scheme="red-orange">
                            <div class="w-full h-4 rounded"></div>
                        </button>
                        <button class="color-scheme-btn p-3 rounded-lg border-2 border-transparent bg-gradient-to-r from-green-600 to-teal-600" data-scheme="green-teal">
                            <div class="w-full h-4 rounded"></div>
                        </button>
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Art Style</label>
                    <select id="artStyle" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="pixel">Pixel Art</option>
                        <option value="cartoon">Cartoon</option>
                        <option value="realistic">Realistic</option>
                        <option value="minimalist">Minimalist</option>
                        <option value="retro">Retro</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Character Design</label>
                    <div class="space-y-2">
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="customCharacter">
                            <span class="text-sm">Use custom character sprites</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="animatedSprites">
                            <span class="text-sm">Enable sprite animations</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- Logic Tab -->
        <div id="logic-tab" class="tab-content hidden">
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium mb-2">Player Speed</label>
                    <input type="range" id="playerSpeed" min="1" max="20" value="5" class="w-full">
                    <span id="speedValue" class="text-sm text-gray-400">5</span>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Jump Height</label>
                    <input type="range" id="jumpHeight" min="5" max="25" value="10" class="w-full">
                    <span id="jumpValue" class="text-sm text-gray-400">10</span>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Enemy Behavior</label>
                    <select id="enemyBehavior" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="patrol">Patrol Pattern</option>
                        <option value="chase">Chase Player</option>
                        <option value="random">Random Movement</option>
                        <option value="guard">Guard Position</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Game Features</label>
                    <div class="space-y-2">
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="powerUps" checked>
                            <span class="text-sm">Power-ups</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="multipleLives" checked>
                            <span class="text-sm">Multiple lives</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="saveProgress">
                            <span class="text-sm">Save progress</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- UI Tab -->
        <div id="ui-tab" class="tab-content hidden">
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium mb-2">UI Theme</label>
                    <select id="uiTheme" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="modern">Modern</option>
                        <option value="retro">Retro</option>
                        <option value="minimalist">Minimalist</option>
                        <option value="futuristic">Futuristic</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Button Style</label>
                    <div class="grid grid-cols-2 gap-2">
                        <button class="button-style-btn p-2 rounded-lg border-2 border-purple-600 bg-gray-700" data-style="rounded">Rounded</button>
                        <button class="button-style-btn p-2 border-2 border-transparent bg-gray-700" data-style="square">Square</button>
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">HUD Elements</label>
                    <div class="space-y-2">
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="showScore" checked>
                            <span class="text-sm">Score display</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="showHealth" checked>
                            <span class="text-sm">Health bar</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="showMinimap">
                            <span class="text-sm">Mini-map</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- Audio Tab -->
        <div id="audio-tab" class="tab-content hidden">
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium mb-2">Music Style</label>
                    <select id="musicStyle" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="electronic">Electronic</option>
                        <option value="orchestral">Orchestral</option>
                        <option value="chiptune">Chiptune</option>
                        <option value="ambient">Ambient</option>
                        <option value="rock">Rock</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Master Volume</label>
                    <input type="range" id="masterVolume" min="0" max="100" value="80" class="w-full">
                    <span id="masterVolumeValue" class="text-sm text-gray-400">80%</span>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Sound Effects</label>
                    <div class="space-y-2">
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="jumpSound" checked>
                            <span class="text-sm">Jump sound</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="collectSound" checked>
                            <span class="text-sm">Collect sound</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" class="mr-2" id="damageSound" checked>
                            <span class="text-sm">Damage sound</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Setup event listeners for the customization panel
     */
    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.customization-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Color scheme selection
        document.querySelectorAll('.color-scheme-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.color-scheme-btn').forEach(b => b.classList.remove('border-purple-600'));
                e.target.closest('button').classList.add('border-purple-600');
                this.customizations.assets.colorScheme = e.target.closest('button').dataset.scheme;
            });
        });

        // Range sliders
        const sliders = ['playerSpeed', 'jumpHeight', 'masterVolume'];
        sliders.forEach(sliderId => {
            const slider = document.getElementById(sliderId);
            const valueSpan = document.getElementById(sliderId === 'masterVolume' ? 'masterVolumeValue' : sliderId.replace('player', '').replace('Height', 'Value').toLowerCase());
            
            if (slider && valueSpan) {
                slider.addEventListener('input', (e) => {
                    const value = e.target.value;
                    valueSpan.textContent = sliderId === 'masterVolume' ? value + '%' : value;
                    this.updateCustomization(sliderId, value);
                });
            }
        });

        // Action buttons
        document.getElementById('previewBtn').addEventListener('click', () => this.previewChanges());
        document.getElementById('generateBtn').addEventListener('click', () => this.generateGame());
        document.getElementById('playGameBtn').addEventListener('click', () => this.playGame());
        document.getElementById('saveCustomizationBtn').addEventListener('click', () => this.saveCustomizations());
        document.getElementById('closeCustomization').addEventListener('click', () => this.close());
        
        // Unity integration buttons
        document.getElementById('openAssetStoreBtn').addEventListener('click', () => {
            if (window.assetStoreIntegration) {
                window.assetStoreIntegration.showAssetStore(this.analysisData);
            }
        });
        
        document.getElementById('openPackageManagerBtn').addEventListener('click', () => {
            if (window.packageManager) {
                window.packageManager.showPackageManager(this.analysisData);
            }
        });
        
        document.getElementById('viewUnityAnalysisBtn').addEventListener('click', () => {
            this.showUnityAnalysisDetails();
        });
    }

    /**
     * Switch between customization tabs
     */
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.customization-tab').forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.classList.remove('bg-gray-700', 'text-gray-300');
                tab.classList.add('bg-purple-600', 'text-white');
            } else {
                tab.classList.remove('bg-purple-600', 'text-white');
                tab.classList.add('bg-gray-700', 'text-gray-300');
            }
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(tabName + '-tab').classList.remove('hidden');
    }

    /**
     * Populate analysis data in the summary section
     */
    populateAnalysisData() {
        if (!this.analysisData) return;

        const summaryContainer = document.getElementById('analysisSummary');
        const summaryHTML = `
            <div class="bg-gray-700 rounded-lg p-4">
                <h5 class="font-bold mb-2">Game Type</h5>
                <p class="text-gray-300">${this.analysisData.gameLogic?.gameType || 'Unknown'}</p>
            </div>
            <div class="bg-gray-700 rounded-lg p-4">
                <h5 class="font-bold mb-2">Engine</h5>
                <p class="text-gray-300">${this.analysisData.metadata?.engine || 'Unknown'}</p>
            </div>
            <div class="bg-gray-700 rounded-lg p-4">
                <h5 class="font-bold mb-2">Assets Found</h5>
                <p class="text-gray-300">${this.analysisData.assets?.sprites?.length || 0} sprites, ${this.analysisData.assets?.sounds?.length || 0} sounds</p>
            </div>
        `;
        summaryContainer.innerHTML = summaryHTML;
    }

    /**
     * Update customization values
     */
    updateCustomization(key, value) {
        const keyParts = key.split('.');
        let target = this.customizations;
        
        for (let i = 0; i < keyParts.length - 1; i++) {
            if (!target[keyParts[i]]) target[keyParts[i]] = {};
            target = target[keyParts[i]];
        }
        
        target[keyParts[keyParts.length - 1]] = value;
    }

    /**
     * Preview customization changes
     */
    previewChanges() {
        const previewArea = document.getElementById('gamePreview');
        previewArea.innerHTML = `
            <div class="w-full h-full bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                <div class="text-center text-white">
                    <i class="fas fa-play-circle text-6xl mb-4"></i>
                    <h4 class="text-xl font-bold">Preview Mode</h4>
                    <p>Your customized game preview</p>
                </div>
            </div>
        `;
        this.previewMode = true;
    }

    /**
     * Generate the customized game
     */
    async generateGame() {
        const generator = new GameGenerator();
        
        // Collect all customizations
        this.collectAllCustomizations();
        
        // Close customization panel
        this.close();
        
        // Show the original duplication modal with real generation
        const modal = document.getElementById('duplicationModal');
        const gameNameSpan = document.getElementById('gameName');
        
        gameNameSpan.textContent = this.customizations.metadata.title || 'Customized Game';
        modal.classList.remove('hidden');
        
        try {
            await generator.generateGame(
                this.analysisData,
                this.customizations,
                (progress, status) => {
                    document.getElementById('progressBar').style.width = progress + '%';
                    document.getElementById('progressText').textContent = progress + '%';
                    document.getElementById('statusText').textContent = status;
                }
            );
            
            // Show completion and play button
            document.getElementById('doneBtn').classList.remove('hidden');
            document.getElementById('playGameBtn').classList.remove('hidden');
            
        } catch (error) {
            console.error('Generation failed:', error);
            document.getElementById('statusText').textContent = 'Generation failed!';
        }
    }

    /**
     * Play the current game
     */
    async playGame() {
        if (!this.analysisData) {
            console.error('No analysis data available for playing');
            return;
        }
        
        // Collect all customizations
        this.collectAllCustomizations();
        
        // Prepare game data for the player
        const gameData = {
            name: this.customizations.metadata.title || 'Custom Game',
            type: this.analysisData.gameLogic?.gameType || 'platformer',
            engine: this.analysisData.metadata?.engine || 'html5',
            originalGame: this.analysisData.metadata?.title || 'Unknown Game',
            customizations: this.customizations,
            analysisData: this.analysisData
        };
        
        // Create a temporary project for the game player
        const tempProject = {
            id: 'temp_' + Date.now(),
            name: gameData.name,
            analysisData: this.analysisData,
            customizations: this.customizations,
            status: 'completed'
        };
        
        // Launch the game player
        if (window.gamePlayer) {
            this.close(); // Close customization panel
            await window.gamePlayer.loadGame(gameData, tempProject);
        } else {
            console.error('Game player not available');
        }
    }

    /**
     * Collect all customization values from the form
     */
    collectAllCustomizations() {
        // Metadata
        this.customizations.metadata.title = document.getElementById('gameTitle')?.value;
        this.customizations.metadata.genre = document.getElementById('gameGenre')?.value;
        this.customizations.metadata.description = document.getElementById('gameDescription')?.value;
        
        // Logic
        this.customizations.logic.playerSpeed = document.getElementById('playerSpeed')?.value;
        this.customizations.logic.jumpHeight = document.getElementById('jumpHeight')?.value;
        
        // UI
        this.customizations.ui.theme = document.getElementById('uiTheme')?.value;
        
        // Audio
        this.customizations.audio.musicStyle = document.getElementById('musicStyle')?.value;
        this.customizations.audio.masterVolume = document.getElementById('masterVolume')?.value;
    }

    /**
     * Save customizations to local storage
     */
    saveCustomizations() {
        this.collectAllCustomizations();
        localStorage.setItem('gameCustomizations', JSON.stringify(this.customizations));
        
        // Show confirmation
        const btn = document.getElementById('saveCustomizationBtn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
        btn.classList.add('bg-green-600');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('bg-green-600');
        }, 2000);
    }

    /**
     * Show the customization panel
     */
    show() {
        document.getElementById('customizationPanel').classList.remove('hidden');
    }

    /**
     * Close the customization panel
     */
    close() {
        document.getElementById('customizationPanel').classList.add('hidden');
    }

    /**
     * Show Unity analysis details
     */
    showUnityAnalysisDetails() {
        if (!this.analysisData) return;
        
        const isUnityGame = this.analysisData.engine === 'unity';
        const hasRuntimeData = this.analysisData.runtimeData;
        
        let detailsHTML = `
        <div class="bg-gray-800 rounded-lg p-6 max-h-96 overflow-y-auto">
            <h3 class="text-lg font-bold mb-4 text-orange-400">
                <i class="fas fa-cube mr-2"></i>Unity Analysis Details
            </h3>
        `;
        
        if (isUnityGame) {
            detailsHTML += `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-gray-700 p-3 rounded">
                        <h4 class="font-bold text-white mb-2">Engine Info</h4>
                        <p class="text-sm text-gray-300">Version: ${this.analysisData.version || 'Unknown'}</p>
                        <p class="text-sm text-gray-300">Platform: ${this.analysisData.platform || 'Unknown'}</p>
                        <p class="text-sm text-gray-300">Pipeline: ${this.analysisData.renderPipeline || 'Unknown'}</p>
                    </div>
                    <div class="bg-gray-700 p-3 rounded">
                        <h4 class="font-bold text-white mb-2">Analysis Method</h4>
                        <p class="text-sm text-gray-300">Type: ${this.analysisData.analysisMethod || 'Standard'}</p>
                        <p class="text-sm text-gray-300">Input: ${this.analysisData.inputSystem || 'Legacy'}</p>
                    </div>
                </div>
            `;
            
            if (this.analysisData.scripts) {
                detailsHTML += `
                <div class="bg-gray-700 p-3 rounded">
                    <h4 class="font-bold text-white mb-2">Scripts & GameObjects</h4>
                    <p class="text-sm text-gray-300">Estimated Scripts: ${this.analysisData.scripts.estimatedScripts || 0}</p>
                    <p class="text-sm text-gray-300">GameObjects: ${this.analysisData.scripts.detectedGameObjects?.length || 0}</p>
                    <p class="text-sm text-gray-300">Methods: ${this.analysisData.scripts.detectedMethods?.length || 0}</p>
                </div>
                `;
            }
            
            if (hasRuntimeData) {
                detailsHTML += `
                <div class="bg-gray-700 p-3 rounded">
                    <h4 class="font-bold text-white mb-2">Runtime Data</h4>
                    <p class="text-sm text-gray-300">Performance: ${this.analysisData.performance?.averageFPS || 'Unknown'} FPS</p>
                    <p class="text-sm text-gray-300">Memory: ${this.analysisData.performance?.averageMemory || 'Unknown'}</p>
                    <p class="text-sm text-gray-300">Network Requests: ${this.analysisData.runtimeData?.network?.totalRequests || 0}</p>
                </div>
                `;
            }
            
            if (this.analysisData.assets) {
                detailsHTML += `
                <div class="bg-gray-700 p-3 rounded">
                    <h4 class="font-bold text-white mb-2">Assets</h4>
                    <p class="text-sm text-gray-300">Textures: ${this.analysisData.assets.textures?.count || 0}</p>
                    <p class="text-sm text-gray-300">Shaders: ${this.analysisData.assets.shaders?.count || 0}</p>
                    <p class="text-sm text-gray-300">Total Assets: ${this.analysisData.assets.totalAssets || 0}</p>
                </div>
                `;
            }
            
        } else {
            detailsHTML += `
            <div class="text-center py-8">
                <i class="fas fa-info-circle text-4xl text-blue-400 mb-4"></i>
                <h4 class="text-lg font-bold text-white mb-2">Non-Unity Game</h4>
                <p class="text-gray-400">This game was analyzed using ${this.analysisData.engine || 'generic'} methods.</p>
                <p class="text-gray-400 text-sm mt-2">Unity-specific features are not available.</p>
            </div>
            `;
        }
        
        detailsHTML += `
            </div>
        </div>
        `;
        
        // Show in a modal or replace preview area
        const previewArea = document.getElementById('gamePreview');
        if (previewArea) {
            previewArea.innerHTML = detailsHTML;
        }
    }

    /**
     * Get current customizations
     */
    getCustomizations() {
        return this.customizations;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CustomizationPanel;
} else {
    window.CustomizationPanel = CustomizationPanel;
}