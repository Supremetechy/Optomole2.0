/**
 * Demo Script - Demonstrates GameDuplicator functionality
 */

class GameDuplicatorDemo {
    constructor() {
        this.demoProjects = [
            {
                name: 'Super Platform Adventure',
                originalGame: 'Epic Adventure',
                engine: 'unity',
                status: 'completed',
                customizations: {
                    playerSpeed: 8,
                    jumpHeight: 15,
                    colorScheme: 'blue-purple',
                    musicStyle: 'electronic'
                }
            },
            {
                name: 'Mind Puzzle Deluxe',
                originalGame: 'Mind Bender',
                engine: 'html5',
                status: 'building',
                customizations: {
                    difficulty: 7,
                    artStyle: 'minimalist',
                    uiTheme: 'modern'
                }
            },
            {
                name: 'Kingdom Strategy Wars',
                originalGame: 'Kingdom Wars',
                engine: 'phaser',
                status: 'draft',
                customizations: {
                    enemyBehavior: 'aggressive',
                    mapSize: 'large',
                    playerCount: 4
                }
            }
        ];
    }

    /**
     * Initialize demo with sample projects
     */
    async initializeDemo() {
        console.log('🎮 Initializing GameDuplicator Demo...');
        
        // Wait for components to be ready
        await this.waitForComponents();
        
        // Create demo projects
        this.createDemoProjects();
        
        // Add demo features
        this.addDemoFeatures();
        
        console.log('✅ Demo initialized successfully!');
        
        // Show welcome message
        this.showWelcomeMessage();
    }

    /**
     * Wait for all components to be loaded
     */
    async waitForComponents() {
        return new Promise((resolve) => {
            const checkComponents = () => {
                if (window.GameAnalyzer && 
                    window.GameGenerator && 
                    window.CustomizationPanel && 
                    window.EngineAdapters && 
                    window.ProjectManager) {
                    resolve();
                } else {
                    setTimeout(checkComponents, 100);
                }
            };
            checkComponents();
        });
    }

    /**
     * Create demo projects in the project manager
     */
    createDemoProjects() {
        if (!window.projectManager) return;

        this.demoProjects.forEach((demoProject, index) => {
            const analysisData = this.generateMockAnalysisData(demoProject);
            
            const projectData = {
                name: demoProject.name,
                originalGame: demoProject.originalGame,
                analysisData: analysisData,
                customizations: demoProject.customizations,
                framework: demoProject.engine
            };

            const project = projectManager.createProject(projectData);
            
            // Update project status
            projectManager.updateProject(project.id, {
                status: demoProject.status,
                metadata: {
                    ...project.metadata,
                    engine: demoProject.engine,
                    playCount: Math.floor(Math.random() * 1000),
                    rating: (3.5 + Math.random() * 1.5).toFixed(1)
                }
            });

            console.log(`📁 Created demo project: ${demoProject.name}`);
        });
    }

    /**
     * Generate mock analysis data for demo projects
     */
    generateMockAnalysisData(demoProject) {
        return {
            metadata: {
                title: demoProject.originalGame,
                engine: demoProject.engine,
                genre: this.getGenreForGame(demoProject.originalGame),
                resolution: { width: 1920, height: 1080 },
                framework: demoProject.engine.toUpperCase(),
                version: '1.0.0'
            },
            gameLogic: {
                gameType: this.getGameTypeForGame(demoProject.originalGame),
                mechanics: this.getMechanicsForGame(demoProject.originalGame),
                variables: {
                    playerSpeed: 5,
                    jumpHeight: 10,
                    gravity: 0.8,
                    lives: 3,
                    score: 0
                },
                gameStates: ['menu', 'playing', 'paused', 'game_over']
            },
            assets: {
                sprites: [
                    { name: 'player.png', size: '128x128', format: 'PNG' },
                    { name: 'background.jpg', size: '1920x1080', format: 'JPEG' },
                    { name: 'enemies.png', size: '256x256', format: 'PNG' }
                ],
                sounds: [
                    { name: 'music.mp3', duration: '3m 24s', format: 'MP3' },
                    { name: 'jump.wav', duration: '0.5s', format: 'WAV' }
                ]
            },
            ui: {
                elements: [
                    { type: 'button', id: 'start_btn', position: { x: 400, y: 300 } },
                    { type: 'score_display', id: 'score', position: { x: 20, y: 20 } }
                ],
                styles: {
                    primaryColor: '#4A5568',
                    secondaryColor: '#9F7AEA',
                    fontFamily: 'Arial, sans-serif'
                }
            },
            physics: {
                engine: 'custom',
                gravity: { x: 0, y: 9.8 },
                friction: 0.8
            },
            audio: {
                backgroundMusic: true,
                soundEffects: ['jump', 'collect', 'damage'],
                volume: { master: 0.8, music: 0.6, sfx: 0.9 }
            },
            controls: {
                inputMethods: ['keyboard', 'mouse'],
                keyBindings: {
                    'ArrowLeft': 'move_left',
                    'ArrowRight': 'move_right',
                    'Space': 'jump'
                }
            }
        };
    }

