/**
 * Unity Asset Store Integration - Browse and download reference assets
 */

class UnityAssetStoreIntegration {
    constructor() {
        this.apiEndpoint = 'https://assetstore.unity.com/api';
        this.assetCache = new Map();
        this.downloadQueue = [];
        this.categories = {
            '2D': ['Sprites', 'Textures', 'UI', 'Fonts'],
            '3D': ['Models', 'Materials', 'Environments', 'Characters'],
            'Audio': ['Music', 'Sound FX', 'Voice'],
            'Scripts': ['Editor', 'Gameplay', 'Utilities', 'AI'],
            'Templates': ['Complete Projects', 'Prototypes', 'Demos']
        };
    }

    /**
     * Search Unity Asset Store for relevant assets
     */
    async searchAssets(analysisData, options = {}) {
        console.log('🔍 Searching Unity Asset Store for relevant assets...');
        
        try {
            // Generate search queries based on analysis data
            const searchQueries = this.generateSearchQueries(analysisData);
            
            // Search for each category
            const searchResults = {};
            for (const [category, query] of Object.entries(searchQueries)) {
                searchResults[category] = await this.performSearch(query, category, options);
            }
            
            // Rank and filter results
            const rankedAssets = this.rankAssetRelevance(searchResults, analysisData);
            
            console.log('✅ Asset Store search complete');
            return rankedAssets;
            
        } catch (error) {
            console.error('Asset Store search failed:', error);
            return this.getMockAssetResults(analysisData);
        }
    }

    /**
     * Generate search queries based on game analysis
     */
    generateSearchQueries(analysisData) {
        const queries = {};
        
        // Based on game genre
        const genre = analysisData.metadata?.genre || 'action';
        queries.templates = `${genre} game template`;
        
        // Based on detected assets
        if (analysisData.assets?.sprites?.length > 0) {
            queries.sprites = `${genre} character sprites`;
        }
        
        if (analysisData.assets?.sounds?.length > 0) {
            queries.audio = `${genre} sound effects music`;
        }
        
        // Based on game mechanics
        const mechanics = analysisData.gameLogic?.mechanics || [];
        if (mechanics.includes('player_movement')) {
            queries.playerController = 'player movement controller';
        }
        
        if (mechanics.includes('enemy_ai')) {
            queries.aiScripts = 'enemy AI behavior scripts';
        }
        
        // Based on Unity-specific data
        if (analysisData.scripts?.detectedGameObjects) {
            queries.gameplayScripts = 'gameplay mechanics scripts';
        }
        
        // UI elements
        if (analysisData.ui?.elements?.length > 0) {
            queries.uiAssets = 'UI elements interface pack';
        }
        
        return queries;
    }

    /**
     * Perform actual search (mock implementation)
     */
    async performSearch(query, category, options = {}) {
        console.log(`🔎 Searching for: ${query} in category: ${category}`);
        
        return new Promise((resolve) => {
            setTimeout(() => {
                // Mock search results based on category
                const results = this.generateMockSearchResults(query, category);
                resolve(results);
            }, 1000 + Math.random() * 1000);
        });
    }

