/**
 * Game Player - In-app game runtime for playing duplicated games
 */

class GamePlayer {
    constructor() {
        this.currentGame = null;
        this.gameContainer = null;
        this.gameCanvas = null;
        this.gameContext = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.gameLoop = null;
        this.inputManager = null;
        this.audioManager = null;
        this.gameState = {
            score: 0,
            lives: 3,
            level: 1,
            time: 0,
            gameObjects: [],
            player: null
        };
        this.settings = {
            volume: 0.8,
            controls: 'keyboard',
            quality: 'medium',
            fullscreen: false
        };
    }

    /**
     * Initialize the game player
     */
    initialize() {
        this.createGamePlayerUI();
        this.setupEventListeners();
        this.initializeInputManager();
        this.initializeAudioManager();
        console.log('🎮 Game Player initialized');
    }

    /**
     * Create the game player UI
     */
    createGamePlayerUI() {
        const gamePlayerHTML = `
        <div id="gamePlayerPanel" class="fixed inset-0 z-50 bg-black hidden">
            <!-- Game Player Header -->
            <div class="bg-gray-900 border-b border-gray-700 p-4">
                <div class="flex justify-between items-center">
                    <div class="flex items-center space-x-4">
                        <button id="backToMenu" class="text-gray-400 hover:text-white transition">
                            <i class="fas fa-arrow-left text-xl"></i>
                        </button>
                        <div>
                            <h2 id="gameTitle" class="text-xl font-bold text-white">Game Player</h2>
                            <p id="gameSubtitle" class="text-sm text-gray-400">Ready to play</p>
                        </div>
                    </div>
                    
                    <!-- Game Controls -->
                    <div class="flex items-center space-x-3">
                        <button id="playPauseBtn" class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-medium transition">
                            <i class="fas fa-play mr-2"></i>Play
                        </button>
                        <button id="restartBtn" class="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg transition">
                            <i class="fas fa-redo"></i>
                        </button>
                        <button id="settingsBtn" class="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg transition">
                            <i class="fas fa-cog"></i>
                        </button>
                        <button id="fullscreenBtn" class="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg transition">
                            <i class="fas fa-expand"></i>
                        </button>
                        <button id="closePlayer" class="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg transition">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Game Area -->
            <div class="flex h-full">
                <!-- Game Canvas Container -->
                <div id="gameCanvasContainer" class="flex-1 bg-black relative">
                    <canvas id="gameCanvas" class="w-full h-full"></canvas>
                    
                    <!-- Game Overlay -->
                    <div id="gameOverlay" class="absolute inset-0 pointer-events-none">
                        <!-- HUD Elements -->
                        <div class="absolute top-4 left-4 text-white">
                            <div class="bg-black bg-opacity-50 px-3 py-2 rounded-lg">
                                <div class="flex items-center space-x-4 text-sm">
                                    <span>Score: <span id="scoreDisplay" class="font-bold">0</span></span>
                                    <span>Lives: <span id="livesDisplay" class="font-bold">3</span></span>
                                    <span>Level: <span id="levelDisplay" class="font-bold">1</span></span>
                                    <span>Time: <span id="timeDisplay" class="font-bold">0:00</span></span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Game Messages -->
                        <div id="gameMessages" class="absolute inset-0 flex items-center justify-center">
                            <!-- Dynamic messages will appear here -->
                        </div>
                        
                        <!-- Loading Screen -->
                        <div id="loadingScreen" class="absolute inset-0 bg-black flex items-center justify-center">
                            <div class="text-center text-white">
                                <div class="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
                                <h3 class="text-xl font-bold mb-2">Loading Game...</h3>
                                <p class="text-gray-400">Preparing your experience</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Mobile Controls (shown on mobile) -->
                    <div id="mobileControls" class="absolute bottom-4 inset-x-4 flex justify-between md:hidden">
                        <div class="flex space-x-2">
                            <button class="mobile-btn bg-blue-600 bg-opacity-80 text-white p-3 rounded-full" data-action="left">
                                <i class="fas fa-arrow-left"></i>
                            </button>
                            <button class="mobile-btn bg-blue-600 bg-opacity-80 text-white p-3 rounded-full" data-action="right">
                                <i class="fas fa-arrow-right"></i>
                            </button>
                        </div>
                        <div class="flex space-x-2">
                            <button class="mobile-btn bg-red-600 bg-opacity-80 text-white p-3 rounded-full" data-action="jump">
                                <i class="fas fa-arrow-up"></i>
                            </button>
                            <button class="mobile-btn bg-green-600 bg-opacity-80 text-white p-3 rounded-full" data-action="action">
                                <i class="fas fa-hand-paper"></i>
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Game Info Sidebar -->
                <div id="gameInfoSidebar" class="w-80 bg-gray-800 overflow-y-auto">
                    <div class="p-6">
                        <!-- Game Stats -->
                        <div class="bg-gray-700 rounded-lg p-4 mb-6">
                            <h3 class="font-bold text-white mb-3">Game Stats</h3>
                            <div class="space-y-2 text-sm">
                                <div class="flex justify-between">
                                    <span class="text-gray-400">High Score:</span>
                                    <span id="highScore" class="text-white font-bold">0</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Best Time:</span>
                                    <span id="bestTime" class="text-white font-bold">--:--</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Games Played:</span>
                                    <span id="gamesPlayed" class="text-white font-bold">0</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Completion:</span>
                                    <span id="completion" class="text-white font-bold">0%</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Controls Guide -->
                        <div class="bg-gray-700 rounded-lg p-4 mb-6">
                            <h3 class="font-bold text-white mb-3">Controls</h3>
                            <div id="controlsGuide" class="space-y-2 text-sm text-gray-300">
                                <!-- Controls will be populated here -->
                            </div>
                        </div>
                        
                        <!-- Game Features -->
                        <div class="bg-gray-700 rounded-lg p-4 mb-6">
                            <h3 class="font-bold text-white mb-3">Features</h3>
                            <div id="gameFeatures" class="space-y-2">
                                <!-- Game features will be populated here -->
                            </div>
                        </div>
                        
                        <!-- Quick Actions -->
                        <div class="space-y-3">
                            <button id="shareGameBtn" class="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition text-sm">
                                <i class="fas fa-share mr-2"></i>Share Game
                            </button>
                            <button id="editGameBtn" class="w-full bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-medium transition text-sm">
                                <i class="fas fa-edit mr-2"></i>Edit Game
                            </button>
                            <button id="exportGameBtn" class="w-full bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-medium transition text-sm">
                                <i class="fas fa-download mr-2"></i>Export Game
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Game Settings Modal -->
        <div id="gameSettingsModal" class="fixed inset-0 z-60 bg-black bg-opacity-50 flex items-center justify-center hidden">
            <div class="bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">Game Settings</h3>
                    <button id="closeSettings" class="text-gray-400 hover:text-white">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="space-y-4">
                    <!-- Volume Control -->
                    <div>
                        <label class="block text-sm font-medium text-white mb-2">Volume</label>
                        <input type="range" id="volumeSlider" min="0" max="100" value="80" 
                               class="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer">
                        <span id="volumeValue" class="text-sm text-gray-400">80%</span>
                    </div>
                    
                    <!-- Graphics Quality -->
                    <div>
                        <label class="block text-sm font-medium text-white mb-2">Graphics Quality</label>
                        <select id="qualitySelect" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white">
                            <option value="low">Low</option>
                            <option value="medium" selected>Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                    
                    <!-- Controls -->
                    <div>
                        <label class="block text-sm font-medium text-white mb-2">Controls</label>
                        <select id="controlsSelect" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white">
                            <option value="keyboard" selected>Keyboard</option>
                            <option value="mouse">Mouse</option>
                            <option value="gamepad">Gamepad</option>
                            <option value="touch">Touch (Mobile)</option>
                        </select>
                    </div>
                    
                    <!-- Advanced Settings -->
                    <div class="space-y-2">
                        <label class="flex items-center">
                            <input type="checkbox" id="showFPS" class="mr-2">
                            <span class="text-sm text-white">Show FPS</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" id="enableDebug" class="mr-2">
                            <span class="text-sm text-white">Debug Mode</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" id="autoSave" class="mr-2" checked>
                            <span class="text-sm text-white">Auto Save Progress</span>
                        </label>
                    </div>
                </div>
                
                <div class="flex justify-end space-x-3 mt-6">
                    <button id="resetSettings" class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg text-white transition">
                        Reset
                    </button>
                    <button id="saveSettings" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-white transition">
                        Save
                    </button>
                </div>
            </div>
        </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', gamePlayerHTML);
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Main controls
        document.getElementById('backToMenu').addEventListener('click', () => this.exitGame());
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('restartBtn').addEventListener('click', () => this.restartGame());
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
        document.getElementById('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('closePlayer').addEventListener('click', () => this.exitGame());
        
        // Sidebar actions
        document.getElementById('shareGameBtn').addEventListener('click', () => this.shareGame());
        document.getElementById('editGameBtn').addEventListener('click', () => this.editGame());
        document.getElementById('exportGameBtn').addEventListener('click', () => this.exportGame());
        
        // Settings modal
        document.getElementById('closeSettings').addEventListener('click', () => this.hideSettings());
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('resetSettings').addEventListener('click', () => this.resetSettings());
        
        // Volume slider
        document.getElementById('volumeSlider').addEventListener('input', (e) => {
            const volume = e.target.value;
            document.getElementById('volumeValue').textContent = volume + '%';
            this.settings.volume = volume / 100;
            this.updateAudioVolume();
        });
        
        // Mobile controls
        document.querySelectorAll('.mobile-btn').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.handleMobileInput(btn.dataset.action, true);
            });
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.handleMobileInput(btn.dataset.action, false);
            });
        });
        
        // Canvas resize
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Keyboard controls
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }

    /**
     * Initialize input manager
     */
    initializeInputManager() {
        this.inputManager = {
            keys: {},
            mouse: { x: 0, y: 0, buttons: {} },
            gamepad: null,
            touches: []
        };
    }

    /**
     * Initialize audio manager
     */
    initializeAudioManager() {
        this.audioManager = {
            context: null,
            sounds: new Map(),
            music: null,
            volume: this.settings.volume
        };
        
        try {
            this.audioManager.context = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('Audio context not available:', error);
        }
    }

    /**
     * Load and start a game
     */
    async loadGame(gameData, projectData = null) {
        console.log('🎮 Loading game:', gameData.name || 'Unknown Game');
        
        try {
            this.currentGame = {
                data: gameData,
                project: projectData,
                name: gameData.name || 'Duplicated Game',
                type: gameData.type || 'platformer'
            };
            
            // Show game player
            this.showGamePlayer();
            
            // Update UI
            this.updateGameInfo();
            
            // Initialize canvas
            this.initializeCanvas();
            
            // Load game assets
            await this.loadGameAssets();
            
            // Initialize game objects
            this.initializeGameObjects();
            
            // Hide loading screen
            document.getElementById('loadingScreen').classList.add('hidden');
            
            // Update play button
            const playBtn = document.getElementById('playPauseBtn');
            playBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Play';
            playBtn.disabled = false;
            
            console.log('✅ Game loaded successfully');
            
        } catch (error) {
            console.error('Failed to load game:', error);
            this.showGameMessage('Failed to load game: ' + error.message, 'error');
        }
    }

    /**
     * Show the game player
     */
    showGamePlayer() {
        document.getElementById('gamePlayerPanel').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide the game player
     */
    hideGamePlayer() {
        document.getElementById('gamePlayerPanel').classList.add('hidden');
        document.body.style.overflow = 'auto';
        this.stopGame();
    }

    /**
     * Update game information in UI
     */
    updateGameInfo() {
        if (!this.currentGame) return;
        
        document.getElementById('gameTitle').textContent = this.currentGame.name;
        document.getElementById('gameSubtitle').textContent = `${this.currentGame.type} game`;
        
        // Update controls guide
        this.updateControlsGuide();
        
        // Update game features
        this.updateGameFeatures();
        
        // Load saved stats
        this.loadGameStats();
    }

    /**
     * Initialize game canvas
     */
    initializeCanvas() {
        this.gameCanvas = document.getElementById('gameCanvas');
        this.gameContext = this.gameCanvas.getContext('2d');
        this.resizeCanvas();
        
        // Set up canvas properties
        this.gameContext.imageSmoothingEnabled = this.settings.quality !== 'low';
    }

    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        if (!this.gameCanvas) return;
        
        const container = document.getElementById('gameCanvasContainer');
        const rect = container.getBoundingClientRect();
        
        this.gameCanvas.width = rect.width;
        this.gameCanvas.height = rect.height;
        
        // Maintain aspect ratio for games that need it
        if (this.currentGame && this.currentGame.aspectRatio) {
            const targetRatio = this.currentGame.aspectRatio;
            const currentRatio = rect.width / rect.height;
            
            if (currentRatio > targetRatio) {
                this.gameCanvas.width = rect.height * targetRatio;
            } else {
                this.gameCanvas.height = rect.width / targetRatio;
            }
        }
    }

    /**
     * Load game assets
     */
    async loadGameAssets() {
        console.log('📦 Loading game assets...');
        
        // This would load actual game assets in a real implementation
        return new Promise((resolve) => {
            setTimeout(() => {
                console.log('✅ Assets loaded');
                resolve();
            }, 1500);
        });
    }

    /**
     * Initialize game objects based on analyzed data
     */
    initializeGameObjects() {
        console.log('🎯 Initializing game objects...');
        
        this.gameState = {
            score: 0,
            lives: 3,
            level: 1,
            time: 0,
            gameObjects: [],
            player: null
        };
        
        // Create player object
        this.gameState.player = {
            x: 100,
            y: 300,
            width: 32,
            height: 32,
            velocityX: 0,
            velocityY: 0,
            speed: 5,
            jumpPower: 12,
            grounded: false,
            color: '#4A90E2'
        };
        
        // Create some basic game objects for demo
        this.createDemoObjects();
        
        this.updateHUD();
    }

    /**
     * Create demo game objects
     */
    createDemoObjects() {
        // Create platforms
        const platforms = [
            { x: 0, y: 500, width: 800, height: 100, color: '#2C3E50' },
            { x: 200, y: 400, width: 200, height: 20, color: '#34495E' },
            { x: 500, y: 300, width: 200, height: 20, color: '#34495E' },
            { x: 100, y: 200, width: 150, height: 20, color: '#34495E' }
        ];
        
        // Create collectibles
        const collectibles = [
            { x: 250, y: 360, width: 20, height: 20, color: '#F39C12', type: 'coin', value: 10 },
            { x: 550, y: 260, width: 20, height: 20, color: '#F39C12', type: 'coin', value: 10 },
            { x: 150, y: 160, width: 20, height: 20, color: '#E74C3C', type: 'gem', value: 50 }
        ];
        
        // Create enemies
        const enemies = [
            { x: 300, y: 380, width: 25, height: 25, color: '#E74C3C', speed: 2, direction: 1, type: 'basic' },
            { x: 600, y: 280, width: 25, height: 25, color: '#8E44AD', speed: 1.5, direction: -1, type: 'basic' }
        ];
        
        this.gameState.gameObjects = [...platforms, ...collectibles, ...enemies];
    }

    /**
     * Start the game
     */
    startGame() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.isPaused = false;
        
        // Start game loop
        this.gameLoop = setInterval(() => {
            this.updateGame();
            this.renderGame();
        }, 1000 / 60); // 60 FPS
        
        // Update UI
        const playBtn = document.getElementById('playPauseBtn');
        playBtn.innerHTML = '<i class="fas fa-pause mr-2"></i>Pause';
        
        this.showGameMessage('Game Started!', 'success', 2000);
        console.log('▶️ Game started');
    }

    /**
     * Pause the game
     */
    pauseGame() {
        if (!this.isPlaying) return;
        
        this.isPaused = true;
        
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
        
        // Update UI
        const playBtn = document.getElementById('playPauseBtn');
        playBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Resume';
        
        this.showGameMessage('Game Paused', 'info');
        console.log('⏸️ Game paused');
    }

    /**
     * Stop the game
     */
    stopGame() {
        this.isPlaying = false;
        this.isPaused = false;
        
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
        
        // Update UI
        const playBtn = document.getElementById('playPauseBtn');
        playBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Play';
        
        console.log('⏹️ Game stopped');
    }

    /**
     * Toggle play/pause
     */
    togglePlayPause() {
        if (!this.currentGame) return;
        
        if (this.isPlaying && !this.isPaused) {
            this.pauseGame();
        } else {
            this.startGame();
        }
    }

    /**
     * Restart the game
     */
    restartGame() {
        this.stopGame();
        this.initializeGameObjects();
        this.showGameMessage('Game Restarted!', 'info', 2000);
        
        if (this.isPlaying || this.isPaused) {
            setTimeout(() => this.startGame(), 500);
        }
    }

    /**
     * Exit the game
     */
    exitGame() {
        this.stopGame();
        this.hideGamePlayer();
        this.currentGame = null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GamePlayer;
} else {
    window.GamePlayer = GamePlayer;
}

// Enhanced Platformer Preview Game Implementation
        function initializePlatformerPreview(canvas, ctx, gameId, scoreDisplay) {
            const gameState = {
                running: true,
                paused: false,
                score: 0,
                level: 1,
                lives: 3,
                player: {
                    x: 50,
                    y: canvas.height - 100,
                    width: 20,
                    height: 30,
                    velocityX: 0,
                    velocityY: 0,
                    onGround: false,
                    speed: 5,
                    jumpPower: 12,
                    facingRight: true
                },
                platforms: [],
                enemies: [],
                coins: [],
                particles: [],
                gravity: 0.5,
                gameCamera: { x: 0, y: 0 },
                keys: {},
                lastUpdateTime: 0
            };

            gamePreviewStates[gameId] = gameState;

            function createPlatforms() {
                return [
                    // Ground platforms
                    { x: 0, y: canvas.height - 20, width: 200, height: 20, type: 'ground' },
                    { x: 250, y: canvas.height - 20, width: 150, height: 20, type: 'ground' },
                    { x: 450, y: canvas.height - 20, width: 200, height: 20, type: 'ground' },
                    
                    // Floating platforms
                    { x: 150, y: canvas.height - 120, width: 100, height: 15, type: 'platform' },
                    { x: 350, y: canvas.height - 180, width: 80, height: 15, type: 'platform' },
                    { x: 500, y: canvas.height - 250, width: 120, height: 15, type: 'platform' },
                    { x: 200, y: canvas.height - 300, width: 100, height: 15, type: 'platform' },
                    
                    // Higher platforms
                    { x: 400, y: canvas.height - 350, width: 150, height: 15, type: 'platform' },
                    { x: 100, y: canvas.height - 400, width: 80, height: 15, type: 'platform' },
                    
                    // Moving platforms (simplified - static for now)
                    { x: 600, y: canvas.height - 200, width: 80, height: 15, type: 'moving' }
                ];
            }

            function createEnemies() {
                return [
                    { x: 300, y: canvas.height - 50, width: 15, height: 15, velocityX: -1, direction: -1, health: 1, type: 'walker' },
                    { x: 500, y: canvas.height - 50, width: 15, height: 15, velocityX: 1, direction: 1, health: 1, type: 'walker' },
                    { x: 180, y: canvas.height - 140, width: 15, height: 15, velocityX: -1, direction: -1, health: 1, type: 'walker' },
                    { x: 450, y: canvas.height - 270, width: 15, height: 15, velocityX: 1, direction: 1, health: 1, type: 'walker' }
                ];
            }

            function createCoins() {
                return [
                    { x: 175, y: canvas.height - 140, width: 10, height: 10, collected: false, value: 100 },
                    { x: 375, y: canvas.height - 200, width: 10, height: 10, collected: false, value: 100 },
                    { x: 550, y: canvas.height - 270, width: 10, height: 10, collected: false, value: 100 },
                    { x: 230, y: canvas.height - 320, width: 10, height: 10, collected: false, value: 100 },
                    { x: 475, y: canvas.height - 370, width: 10, height: 10, collected: false, value: 100 },
                    { x: 130, y: canvas.height - 420, width: 10, height: 10, collected: false, value: 100 },
                    // Bonus coins
                    { x: 320, y: canvas.height - 180, width: 10, height: 10, collected: false, value: 200 },
                    { x: 220, y: canvas.height - 300, width: 10, height: 10, collected: false, value: 200 }
                ];
            }

            function createParticle(x, y, color, velocityX = 0, velocityY = 0) {
                return {
                    x: x,
                    y: y,
                    velocityX: velocityX + (Math.random() - 0.5) * 4,
                    velocityY: velocityY + (Math.random() - 0.5) * 4,
                    life: 30 + Math.random() * 20,
                    maxLife: 50,
                    color: color,
                    size: Math.random() * 3 + 1
                };
            }

            // Initialize game objects
            gameState.platforms = createPlatforms();
            gameState.enemies = createEnemies();
            gameState.coins = createCoins();

            function drawPlatformerGame() {
                if (!gameState.running) return;

                // Sky blue gradient background
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#87CEEB');
                gradient.addColorStop(1, '#E0F6FF');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Simple clouds
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                for (let i = 0; i < 3; i++) {
                    const cloudX = (i * 200 + 50 - gameState.gameCamera.x * 0.1) % (canvas.width + 100);
                    const cloudY = 50 + i * 30;
                    ctx.beginPath();
                    ctx.arc(cloudX, cloudY, 20, 0, Math.PI * 2);
                    ctx.arc(cloudX + 25, cloudY, 25, 0, Math.PI * 2);
                    ctx.arc(cloudX + 50, cloudY, 20, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Calculate camera offset
                gameState.gameCamera.x = Math.max(0, gameState.player.x - canvas.width / 2);
                
                // Draw platforms
                gameState.platforms.forEach(platform => {
                    switch(platform.type) {
                        case 'ground':
                            ctx.fillStyle = '#8B4513';
                            break;
                        case 'platform':
                            ctx.fillStyle = '#228B22';
                            break;
                        case 'moving':
                            ctx.fillStyle = '#4169E1';
                            break;
                        default:
                            ctx.fillStyle = '#654321';
                    }
                    
                    ctx.fillRect(
                        platform.x - gameState.gameCamera.x,
                        platform.y,
                        platform.width,
                        platform.height
                    );
                    
                    // Add platform details
                    if (platform.type === 'ground') {
                        ctx.fillStyle = '#90EE90';
                        ctx.fillRect(
                            platform.x - gameState.gameCamera.x,
                            platform.y - 2,
                            platform.width,
                            2
                        );
                    }
                });
                
                // Draw coins with sparkle effect
                gameState.coins.forEach(coin => {
                    if (!coin.collected) {
                        const coinX = coin.x - gameState.gameCamera.x + coin.width/2;
                        const coinY = coin.y + coin.height/2;
                        
                        // Sparkle animation
                        const sparkle = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
                        ctx.globalAlpha = sparkle;
                        
                        // Coin body
                        ctx.fillStyle = '#FFD700';
                        ctx.beginPath();
                        ctx.arc(coinX, coinY, coin.width/2, 0, Math.PI * 2);
                        ctx.fill();
                        
                        // Coin highlight
                        ctx.fillStyle = '#FFFF99';
                        ctx.beginPath();
                        ctx.arc(coinX - 2, coinY - 2, coin.width/4, 0, Math.PI * 2);
                        ctx.fill();
                        
                        ctx.globalAlpha = 1;
                        
                        // Value indicator for bonus coins
                        if (coin.value > 100) {
                            ctx.fillStyle = '#FF6347';
                            ctx.font = '8px Arial';
                            ctx.textAlign = 'center';
                            ctx.fillText('★', coinX, coinY + 2);
                            ctx.textAlign = 'left';
                        }
                    }
                });
                
                // Draw enemies with simple AI visualization
                gameState.enemies.forEach(enemy => {
                    ctx.fillStyle = '#FF4444';
                    ctx.fillRect(
                        enemy.x - gameState.gameCamera.x,
                        enemy.y,
                        enemy.width,
                        enemy.height
                    );
                    
                    // Enemy eyes
                    ctx.fillStyle = '#FFFFFF';
                    const eyeSize = 2;
                    ctx.fillRect(
                        enemy.x - gameState.gameCamera.x + 2,
                        enemy.y + 2,
                        eyeSize,
                        eyeSize
                    );
                    ctx.fillRect(
                        enemy.x - gameState.gameCamera.x + enemy.width - 4,
                        enemy.y + 2,
                        eyeSize,
                        eyeSize
                    );
                    
                    // Direction indicator
                    ctx.fillStyle = '#FF0000';
                    const arrowX = enemy.x - gameState.gameCamera.x + (enemy.direction > 0 ? enemy.width : 0);
                    ctx.fillRect(arrowX, enemy.y + enemy.height/2, enemy.direction * 3, 1);
                });
                
                // Draw player with animation
                const playerX = gameState.player.x - gameState.gameCamera.x;
                const playerY = gameState.player.y;
                
                // Player body
                ctx.fillStyle = '#0066FF';
                ctx.fillRect(playerX, playerY, gameState.player.width, gameState.player.height);
                
                // Player face
                ctx.fillStyle = '#FFE4B5';
                ctx.fillRect(playerX + 2, playerY + 2, gameState.player.width - 4, gameState.player.height/3);
                
                // Player eyes
                ctx.fillStyle = '#000000';
                const eyeOffset = gameState.player.facingRight ? 2 : 0;
                ctx.fillRect(playerX + 4 + eyeOffset, playerY + 4, 2, 2);
                ctx.fillRect(playerX + 8 + eyeOffset, playerY + 4, 2, 2);
                
                // Movement animation (simple leg movement)
                if (Math.abs(gameState.player.velocityX) > 0.1) {
                    const legOffset = Math.sin(Date.now() * 0.02) * 2;
                    ctx.fillStyle = '#0066FF';
                    ctx.fillRect(playerX + 2, playerY + gameState.player.height, 4, 5 + legOffset);
                    ctx.fillRect(playerX + gameState.player.width - 6, playerY + gameState.player.height, 4, 5 - legOffset);
                }
                
                // Draw particles
                gameState.particles.forEach(particle => {
                    ctx.fillStyle = particle.color;
                    ctx.globalAlpha = particle.life / particle.maxLife;
                    ctx.fillRect(
                        particle.x - gameState.gameCamera.x,
                        particle.y,
                        particle.size,
                        particle.size
                    );
                    ctx.globalAlpha = 1;
                });
                
                // Draw UI
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, 50);
                ctx.fillStyle = '#FFFFFF';
                ctx.font = '16px Arial';
                ctx.fillText(`Score: ${gameState.score}`, 10, 20);
                ctx.fillText(`Lives: ${gameState.lives}`, 10, 35);
                ctx.fillText(`Level: ${gameState.level}`, 150, 20);

                // Show pause overlay
                if (gameState.paused) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
                    ctx.textAlign = 'left';
                }
            }

            function updatePlatformerGame(currentTime) {
                if (!gameState.running) return;

                if (gameState.paused) {
                    drawPlatformerGame();
                    gameState.animationId = requestAnimationFrame(updatePlatformerGame);
                    return;
                }

                // Handle continuous key presses
                if (gameState.keys['ArrowLeft'] || gameState.keys['a']) {
                    gameState.player.velocityX = -gameState.player.speed;
                    gameState.player.facingRight = false;
                }
                if (gameState.keys['ArrowRight'] || gameState.keys['d']) {
                    gameState.player.velocityX = gameState.player.speed;
                    gameState.player.facingRight = true;
                }
                
                // Apply gravity
                gameState.player.velocityY += gameState.gravity;
                
                // Update player position
                gameState.player.x += gameState.player.velocityX;
                gameState.player.y += gameState.player.velocityY;
                
                // Platform collision detection
                gameState.player.onGround = false;
                gameState.platforms.forEach(platform => {
                    if (gameState.player.x < platform.x + platform.width &&
                        gameState.player.x + gameState.player.width > platform.x &&
                        gameState.player.y < platform.y + platform.height &&
                        gameState.player.y + gameState.player.height > platform.y) {
                        
                        // Landing on top of platform
                        if (gameState.player.velocityY > 0 && gameState.player.y < platform.y) {
                            gameState.player.y = platform.y - gameState.player.height;
                            gameState.player.velocityY = 0;
                            gameState.player.onGround = true;
                        }
                        // Hitting platform from below
                        else if (gameState.player.velocityY < 0 && gameState.player.y > platform.y) {
                            gameState.player.y = platform.y + platform.height;
                            gameState.player.velocityY = 0;
                        }
                        // Side collisions
                        else if (gameState.player.velocityX > 0) {
                            gameState.player.x = platform.x - gameState.player.width;
                            gameState.player.velocityX = 0;
                        }
                        else if (gameState.player.velocityX < 0) {
                            gameState.player.x = platform.x + platform.width;
                            gameState.player.velocityX = 0;
                        }
                    }
                });
                
                // Update enemies
                gameState.enemies.forEach(enemy => {
                    enemy.x += enemy.velocityX;
                    
                    // Simple AI: reverse direction at platform edges or walls
                    const platform = gameState.platforms.find(p => 
                        enemy.x >= p.x - 20 && enemy.x <= p.x + p.width + 20 && 
                        Math.abs(enemy.y + enemy.height - p.y) < 10
                    );
                    
                    if (platform) {
                        if (enemy.x <= platform.x + 5 || enemy.x >= platform.x + platform.width - enemy.width - 5) {
                            enemy.velocityX *= -1;
                            enemy.direction *= -1;
                        }
                    }
                    
                    // Keep enemies on platforms
                    if (!platform) {
                        enemy.velocityX *= -1;
                        enemy.direction *= -1;
                    }
                });
                
                // Coin collection
                gameState.coins.forEach(coin => {
                    if (!coin.collected &&
                        gameState.player.x < coin.x + coin.width &&
                        gameState.player.x + gameState.player.width > coin.x &&
                        gameState.player.y < coin.y + coin.height &&
                        gameState.player.y + gameState.player.height > coin.y) {
                        
                        coin.collected = true;
                        gameState.score += coin.value;
                        
                        // Create coin collection particles
                        for (let i = 0; i < 5; i++) {
                            gameState.particles.push(createParticle(
                                coin.x + coin.width/2,
                                coin.y + coin.height/2,
                                '#FFD700',
                                0, -2
                            ));
                        }
                        
                        playSound('score');
                    }
                });
                
                // Enemy collision
                gameState.enemies.forEach((enemy, index) => {
                    if (gameState.player.x < enemy.x + enemy.width &&
                        gameState.player.x + gameState.player.width > enemy.x &&
                        gameState.player.y < enemy.y + enemy.height &&
                        gameState.player.y + gameState.player.height > enemy.y) {
                        
                        // Check if player is jumping on enemy
                        if (gameState.player.velocityY > 0 && gameState.player.y < enemy.y) {
                            // Destroy enemy
                            gameState.enemies.splice(index, 1);
                            gameState.score += 200;
                            gameState.player.velocityY = -8; // Bounce
                            
                            // Create destruction particles
                            for (let i = 0; i < 8; i++) {
                                gameState.particles.push(createParticle(
                                    enemy.x + enemy.width/2,
                                    enemy.y + enemy.height/2,
                                    '#FF4444'
                                ));
                            }
                            
                            playSound('score');
                        } else {
                            // Player takes damage
                            gameState.lives--;
                            gameState.player.x = 50;
                            gameState.player.y = canvas.height - 100;
                            gameState.player.velocityX = 0;
                            gameState.player.velocityY = 0;
                            
                            // Create damage particles
                            for (let i = 0; i < 6; i++) {
                                gameState.particles.push(createParticle(
                                    gameState.player.x + gameState.player.width/2,
                                    gameState.player.y + gameState.player.height/2,
                                    '#FF0000'
                                ));
                            }
                            
                            playSound('gameOver');
                            
                            if (gameState.lives <= 0) {
                                gameOver();
                                return;
                            }
                        }
                    }
                });
                
                // Update particles
                gameState.particles = gameState.particles.filter(particle => {
                    particle.x += particle.velocityX;
                    particle.y += particle.velocityY;
                    particle.velocityX *= 0.98;
                    particle.velocityY += 0.1; // Gravity
                    particle.life--;
                    return particle.life > 0;
                });
                
                // Check if player falls off screen
                if (gameState.player.y > canvas.height + 50) {
                    gameState.lives--;
                    gameState.player.x = 50;
                    gameState.player.y = canvas.height - 100;
                    gameState.player.velocityX = 0;
                    gameState.player.velocityY = 0;
                    
                    if (gameState.lives <= 0) {
                        gameOver();
                        return;
                    }
                }
                
                // Check level completion (all coins collected)
                if (gameState.coins.every(coin => coin.collected)) {
                    gameState.level++;
                    gameState.coins = createCoins();
                    gameState.enemies = createEnemies();
                    gameState.player.x = 50;
                    gameState.player.y = canvas.height - 100;
                    gameState.player.velocityX = 0;
                    gameState.player.velocityY = 0;
                    showNotification(`Level ${gameState.level}!`, 'success');
                    playSound('lineClear');
                }
                
                // Apply friction
                gameState.player.velocityX *= 0.8;
                
                // Update score display
                if (scoreDisplay) {
                    const totalCoins = gameState.coins.length;
                    const collectedCoins = gameState.coins.filter(c => c.collected).length;
                    scoreDisplay.textContent = `Score: ${gameState.score} | Lives: ${gameState.lives} | Coins: ${collectedCoins}/${totalCoins}`;
                }
                
                drawPlatformerGame();
                gameState.animationId = requestAnimationFrame(updatePlatformerGame);
            }

            function gameOver() {
                gameState.running = false;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#FFFFFF';
                ctx.font = '24px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Game Over!', canvas.width / 2, canvas.height / 2 - 20);
                ctx.fillText(`Final Score: ${gameState.score}`, canvas.width / 2, canvas.height / 2 + 10);
                ctx.fillText(`Level Reached: ${gameState.level}`, canvas.width / 2, canvas.height / 2 + 40);
                ctx.font = '14px Arial';
                ctx.fillText('Click Stop and Play again to restart', canvas.width / 2, canvas.height / 2 + 70);
                ctx.textAlign = 'left';
            }

            // Enhanced keyboard handling
            window.currentGameKeyHandler = (e) => {
                if (!gameState.running) return;

                // Prevent default scrolling
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd'].includes(e.key)) {
                    e.preventDefault();
                }

                gameState.keys[e.key] = true;

                // Jump handling
                if ((e.key === 'ArrowUp' || e.key === ' ' || e.key === 'w') && gameState.player.onGround) {
                    gameState.player.velocityY = -gameState.player.jumpPower;
                    playSound('move');
                }
            };

            const keyUpHandler = (e) => {
                gameState.keys[e.key] = false;
            };

            document.addEventListener('keydown', window.currentGameKeyHandler);
            document.addEventListener('keyup', keyUpHandler);
            gameState.keyUpHandler = keyUpHandler;

            if (scoreDisplay) {
                scoreDisplay.textContent = `Score: 0 | Lives: 3 | Coins: 0/${gameState.coins.length}`;
            }

            drawPlatformerGame();
            updatePlatformerGame();
        }

        // Simple stubs for unimplemented types - now removed since all games are implemented
        function initializeDefaultPreview(canvas, ctx, gameId, scoreDisplay) {
            const gameState = {
                running: true,
                paused: false,
                score: 0,
                player: { x: 50, y: 50 },
                keys: {}
            };

            gamePreviewStates[gameId] = gameState;

            function drawDefaultGame() {
                // Clear canvas with gradient background
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#1F2937');
                gradient.addColorStop(1, '#374151');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw player as a blue square
                ctx.fillStyle = '#3B82F6';
                ctx.fillRect(gameState.player.x, gameState.player.y, 20, 20);
                
                // Draw some decorative elements
                ctx.fillStyle = '#8B5CF6';
                for (let i = 0; i < 5; i++) {
                    ctx.fillRect(i * 100 + 80, canvas.height - 40, 20, 20);
                }
                
                // Game info
                ctx.fillStyle = '#FFFFFF';
                ctx.font = '16px Arial';
                ctx.fillText('Demo Game - Use arrow keys to move', 10, 25);
                ctx.fillText(`Score: ${gameState.score}`, 10, 45);
                ctx.fillText('This is a basic movement demo', 10, canvas.height - 20);

                // Show pause overlay
                if (gameState.paused) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
                    ctx.textAlign = 'left';
                }
            }

            function updateDefaultGame() {
                if (!gameState.running) return;

                if (!gameState.paused) {
                    // Handle movement
                    if (gameState.keys['ArrowLeft']) {
                        gameState.player.x = Math.max(0, gameState.player.x - 3);
                        gameState.score++;
                    }
                    if (gameState.keys['ArrowRight']) {
                        gameState.player.x = Math.min(canvas.width - 20, gameState.player.x + 3);
                        gameState.score++;
                    }
                    if (gameState.keys['ArrowUp']) {
                        gameState.player.y = Math.max(0, gameState.player.y - 3);
                        gameState.score++;
                    }
                    if (gameState.keys['ArrowDown']) {
                        gameState.player.y = Math.min(canvas.height - 20, gameState.player.y + 3);
                        gameState.score++;
                    }

                    // Update score display
                    if (scoreDisplay) {
                        scoreDisplay.textContent = `Score: ${gameState.score} | Movement Demo`;
                    }
                }

                drawDefaultGame();
                gameState.animationId = requestAnimationFrame(updateDefaultGame);
            }

            window.currentGameKeyHandler = (e) => {
                if (!gameState.running) return;
                
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                }
                
                gameState.keys[e.key] = true;
                playSound('move');
            };

            const keyUpHandler = (e) => {
                gameState.keys[e.key] = false;
            };

            document.addEventListener('keydown', window.currentGameKeyHandler);
            document.addEventListener('keyup', keyUpHandler);
            gameState.keyUpHandler = keyUpHandler;

            if (scoreDisplay) {
                scoreDisplay.textContent = 'Score: 0 | Movement Demo';
            }

            drawDefaultGame();
            updateDefaultGame();
        }        // Enhanced Chess Preview Game Implementation
        function initializeChessPreview(canvas, ctx, gameId, scoreDisplay) {
            const gameState = {
                running: true,
                paused: false,
                currentPlayer: 'white',
                selectedSquare: null,
                selectedPiece: null,
                gameBoard: createChessBoard(),
                squareSize: Math.min(canvas.width, canvas.height) / 8,
                moveHistory: [],
                gameStatus: 'playing',
                whiteKingPos: { row: 7, col: 4 },
                blackKingPos: { row: 0, col: 4 }
            };

            gamePreviewStates[gameId] = gameState;

            function createChessBoard() {
                const board = Array(8).fill(null).map(() => Array(8).fill(null));
                
                // Place pieces
                const pieces = {
                    'r': 'rook', 'n': 'knight', 'b': 'bishop', 'q': 'queen', 
                    'k': 'king', 'p': 'pawn'
                };
                
                // Black pieces (top)
                const blackSetup = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
                for (let i = 0; i < 8; i++) {
                    board[0][i] = { type: pieces[blackSetup[i]], color: 'black' };
                    board[1][i] = { type: 'pawn', color: 'black' };
                }
                
                // White pieces (bottom)
                const whiteSetup = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
                for (let i = 0; i < 8; i++) {
                    board[7][i] = { type: pieces[whiteSetup[i]], color: 'white' };
                    board[6][i] = { type: 'pawn', color: 'white' };
                }
                
                return board;
            }

            function drawChessBoard() {
                if (!gameState.running) return;

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Draw board squares
                for (let row = 0; row < 8; row++) {
                    for (let col = 0; col < 8; col++) {
                        const isLight = (row + col) % 2 === 0;
                        ctx.fillStyle = isLight ? '#F0D9B5' : '#B58863';
                        
                        // Highlight selected square
                        if (gameState.selectedSquare && gameState.selectedSquare.row === row && gameState.selectedSquare.col === col) {
                            ctx.fillStyle = '#FFD700';
                        }
                        
                        ctx.fillRect(col * gameState.squareSize, row * gameState.squareSize, gameState.squareSize, gameState.squareSize);
                        
                        // Draw piece
                        const piece = gameState.gameBoard[row][col];
                        if (piece) {
                            drawChessPiece(ctx, piece, col * gameState.squareSize, row * gameState.squareSize, gameState.squareSize);
                        }
                    }
                }
                
                // Draw game info
                ctx.fillStyle = '#000000';
                ctx.font = '14px Arial';
                ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(`${gameState.currentPlayer.toUpperCase()}'s turn - ${gameState.gameStatus}`, 10, canvas.height - 10);

                // Show pause overlay
                if (gameState.paused) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
                    ctx.textAlign = 'left';
                }
            }

            function drawChessPiece(ctx, piece, x, y, size) {
                // Use simple geometric shapes instead of Unicode symbols for better compatibility
                ctx.fillStyle = piece.color === 'white' ? '#FFFFFF' : '#000000';
                ctx.strokeStyle = piece.color === 'white' ? '#000000' : '#FFFFFF';
                ctx.lineWidth = 2;
                
                const centerX = x + size/2;
                const centerY = y + size/2;
                const pieceSize = size * 0.6;
                
                switch(piece.type) {
                    case 'king':
                        // Draw crown shape
                        ctx.fillRect(centerX - pieceSize/3, centerY - pieceSize/4, pieceSize * 2/3, pieceSize/2);
                        ctx.strokeRect(centerX - pieceSize/3, centerY - pieceSize/4, pieceSize * 2/3, pieceSize/2);
                        // Crown points
                        for (let i = 0; i < 3; i++) {
                            const px = centerX - pieceSize/4 + (i * pieceSize/4);
                            ctx.fillRect(px - 2, centerY - pieceSize/2, 4, pieceSize/4);
                        }
                        break;
                    case 'queen':
                        // Draw tall shape with multiple points
                        ctx.fillRect(centerX - pieceSize/4, centerY - pieceSize/3, pieceSize/2, pieceSize * 2/3);
                        ctx.strokeRect(centerX - pieceSize/4, centerY - pieceSize/3, pieceSize/2, pieceSize * 2/3);
                        // Multiple crown points
                        for (let i = 0; i < 5; i++) {
                            const px = centerX - pieceSize/3 + (i * pieceSize/6);
                            const height = i % 2 === 0 ? pieceSize/3 : pieceSize/4;
                            ctx.fillRect(px - 1, centerY - pieceSize/2, 2, height);
                        }
                        break;
                    case 'rook':
                        // Draw castle battlement
                        ctx.fillRect(centerX - pieceSize/3, centerY - pieceSize/4, pieceSize * 2/3, pieceSize/2);
                        ctx.strokeRect(centerX - pieceSize/3, centerY - pieceSize/4, pieceSize * 2/3, pieceSize/2);
                        // Battlements
                        for (let i = 0; i < 3; i++) {
                            const px = centerX - pieceSize/4 + (i * pieceSize/4);
                            ctx.clearRect(px - 2, centerY - pieceSize/2, 4, pieceSize/6);
                        }
                        break;
                    case 'bishop':
                        // Draw pointed hat shape
                        ctx.beginPath();
                        ctx.moveTo(centerX, centerY - pieceSize/2);
                        ctx.lineTo(centerX - pieceSize/4, centerY + pieceSize/4);
                        ctx.lineTo(centerX + pieceSize/4, centerY + pieceSize/4);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                        // Small circle at top
                        ctx.beginPath();
                        ctx.arc(centerX, centerY - pieceSize/3, 3, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    case 'knight':
                        // Draw horse head shape
                        ctx.beginPath();
                        ctx.moveTo(centerX - pieceSize/4, centerY + pieceSize/4);
                        ctx.lineTo(centerX - pieceSize/6, centerY - pieceSize/4);
                        ctx.lineTo(centerX + pieceSize/6, centerY - pieceSize/6);
                        ctx.lineTo(centerX + pieceSize/4, centerY);
                        ctx.lineTo(centerX + pieceSize/6, centerY + pieceSize/4);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                        break;
                    case 'pawn':
                        // Draw simple circle on base
                        ctx.beginPath();
                        ctx.arc(centerX, centerY - pieceSize/6, pieceSize/4, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillRect(centerX - pieceSize/4, centerY + pieceSize/6, pieceSize/2, pieceSize/8);
                        ctx.strokeRect(centerX - pieceSize/4, centerY + pieceSize/6, pieceSize/2, pieceSize/8);
                        break;
                }
                
                // Add piece type label for clarity
                ctx.fillStyle = piece.color === 'white' ? '#000000' : '#FFFFFF';
                ctx.font = '8px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(piece.type.charAt(0).toUpperCase(), centerX, y + size - 3);
                ctx.textAlign = 'left';
            }

            function isValidMove(fromRow, fromCol, toRow, toCol) {
                const piece = gameState.gameBoard[fromRow][fromCol];
                const targetPiece = gameState.gameBoard[toRow][toCol];
                
                if (!piece || piece.color !== gameState.currentPlayer) return false;
                if (targetPiece && targetPiece.color === piece.color) return false;
                
                const rowDiff = toRow - fromRow;
                const colDiff = toCol - fromCol;
                const absRowDiff = Math.abs(rowDiff);
                const absColDiff = Math.abs(colDiff);
                
                switch (piece.type) {
                    case 'pawn':
                        const direction = piece.color === 'white' ? -1 : 1;
                        if (colDiff === 0) {
                            if (rowDiff === direction && !targetPiece) return true;
                            if (rowDiff === 2 * direction && !targetPiece && 
                                ((piece.color === 'white' && fromRow === 6) || 
                                 (piece.color === 'black' && fromRow === 1))) return true;
                        } else if (absColDiff === 1 && rowDiff === direction && targetPiece) {
                            return true;
                        }
                        return false;
                        
                    case 'rook':
                        return (rowDiff === 0 || colDiff === 0) && isPathClear(fromRow, fromCol, toRow, toCol);
                        
                    case 'bishop':
                        return absRowDiff === absColDiff && isPathClear(fromRow, fromCol, toRow, toCol);
                        
                    case 'queen':
                        return (rowDiff === 0 || colDiff === 0 || absRowDiff === absColDiff) && 
                               isPathClear(fromRow, fromCol, toRow, toCol);
                        
                    case 'king':
                        return absRowDiff <= 1 && absColDiff <= 1;
                        
                    case 'knight':
                        return (absRowDiff === 2 && absColDiff === 1) || (absRowDiff === 1 && absColDiff === 2);
                }
                
                return false;
            }

            function isPathClear(fromRow, fromCol, toRow, toCol) {
                const rowStep = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
                const colStep = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;
                
                let currentRow = fromRow + rowStep;
                let currentCol = fromCol + colStep;
                
                while (currentRow !== toRow || currentCol !== toCol) {
                    if (gameState.gameBoard[currentRow][currentCol]) return false;
                    currentRow += rowStep;
                    currentCol += colStep;
                }
                
                return true;
            }

            function makeMove(fromRow, fromCol, toRow, toCol) {
                const piece = gameState.gameBoard[fromRow][fromCol];
                const capturedPiece = gameState.gameBoard[toRow][toCol];
                
                gameState.moveHistory.push({
                    from: { row: fromRow, col: fromCol },
                    to: { row: toRow, col: toCol },
                    piece: piece,
                    captured: capturedPiece
                });
                
                gameState.gameBoard[toRow][toCol] = piece;
                gameState.gameBoard[fromRow][fromCol] = null;
                
                // Update king positions
                if (piece.type === 'king') {
                    if (piece.color === 'white') {
                        gameState.whiteKingPos = { row: toRow, col: toCol };
                    } else {
                        gameState.blackKingPos = { row: toRow, col: toCol };
                    }
                }
                
                gameState.currentPlayer = gameState.currentPlayer === 'white' ? 'black' : 'white';
                
                if (capturedPiece) {
                    playSound('score');
                } else {
                    playSound('move');
                }
                
                if (scoreDisplay) {
                    scoreDisplay.textContent = `Move ${gameState.moveHistory.length} | ${gameState.currentPlayer}'s turn`;
                }
            }

            // Handle mouse clicks
            function handleChessClick(event) {
                if (!gameState.running || gameState.paused) return;
                
                const rect = canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                
                const col = Math.floor(x / gameState.squareSize);
                const row = Math.floor(y / gameState.squareSize);
                
                if (row < 0 || row >= 8 || col < 0 || col >= 8) return;
                
                if (gameState.selectedSquare) {
                    if (isValidMove(gameState.selectedSquare.row, gameState.selectedSquare.col, row, col)) {
                        makeMove(gameState.selectedSquare.row, gameState.selectedSquare.col, row, col);
                    }
                    gameState.selectedSquare = null;
                    gameState.selectedPiece = null;
                } else {
                    const piece = gameState.gameBoard[row][col];
                    if (piece && piece.color === gameState.currentPlayer) {
                        gameState.selectedSquare = { row, col };
                        gameState.selectedPiece = piece;
                    }
                }
                
                drawChessBoard();
            }

            // Event handlers
            window.currentGameKeyHandler = (e) => {
                // Chess uses mouse input primarily
            };

            const clickHandler = handleChessClick;
            canvas.addEventListener('click', clickHandler);
            gameState.clickHandler = clickHandler;

            document.addEventListener('keydown', window.currentGameKeyHandler);

            if (scoreDisplay) {
                scoreDisplay.textContent = `Move 0 | White's turn`;
            }

            drawChessBoard();
        }

        // Enhanced Pacman Preview Game Implementation
        function initializePacmanPreview(canvas, ctx, gameId, scoreDisplay) {
            const gameState = {
                running: true,
                paused: false,
                score: 0,
                lives: 3,
                level: 1,
                cellSize: 20,
                cols: Math.floor(canvas.width / 20),
                rows: Math.floor(canvas.height / 20),
                player: {
                    x: 1,
                    y: 1,
                    direction: { x: 0, y: 0 },
                    nextDirection: { x: 0, y: 0 },
                    mouthOpen: true,
                    mouthTimer: 0
                },
                ghosts: [],
                maze: [],
                dots: [],
                powerPellets: [],
                powerMode: false,
                powerModeTimer: 0,
                lastMoveTime: 0,
                moveSpeed: 150
            };

            gamePreviewStates[gameId] = gameState;

            function createMaze() {
                const maze = Array(gameState.rows).fill(null).map(() => Array(gameState.cols).fill(0));
                
                // Create border walls
                for (let y = 0; y < gameState.rows; y++) {
                    for (let x = 0; x < gameState.cols; x++) {
                        if (x === 0 || x === gameState.cols - 1 || y === 0 || y === gameState.rows - 1) {
                            maze[y][x] = 1;
                        }
                        // Create internal maze pattern
                        else if (x % 4 === 0 && y % 4 === 0 && Math.random() > 0.4) {
                            maze[y][x] = 1;
                            if (x + 1 < gameState.cols - 1) maze[y][x + 1] = 1;
                            if (y + 1 < gameState.rows - 1) maze[y + 1][x] = 1;
                        }
                    }
                }
                
                // Ensure player starting area is clear
                maze[1][1] = 0;
                maze[1][2] = 0;
                maze[2][1] = 0;
                
                return maze;
            }

            function createDots() {
                const dots = [];
                for (let y = 1; y < gameState.rows - 1; y++) {
                    for (let x = 1; x < gameState.cols - 1; x++) {
                        if (gameState.maze[y][x] === 0 && !(x === 1 && y === 1)) {
                            dots.push({ x, y });
                        }
                    }
                }
                return dots;
            }

            function createPowerPellets() {
                const pellets = [];
                const corners = [
                    { x: 2, y: 2 },
                    { x: gameState.cols - 3, y: 2 },
                    { x: 2, y: gameState.rows - 3 },
                    { x: gameState.cols - 3, y: gameState.rows - 3 }
                ];
                
                corners.forEach(corner => {
                    if (corner.x > 0 && corner.x < gameState.cols && 
                        corner.y > 0 && corner.y < gameState.rows &&
                        gameState.maze[corner.y][corner.x] === 0) {
                        pellets.push(corner);
                    }
                });
                
                return pellets;
            }

            function createGhosts() {
                const centerX = Math.floor(gameState.cols / 2);
                const centerY = Math.floor(gameState.rows / 2);
                
                return [
                    { x: centerX, y: centerY, direction: { x: 1, y: 0 }, color: '#FF0000', mode: 'chase' },
                    { x: centerX, y: centerY, direction: { x: -1, y: 0 }, color: '#FFB6FF', mode: 'scatter' },
                    { x: centerX, y: centerY, direction: { x: 0, y: 1 }, color: '#00FFFF', mode: 'chase' },
                    { x: centerX, y: centerY, direction: { x: 0, y: -1 }, color: '#FFB852', mode: 'scatter' }
                ];
            }

            // Initialize game objects
            gameState.maze = createMaze();
            gameState.dots = createDots();
            gameState.powerPellets = createPowerPellets();
            gameState.ghosts = createGhosts();

            function drawPacmanGame() {
                if (!gameState.running) return;

                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw maze
                ctx.fillStyle = '#0000FF';
                for (let y = 0; y < gameState.rows; y++) {
                    for (let x = 0; x < gameState.cols; x++) {
                        if (gameState.maze[y][x] === 1) {
                            ctx.fillRect(x * gameState.cellSize, y * gameState.cellSize, 
                                       gameState.cellSize, gameState.cellSize);
                        }
                    }
                }
                
                // Draw dots
                ctx.fillStyle = '#FFFF00';
                gameState.dots.forEach(dot => {
                    ctx.beginPath();
                    ctx.arc(
                        dot.x * gameState.cellSize + gameState.cellSize/2, 
                        dot.y * gameState.cellSize + gameState.cellSize/2, 
                        2, 0, Math.PI * 2
                    );
                    ctx.fill();
                });
                
                // Draw power pellets
                ctx.fillStyle = '#FFFFFF';
                gameState.powerPellets.forEach(pellet => {
                    const pulseSize = Math.sin(Date.now() * 0.01) * 2 + 6;
                    ctx.beginPath();
                    ctx.arc(
                        pellet.x * gameState.cellSize + gameState.cellSize/2, 
                        pellet.y * gameState.cellSize + gameState.cellSize/2, 
                        pulseSize, 0, Math.PI * 2
                    );
                    ctx.fill();
                });
                
                // Draw player (Pacman)
                ctx.fillStyle = '#FFFF00';
                const px = gameState.player.x * gameState.cellSize + gameState.cellSize/2;
                const py = gameState.player.y * gameState.cellSize + gameState.cellSize/2;
                const radius = gameState.cellSize/2 - 2;
                
                if (gameState.player.mouthOpen) {
                    // Draw Pacman with mouth
                    const angle = Math.atan2(gameState.player.direction.y, gameState.player.direction.x);
                    ctx.beginPath();
                    ctx.arc(px, py, radius, angle + 0.2, angle - 0.2);
                    ctx.lineTo(px, py);
                    ctx.fill();
                } else {
                    // Draw closed circle
                    ctx.beginPath();
                    ctx.arc(px, py, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
                
                // Draw ghosts
                gameState.ghosts.forEach(ghost => {
                    ctx.fillStyle = gameState.powerMode ? '#0000FF' : ghost.color;
                    const gx = ghost.x * gameState.cellSize + 2;
                    const gy = ghost.y * gameState.cellSize + 2;
                    const gsize = gameState.cellSize - 4;
                    
                    // Ghost body
                    ctx.fillRect(gx, gy, gsize, gsize);
                    
                    // Ghost eyes
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(gx + 4, gy + 4, 3, 3);
                    ctx.fillRect(gx + gsize - 7, gy + 4, 3, 3);
                    
                    // Eye pupils
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(gx + 5, gy + 5, 1, 1);
                    ctx.fillRect(gx + gsize - 6, gy + 5, 1, 1);
                });
                
                // Draw UI
                ctx.fillStyle = '#FFFFFF';
                ctx.font = '14px Arial';
                ctx.fillText(`Score: ${gameState.score}`, 5, 15);
                ctx.fillText(`Lives: ${gameState.lives}`, 5, 30);
                ctx.fillText(`Level: ${gameState.level}`, 5, 45);

                // Show pause overlay
                if (gameState.paused) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
                    ctx.textAlign = 'left';
                }
            }

            function canMoveTo(x, y) {
                return x >= 0 && x < gameState.cols && y >= 0 && y < gameState.rows && 
                       gameState.maze[y][x] === 0;
            }

            function updatePacmanGame() {
                if (!gameState.running) return;

                const currentTime = Date.now();
                
                if (gameState.paused) {
                    drawPacmanGame();
                    gameState.animationId = requestAnimationFrame(updatePacmanGame);
                    return;
                }

                // Animate mouth
                gameState.player.mouthTimer++;
                if (gameState.player.mouthTimer > 10) {
                    gameState.player.mouthOpen = !gameState.player.mouthOpen;
                    gameState.player.mouthTimer = 0;
                }
                
                // Move player
                if (currentTime - gameState.lastMoveTime > gameState.moveSpeed) {
                    gameState.lastMoveTime = currentTime;
                    
                    // Try to change direction
                    if (canMoveTo(gameState.player.x + gameState.player.nextDirection.x, 
                                  gameState.player.y + gameState.player.nextDirection.y)) {
                        gameState.player.direction = { ...gameState.player.nextDirection };
                    }
                    
                    // Move in current direction
                    if (canMoveTo(gameState.player.x + gameState.player.direction.x, 
                                  gameState.player.y + gameState.player.direction.y)) {
                        gameState.player.x += gameState.player.direction.x;
                        gameState.player.y += gameState.player.direction.y;
                    }
                }
                
                // Check dot collection
                const dotIndex = gameState.dots.findIndex(dot => 
                    dot.x === gameState.player.x && dot.y === gameState.player.y);
                if (dotIndex !== -1) {
                    gameState.dots.splice(dotIndex, 1);
                    gameState.score += 10;
                    playSound('score');
                }
                
                // Check power pellet collection
                const pelletIndex = gameState.powerPellets.findIndex(pellet => 
                    pellet.x === gameState.player.x && pellet.y === gameState.player.y);
                if (pelletIndex !== -1) {
                    gameState.powerPellets.splice(pelletIndex, 1);
                    gameState.score += 50;
                    gameState.powerMode = true;
                    gameState.powerModeTimer = 300; // ~5 seconds
                    playSound('lineClear');
                }
                
                // Update power mode
                if (gameState.powerMode) {
                    gameState.powerModeTimer--;
                    if (gameState.powerModeTimer <= 0) {
                        gameState.powerMode = false;
                    }
                }
                
                // Update ghosts
                gameState.ghosts.forEach(ghost => {
                    if (Math.random() < 0.1) {
                        const directions = [
                            { x: 0, y: -1 }, { x: 1, y: 0 }, 
                            { x: 0, y: 1 }, { x: -1, y: 0 }
                        ];
                        const validDirections = directions.filter(dir => 
                            canMoveTo(ghost.x + dir.x, ghost.y + dir.y));
                        
                        if (validDirections.length > 0) {
                            ghost.direction = validDirections[Math.floor(Math.random() * validDirections.length)];
                        }
                    }
                    
                    if (canMoveTo(ghost.x + ghost.direction.x, ghost.y + ghost.direction.y)) {
                        ghost.x += ghost.direction.x;
                        ghost.y += ghost.direction.y;
                    } else {
                        ghost.direction.x *= -1;
                        ghost.direction.y *= -1;
                    }
                });
                
                // Check ghost collisions
                gameState.ghosts.forEach(ghost => {
                    if (ghost.x === gameState.player.x && ghost.y === gameState.player.y) {
                        if (gameState.powerMode) {
                            gameState.score += 200;
                            ghost.x = Math.floor(gameState.cols/2);
                            ghost.y = Math.floor(gameState.rows/2);
                            playSound('score');
                        } else {
                            gameState.lives--;
                            gameState.player.x = 1;
                            gameState.player.y = 1;
                            gameState.player.direction = { x: 0, y: 0 };
                            playSound('gameOver');
                            
                            if (gameState.lives <= 0) {
                                gameOver();
                                return;
                            }
                        }
                    }
                });
                
                // Check win condition
                if (gameState.dots.length === 0) {
                    gameState.level++;
                    gameState.maze = createMaze();
                    gameState.dots = createDots();
                    gameState.powerPellets = createPowerPellets();
                    gameState.player.x = 1;
                    gameState.player.y = 1;
                    gameState.player.direction = { x: 0, y: 0 };
                    gameState.moveSpeed = Math.max(100, gameState.moveSpeed - 10);
                    playSound('lineClear');
                }
                
                if (scoreDisplay) {
                    scoreDisplay.textContent = `Score: ${gameState.score} | Lives: ${gameState.lives} | Level: ${gameState.level}`;
                }
                
                drawPacmanGame();
                gameState.animationId = requestAnimationFrame(updatePacmanGame);
            }

            function gameOver() {
                gameState.running = false;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#FFFFFF';
                ctx.font = '24px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Game Over!', canvas.width / 2, canvas.height / 2 - 20);
                ctx.fillText(`Final Score: ${gameState.score}`, canvas.width / 2, canvas.height / 2 + 10);
                ctx.fillText(`Level Reached: ${gameState.level}`, canvas.width / 2, canvas.height / 2 + 40);
                ctx.font = '14px Arial';
                ctx.fillText('Click Stop and Play again to restart', canvas.width / 2, canvas.height / 2 + 70);
                ctx.textAlign = 'left';
            }

            window.currentGameKeyHandler = (e) => {
                if (!gameState.running || gameState.paused) return;
                
                // Prevent default for arrow keys
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                }
                
                switch(e.key) {
                    case 'ArrowUp': 
                        gameState.player.nextDirection = { x: 0, y: -1 }; 
                        break;
                    case 'ArrowDown': 
                        gameState.player.nextDirection = { x: 0, y: 1 }; 
                        break;
                    case 'ArrowLeft': 
                        gameState.player.nextDirection = { x: -1, y: 0 }; 
                        break;
                    case 'ArrowRight': 
                        gameState.player.nextDirection = { x: 1, y: 0 }; 
                        break;
                }
                playSound('move');
            };

            document.addEventListener('keydown', window.currentGameKeyHandler);

            if (scoreDisplay) {
                scoreDisplay.textContent = `Score: 0 | Lives: 3 | Level: 1`;
            }

            drawPacmanGame();
            updatePacmanGame();
        }
        // Public API
    return {
        initializeGamePreview,
        stopGamePreview,
        updateGameStats
    };


const gamePlayer = new GamePlayer();

// Game Player Logic
const gamePlayerLogic = {   
    /**
     * Update game statistics
     * @param {string} gameId - The ID of the game
     * @param {object} statsUpdate - An object with stats to update (e.g., { plays: 1, wins: 0 })
     */
    updateGameStats(gameId, statsUpdate) {
        const statsKey = `gameStats_${gameId}`;
        let currentStats = localStorage.getItem(statsKey);
        let newStats = { plays: 0, wins: 0, losses: 0, highScore: 0 };

        if (currentStats) {
            try {
                newStats = JSON.parse(currentStats);
            } catch (e) {
                console.error('Error parsing game stats from localStorage:', e);
            }
        }

        // Update stats based on provided updates
        if (statsUpdate.plays) newStats.plays += statsUpdate.plays;
        if (statsUpdate.wins) newStats.wins += statsUpdate.wins;
        if (statsUpdate.losses) newStats.losses += statsUpdate.losses;
        if (statsUpdate.highScore && statsUpdate.highScore > newStats.highScore) {
            newStats.highScore = statsUpdate.highScore;
        }

        localStorage.setItem(statsKey, JSON.stringify(newStats));
    }
};