    /**
     * Add demo-specific features
     */
    addDemoFeatures() {
        // Add demo mode indicator
        this.addDemoModeIndicator();
        
        // Add quick demo actions
        this.addQuickDemoActions();
        
        // Add sample game data to the grid
        this.addSampleGames();
    }

    /**
     * Add demo mode indicator to the header
     */
    addDemoModeIndicator() {
        const header = document.querySelector('header .container');
        if (header) {
            const demoIndicator = document.createElement('div');
            demoIndicator.className = 'absolute top-2 right-2 bg-yellow-500 text-black px-2 py-1 rounded text-xs font-bold';
            demoIndicator.innerHTML = '🚀 DEMO MODE';
            demoIndicator.style.position = 'absolute';
            demoIndicator.style.top = '10px';
            demoIndicator.style.right = '10px';
            demoIndicator.style.zIndex = '10';
            
            header.style.position = 'relative';
            header.appendChild(demoIndicator);
        }
    }

    /**
     * Add quick demo action buttons
     */
    addQuickDemoActions() {
        const searchSection = document.querySelector('section:first-of-type .bg-gray-800');
        if (searchSection) {
            const demoActionsHTML = `
                <div class="mt-4 p-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg">
                    <h3 class="text-white font-bold mb-3">
                        <i class="fas fa-rocket mr-2"></i>Quick Demo Actions
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <button id="demoAnalyze" class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-4 py-2 rounded-lg transition">
                            <i class="fas fa-search mr-2"></i>Demo Analysis
                        </button>
                        <button id="demoCustomize" class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-4 py-2 rounded-lg transition">
                            <i class="fas fa-palette mr-2"></i>Demo Customization
                        </button>
                        <button id="demoGenerate" class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-4 py-2 rounded-lg transition">
                            <i class="fas fa-magic mr-2"></i>Demo Generation
                        </button>
                    </div>
                </div>
            `;
            
            searchSection.insertAdjacentHTML('beforeend', demoActionsHTML);
            
            // Add event listeners
            document.getElementById('demoAnalyze').addEventListener('click', () => this.runDemoAnalysis());
            document.getElementById('demoCustomize').addEventListener('click', () => this.runDemoCustomization());
            document.getElementById('demoGenerate').addEventListener('click', () => this.runDemoGeneration());
        }
    }

    /**
     * Add more sample games to the grid
     */
    addSampleGames() {
        const gameGrid = document.querySelector('.grid');
        if (gameGrid) {
            const additionalGames = [
                { name: 'Retro Racer', genre: 'Racing', rating: '4.7', plays: '890K', color: 'from-red-600 to-orange-600' },
                { name: 'Space Explorer', genre: 'Adventure', rating: '4.6', plays: '1.1M', color: 'from-indigo-600 to-purple-600' },
                { name: 'Tower Defense Pro', genre: 'Strategy', rating: '4.9', plays: '650K', color: 'from-green-600 to-teal-600' },
                { name: 'Puzzle Master 3D', genre: 'Puzzle', rating: '4.4', plays: '420K', color: 'from-yellow-600 to-red-600' }
            ];

            additionalGames.forEach((game, index) => {
                const gameCard = document.createElement('div');
                gameCard.className = 'game-card bg-gray-800 rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition duration-300 relative';
                gameCard.innerHTML = `
                    <div class="relative">
                        <div class="w-full h-48 bg-gradient-to-br ${game.color} flex items-center justify-center">
                            <div class="text-center text-white">
                                <i class="fas fa-gamepad text-4xl mb-2"></i>
                                <p class="font-bold">${game.name}</p>
                            </div>
                        </div>
                        <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-70"></div>
                        <div class="absolute bottom-3 left-3">
                            <span class="bg-purple-600 text-xs px-2 py-1 rounded">${game.genre}</span>
                        </div>
                    </div>
                    <div class="p-4">
                        <h3 class="font-bold text-lg mb-1">${game.name}</h3>
                        <p class="text-gray-400 text-sm mb-3">By Demo Studios</p>
                        <div class="flex justify-between items-center">
                            <div class="flex items-center text-yellow-400">
                                <i class="fas fa-star"></i>
                                <span class="ml-1 text-sm">${game.rating}</span>
                            </div>
                            <span class="text-gray-400 text-sm">${game.plays} plays</span>
                        </div>
                    </div>
                    <div class="game-actions absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center opacity-0 transform translate-y-2 transition duration-300">
                        <button class="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg font-medium mx-2 transition dup-btn" data-game="${game.name}">
                            <i class="fas fa-copy mr-2"></i>Duplicate
                        </button>
                        <button class="bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded-lg font-medium mx-2 transition">
                            <i class="fas fa-info-circle mr-2"></i>Details
                        </button>
                    </div>
                `;
                
                gameGrid.appendChild(gameCard);
            });

            // Re-attach event listeners to new duplicate buttons
            document.querySelectorAll('.dup-btn').forEach(button => {
                if (!button.hasAttribute('data-demo-attached')) {
                    button.setAttribute('data-demo-attached', 'true');
                    button.addEventListener('click', async function() {
                        const gameName = this.getAttribute('data-game');
                        await analyzeAndCustomizeGame(gameName);
                    });
                }
            });
        }
    }