    /**
     * Generate mock search results
     */
    generateMockSearchResults(query, category) {
        const baseAssets = {
            templates: [
                {
                    id: 'asset_001',
                    name: '2D Platformer Controller',
                    publisher: 'Unity Technologies',
                    price: 'Free',
                    rating: 4.5,
                    downloads: '50K+',
                    description: 'Complete 2D platformer with physics and animations',
                    tags: ['2D', 'Platformer', 'Controller', 'Physics'],
                    unityVersion: '2019.4+',
                    category: 'Templates',
                    thumbnail: 'https://via.placeholder.com/200x150/4A90E2/FFFFFF?text=2D+Platform',
                    size: '15 MB',
                    lastUpdated: '2023-10-15'
                },
                {
                    id: 'asset_002',
                    name: 'Complete Game Kit 2D',
                    publisher: 'Game Dev Studio',
                    price: '$24.99',
                    rating: 4.8,
                    downloads: '25K+',
                    description: 'Full 2D game template with multiple levels and characters',
                    tags: ['2D', 'Complete', 'Template', 'Multi-level'],
                    unityVersion: '2020.3+',
                    category: 'Templates',
                    thumbnail: 'https://via.placeholder.com/200x150/50C878/FFFFFF?text=Game+Kit',
                    size: '45 MB',
                    lastUpdated: '2023-11-02'
                }
            ],
            sprites: [
                {
                    id: 'asset_003',
                    name: 'Pixel Art Character Pack',
                    publisher: 'Pixel Artists',
                    price: '$9.99',
                    rating: 4.6,
                    downloads: '75K+',
                    description: '16 animated characters for 2D platformers',
                    tags: ['Pixel Art', 'Characters', 'Animated', '2D'],
                    unityVersion: '2018.4+',
                    category: 'Sprites',
                    thumbnail: 'https://via.placeholder.com/200x150/FF6B6B/FFFFFF?text=Pixel+Art',
                    size: '8 MB',
                    lastUpdated: '2023-09-20'
                },
                {
                    id: 'asset_004',
                    name: 'Environment Tileset',
                    publisher: 'Level Design Co',
                    price: '$14.99',
                    rating: 4.4,
                    downloads: '40K+',
                    description: 'Modular tileset for creating diverse environments',
                    tags: ['Tileset', 'Environment', 'Modular', 'Level Design'],
                    unityVersion: '2019.4+',
                    category: 'Sprites',
                    thumbnail: 'https://via.placeholder.com/200x150/4ECDC4/FFFFFF?text=Tileset',
                    size: '22 MB',
                    lastUpdated: '2023-10-08'
                }
            ],
            audio: [
                {
                    id: 'asset_005',
                    name: 'Game Music Collection',
                    publisher: 'Audio Masters',
                    price: '$19.99',
                    rating: 4.7,
                    downloads: '60K+',
                    description: '20 looping tracks for various game genres',
                    tags: ['Music', 'Looping', 'Background', 'Multi-genre'],
                    unityVersion: 'All versions',
                    category: 'Audio',
                    thumbnail: 'https://via.placeholder.com/200x150/9B59B6/FFFFFF?text=Music',
                    size: '85 MB',
                    lastUpdated: '2023-10-25'
                },
                {
                    id: 'asset_006',
                    name: 'Sound Effects Library',
                    publisher: 'SFX Studio',
                    price: '$12.99',
                    rating: 4.5,
                    downloads: '90K+',
                    description: '500+ high-quality sound effects',
                    tags: ['SFX', 'Sound Effects', 'High Quality', 'Comprehensive'],
                    unityVersion: 'All versions',
                    category: 'Audio',
                    thumbnail: 'https://via.placeholder.com/200x150/E67E22/FFFFFF?text=SFX',
                    size: '120 MB',
                    lastUpdated: '2023-11-01'
                }
            ],
            playerController: [
                {
                    id: 'asset_007',
                    name: 'Advanced Player Controller',
                    publisher: 'Code Masters',
                    price: '$15.99',
                    rating: 4.9,
                    downloads: '100K+',
                    description: 'Feature-rich player controller with advanced physics',
                    tags: ['Controller', 'Physics', 'Advanced', 'Customizable'],
                    unityVersion: '2020.3+',
                    category: 'Scripts',
                    thumbnail: 'https://via.placeholder.com/200x150/3498DB/FFFFFF?text=Controller',
                    size: '2 MB',
                    lastUpdated: '2023-10-30'
                }
            ],
            aiScripts: [
                {
                    id: 'asset_008',
                    name: 'AI Behavior Tree',
                    publisher: 'AI Solutions',
                    price: '$29.99',
                    rating: 4.8,
                    downloads: '35K+',
                    description: 'Visual behavior tree system for enemy AI',
                    tags: ['AI', 'Behavior Tree', 'Visual', 'Enemy'],
                    unityVersion: '2021.3+',
                    category: 'Scripts',
                    thumbnail: 'https://via.placeholder.com/200x150/27AE60/FFFFFF?text=AI+Tree',
                    size: '5 MB',
                    lastUpdated: '2023-10-18'
                }
            ],
            gameplayScripts: [
                {
                    id: 'asset_009',
                    name: 'Gameplay Mechanics Toolkit',
                    publisher: 'Toolkit Studios',
                    price: '$22.99',
                    rating: 4.6,
                    downloads: '45K+',
                    description: 'Collection of common gameplay mechanics',
                    tags: ['Gameplay', 'Mechanics', 'Toolkit', 'Modular'],
                    unityVersion: '2019.4+',
                    category: 'Scripts',
                    thumbnail: 'https://via.placeholder.com/200x150/8E44AD/FFFFFF?text=Toolkit',
                    size: '8 MB',
                    lastUpdated: '2023-09-15'
                }
            ],
            uiAssets: [
                {
                    id: 'asset_010',
                    name: 'Modern UI Pack',
                    publisher: 'UI Designers',
                    price: '$18.99',
                    rating: 4.7,
                    downloads: '80K+',
                    description: 'Clean and modern UI elements for games',
                    tags: ['UI', 'Modern', 'Clean', 'Elements'],
                    unityVersion: '2019.4+',
                    category: 'UI',
                    thumbnail: 'https://via.placeholder.com/200x150/1ABC9C/FFFFFF?text=Modern+UI',
                    size: '12 MB',
                    lastUpdated: '2023-10-12'
                }
            ]
        };

        return baseAssets[category] || [];
    }

    /**
     * Rank assets by relevance to the analyzed game
     */
    rankAssetRelevance(searchResults, analysisData) {
        const rankedAssets = {
            highlyRelevant: [],
            relevant: [],
            additional: []
        };

        Object.values(searchResults).forEach(categoryResults => {
            categoryResults.forEach(asset => {
                const relevanceScore = this.calculateRelevanceScore(asset, analysisData);
                
                if (relevanceScore >= 0.8) {
                    rankedAssets.highlyRelevant.push({ ...asset, relevanceScore });
                } else if (relevanceScore >= 0.5) {
                    rankedAssets.relevant.push({ ...asset, relevanceScore });
                } else {
                    rankedAssets.additional.push({ ...asset, relevanceScore });
                }
            });
        });

        // Sort by relevance score
        Object.keys(rankedAssets).forEach(key => {
            rankedAssets[key].sort((a, b) => b.relevanceScore - a.relevanceScore);
        });

        return rankedAssets;
    }

    /**
     * Calculate relevance score for an asset
     */
    calculateRelevanceScore(asset, analysisData) {
        let score = 0;
        
        // Genre matching
        const genre = analysisData.metadata?.genre || '';
        if (asset.tags.some(tag => tag.toLowerCase().includes(genre.toLowerCase()))) {
            score += 0.3;
        }

        // Engine version compatibility
        const unityVersion = analysisData.version || '2022.3';
        if (this.isVersionCompatible(asset.unityVersion, unityVersion)) {
            score += 0.2;
        }

        // Category relevance
        const mechanics = analysisData.gameLogic?.mechanics || [];
        if (asset.category === 'Scripts' && mechanics.length > 0) {
            score += 0.2;
        }

        // Asset type matching
        if (analysisData.assets?.sprites?.length > 0 && asset.category === 'Sprites') {
            score += 0.2;
        }

        if (analysisData.assets?.sounds?.length > 0 && asset.category === 'Audio') {
            score += 0.2;
        }

        // Rating bonus
        score += (asset.rating / 5) * 0.1;

        return Math.min(score, 1.0);
    }

    /**
     * Check Unity version compatibility
     */
    isVersionCompatible(assetVersion, targetVersion) {
        if (assetVersion === 'All versions') return true;
        
        // Simple version check (in real implementation, would parse semantic versions)
        const assetYear = parseInt(assetVersion.split('.')[0]) || 2019;
        const targetYear = parseInt(targetVersion.split('.')[0]) || 2022;
        
        return assetYear <= targetYear;
    }