    /**
     * Demo analysis workflow
     */
    async runDemoAnalysis() {
        showInfoNotification('Running Demo Analysis...', 'Analyzing a sample Unity game');
        
        try {
            const analysisData = await gameAnalyzer.analyzeGame('Demo Unity Game', {
                deepAnalysis: true,
                extractAssets: true
            });
            
            showSuccessNotification('Analysis Complete!', 'Found Unity 3D platformer with 15 scripts and 32 assets');
            console.log('Demo Analysis Results:', analysisData);
            
        } catch (error) {
            showErrorNotification('Demo Analysis Failed', error.message);
        }
    }

    /**
     * Demo customization workflow
     */
    async runDemoCustomization() {
        showInfoNotification('Opening Demo Customization...', 'Pre-configured with sample settings');
        
        // Create mock analysis data
        const mockAnalysis = this.generateMockAnalysisData({ 
            originalGame: 'Demo Game',
            engine: 'unity'
        });
        
        // Initialize and show customization panel
        customizationPanel.init(mockAnalysis);
        customizationPanel.show();
        
        // Pre-fill some demo values
        setTimeout(() => {
            const gameTitle = document.getElementById('gameTitle');
            const playerSpeed = document.getElementById('playerSpeed');
            const jumpHeight = document.getElementById('jumpHeight');
            
            if (gameTitle) gameTitle.value = 'My Awesome Game Clone';
            if (playerSpeed) playerSpeed.value = '8';
            if (jumpHeight) jumpHeight.value = '15';
            
            showInfoNotification('Demo Values Loaded', 'Try customizing the settings and preview your changes');
        }, 1000);
    }

    /**
     * Demo generation workflow
     */
    async runDemoGeneration() {
        showInfoNotification('Starting Demo Generation...', 'This will simulate the full game creation process');
        
        const modal = document.getElementById('duplicationModal');
        const gameNameSpan = document.getElementById('gameName');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const statusText = document.getElementById('statusText');
        
        gameNameSpan.textContent = 'Demo Game';
        modal.classList.remove('hidden');
        
        try {
            // Simulate the full generation process
            const steps = [
                { progress: 15, status: 'Analyzing game structure...' },
                { progress: 30, status: 'Extracting assets...' },
                { progress: 45, status: 'Generating game logic...' },
                { progress: 60, status: 'Creating UI components...' },
                { progress: 75, status: 'Implementing physics...' },
                { progress: 90, status: 'Optimizing performance...' },
                { progress: 100, status: 'Generation complete!' }
            ];
            
            for (const step of steps) {
                await new Promise(resolve => setTimeout(resolve, 800));
                progressBar.style.width = step.progress + '%';
                progressText.textContent = step.progress + '%';
                statusText.textContent = step.status;
            }
            
            document.getElementById('doneBtn').classList.remove('hidden');
            
        } catch (error) {
            showErrorNotification('Demo Generation Failed', error.message);
            modal.classList.add('hidden');
        }
    }

    /**
     * Show welcome message
     */
    showWelcomeMessage() {
        setTimeout(() => {
            showInfoNotification(
                'Welcome to GameDuplicator Pro Demo!', 
                'Try the demo actions above or click "My Projects" to see sample projects'
            );
        }, 1000);
    }

    // Helper methods
    getGenreForGame(gameName) {
        const genres = {
            'Epic Adventure': 'action',
            'Mind Bender': 'puzzle',
            'Kingdom Wars': 'strategy',
            'Speed Demon': 'racing'
        };
        return genres[gameName] || 'action';
    }

    getGameTypeForGame(gameName) {
        const types = {
            'Epic Adventure': 'platformer',
            'Mind Bender': 'puzzle',
            'Kingdom Wars': 'strategy',
            'Speed Demon': 'racing'
        };
        return types[gameName] || 'platformer';
    }

    getMechanicsForGame(gameName) {
        const mechanics = {
            'Epic Adventure': ['player_movement', 'jumping', 'collision_detection', 'enemy_ai'],
            'Mind Bender': ['tile_matching', 'score_system', 'level_progression'],
            'Kingdom Wars': ['unit_movement', 'resource_management', 'combat_system'],
            'Speed Demon': ['vehicle_physics', 'track_racing', 'power_ups']
        };
        return mechanics[gameName] || ['basic_movement', 'collision_detection'];
    }
}

// Initialize demo when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit for other components to initialize
    setTimeout(() => {
        const demo = new GameDuplicatorDemo();
        demo.initializeDemo();
    }, 500);
});

// Export for global access
window.GameDuplicatorDemo = GameDuplicatorDemo;