    /**
     * Download asset (mock implementation)
     */
    async downloadAsset(assetId, options = {}) {
        console.log(`📥 Downloading asset: ${assetId}`);
        
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const asset = this.findAssetById(assetId);
                if (asset) {
                    const downloadResult = {
                        assetId: assetId,
                        name: asset.name,
                        status: 'completed',
                        files: this.generateAssetFiles(asset),
                        size: asset.size,
                        downloadTime: Math.random() * 5000 + 1000
                    };
                    
                    this.assetCache.set(assetId, downloadResult);
                    resolve(downloadResult);
                } else {
                    reject(new Error('Asset not found'));
                }
            }, Math.random() * 3000 + 2000);
        });
    }

    /**
     * Find asset by ID
     */
    findAssetById(assetId) {
        // In real implementation, would search through cached results
        const mockAssets = this.generateMockSearchResults('', 'all');
        return { id: assetId, name: 'Mock Asset', category: 'Scripts', size: '5 MB' };
    }

    /**
     * Generate asset file structure
     */
    generateAssetFiles(asset) {
        const files = {};
        
        switch (asset.category) {
            case 'Scripts':
                files['Scripts/'] = {
                    'PlayerController.cs': 'C# script file',
                    'GameManager.cs': 'C# script file',
                    'README.txt': 'Documentation'
                };
                break;
                
            case 'Sprites':
                files['Sprites/'] = {
                    'character_01.png': 'Sprite texture',
                    'character_02.png': 'Sprite texture',
                    'animations.anim': 'Animation file'
                };
                break;
                
            case 'Audio':
                files['Audio/'] = {
                    'background_music.mp3': 'Audio file',
                    'sound_effects.wav': 'Audio file'
                };
                break;
                
            case 'Templates':
                files['Complete Project/'] = {
                    'Scenes/': { 'MainScene.unity': 'Scene file' },
                    'Scripts/': { 'GameController.cs': 'C# script' },
                    'Prefabs/': { 'Player.prefab': 'Prefab file' }
                };
                break;
                
            default:
                files['Assets/'] = {
                    'README.txt': 'Asset documentation'
                };
        }
        
        return files;
    }

    /**
     * Get cached asset
     */
    getCachedAsset(assetId) {
        return this.assetCache.get(assetId);
    }

    /**
     * Generate asset store UI
     */
    generateAssetStoreUI() {
        return `
        <div id="assetStorePanel" class="fixed inset-0 z-50 bg-black bg-opacity-50 hidden">
            <div class="flex h-full">
                <!-- Asset Store Sidebar -->
                <div class="w-80 bg-gray-800 overflow-y-auto">
                    <div class="p-6 border-b border-gray-700">
                        <h2 class="text-xl font-bold mb-2">Unity Asset Store</h2>
                        <p class="text-gray-400 text-sm">Find assets for your game</p>
                    </div>
                    
                    <!-- Search -->
                    <div class="p-4 border-b border-gray-700">
                        <input type="text" id="assetSearch" placeholder="Search assets..." 
                               class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                    
                    <!-- Categories -->
                    <div class="p-4">
                        <h3 class="font-bold mb-3">Categories</h3>
                        <div id="assetCategories" class="space-y-2">
                            <!-- Categories will be populated here -->
                        </div>
                    </div>
                    
                    <!-- Recommended Assets -->
                    <div class="p-4 border-t border-gray-700">
                        <h3 class="font-bold mb-3">Recommended</h3>
                        <div id="recommendedAssets" class="space-y-3">
                            <!-- Recommended assets will be populated here -->
                        </div>
                    </div>
                </div>
                
                <!-- Main Content -->
                <div class="flex-1 bg-gray-900 overflow-y-auto">
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-6">
                            <h3 class="text-xl font-bold">Asset Search Results</h3>
                            <button id="closeAssetStore" class="text-gray-400 hover:text-white">
                                <i class="fas fa-times text-2xl"></i>
                            </button>
                        </div>
                        
                        <!-- Asset Grid -->
                        <div id="assetGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <!-- Assets will be populated here -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Initialize Asset Store UI
     */
    initializeAssetStoreUI() {
        document.body.insertAdjacentHTML('beforeend', this.generateAssetStoreUI());
        this.setupAssetStoreEventListeners();
    }

    /**
     * Setup Asset Store event listeners
     */
    setupAssetStoreEventListeners() {
        document.getElementById('closeAssetStore').addEventListener('click', () => {
            this.hideAssetStore();
        });

        document.getElementById('assetSearch').addEventListener('input', (e) => {
            this.performAssetSearch(e.target.value);
        });
    }

    /**
     * Show Asset Store panel
     */
    showAssetStore(analysisData = null) {
        document.getElementById('assetStorePanel').classList.remove('hidden');
        
        if (analysisData) {
            this.populateRecommendedAssets(analysisData);
        }
    }

    /**
     * Hide Asset Store panel
     */
    hideAssetStore() {
        document.getElementById('assetStorePanel').classList.add('hidden');
    }

    /**
     * Populate recommended assets
     */
    async populateRecommendedAssets(analysisData) {
        try {
            const assets = await this.searchAssets(analysisData);
            const container = document.getElementById('recommendedAssets');
            
            const assetsHTML = assets.highlyRelevant.slice(0, 3).map(asset => `
                <div class="asset-item bg-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-600 transition" data-asset-id="${asset.id}">
                    <h4 class="font-medium text-white text-sm mb-1">${asset.name}</h4>
                    <p class="text-xs text-gray-400 mb-2">${asset.publisher}</p>
                    <div class="flex justify-between items-center">
                        <span class="text-xs text-green-400">${asset.price}</span>
                        <div class="flex items-center">
                            <i class="fas fa-star text-yellow-400 text-xs mr-1"></i>
                            <span class="text-xs text-gray-400">${asset.rating}</span>
                        </div>
                    </div>
                </div>
            `).join('');
            
            container.innerHTML = assetsHTML;
            
            // Add click handlers
            document.querySelectorAll('.asset-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const assetId = e.currentTarget.dataset.assetId;
                    this.showAssetDetails(assetId);
                });
            });
            
        } catch (error) {
            console.error('Failed to populate recommended assets:', error);
        }
    }

    /**
     * Show asset details
     */
    showAssetDetails(assetId) {
        // Implementation for showing detailed asset information
        console.log('Showing details for asset:', assetId);
    }

    /**
     * Perform asset search
     */
    performAssetSearch(query) {
        // Implementation for searching assets
        console.log('Searching for:', query);
    }

    /**
     * Get mock asset results for fallback
     */
    getMockAssetResults(analysisData) {
        return {
            highlyRelevant: this.generateMockSearchResults('', 'templates').slice(0, 2),
            relevant: this.generateMockSearchResults('', 'sprites').slice(0, 3),
            additional: this.generateMockSearchResults('', 'audio').slice(0, 2)
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnityAssetStoreIntegration;
} else {
    window.UnityAssetStoreIntegration = UnityAssetStoreIntegration;
}