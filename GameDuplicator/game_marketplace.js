/**
 * Game Marketplace - Platform for sharing and discovering created games
 */

class GameMarketplace {
    constructor() {
        this.games = new Map();
        this.users = new Map();
        this.categories = ['Action', 'Puzzle', 'Platformer', 'Racing', 'Strategy', 'RPG', 'Casual'];
        this.sortOptions = ['Popular', 'Recent', 'Rating', 'Downloads'];
        this.currentUser = null;
        this.currentFilter = {
            category: 'All',
            sort: 'Popular',
            search: ''
        };
        this.initializeMarketplace();
    }

    /**
     * Initialize marketplace with sample data
     */
    initializeMarketplace() {
        // Create sample games
        this.createSampleGames();
        
        // Create sample users
        this.createSampleUsers();
        
        console.log('🛒 Game Marketplace initialized');
    }

    /**
     * Create sample games for demonstration
     */
    createSampleGames() {
        const sampleGames = [
            {
                id: 'game_001',
                title: 'Pixel Adventure Pro',
                description: 'A modern take on classic platformer games with smooth physics and beautiful pixel art.',
                author: 'GameDev123',
                authorId: 'user_001',
                category: 'Platformer',
                rating: 4.8,
                downloads: 15420,
                plays: 89340,
                price: 'Free',
                tags: ['pixel', 'platformer', 'adventure', 'physics'],
                screenshots: [
                    'https://via.placeholder.com/400x300/4A90E2/FFFFFF?text=Screenshot+1',
                    'https://via.placeholder.com/400x300/50C878/FFFFFF?text=Screenshot+2',
                    'https://via.placeholder.com/400x300/FF6B6B/FFFFFF?text=Screenshot+3'
                ],
                thumbnail: 'https://via.placeholder.com/300x200/4A90E2/FFFFFF?text=Pixel+Adventure',
                createdAt: '2023-11-15',
                updatedAt: '2023-12-01',
                size: '25 MB',
                engine: 'Unity',
                features: ['Physics', 'Multiple Levels', 'Collectibles', 'Power-ups'],
                controls: 'Keyboard + Mouse',
                multiplayer: false,
                mobile: true
            },
            {
                id: 'game_002',
                title: 'Mind Bender Deluxe',
                description: 'Challenge your brain with this collection of innovative puzzle mechanics.',
                author: 'PuzzleMaster',
                authorId: 'user_002',
                category: 'Puzzle',
                rating: 4.6,
                downloads: 8930,
                plays: 45670,
                price: '$2.99',
                tags: ['puzzle', 'brain', 'logic', 'minimalist'],
                screenshots: [
                    'https://via.placeholder.com/400x300/9B59B6/FFFFFF?text=Puzzle+1',
                    'https://via.placeholder.com/400x300/E67E22/FFFFFF?text=Puzzle+2'
                ],
                thumbnail: 'https://via.placeholder.com/300x200/9B59B6/FFFFFF?text=Mind+Bender',
                createdAt: '2023-10-20',
                updatedAt: '2023-11-28',
                size: '12 MB',
                engine: 'HTML5',
                features: ['50+ Levels', 'Hint System', 'Save Progress'],
                controls: 'Mouse Only',
                multiplayer: false,
                mobile: true
            },
            {
                id: 'game_003',
                title: 'Speed Racer Ultimate',
                description: 'High-speed racing with realistic physics and customizable vehicles.',
                author: 'RacingFan99',
                authorId: 'user_003',
                category: 'Racing',
                rating: 4.4,
                downloads: 23450,
                plays: 156780,
                price: 'Free',
                tags: ['racing', 'cars', 'speed', '3d'],
                screenshots: [
                    'https://via.placeholder.com/400x300/E74C3C/FFFFFF?text=Racing+1',
                    'https://via.placeholder.com/400x300/3498DB/FFFFFF?text=Racing+2',
                    'https://via.placeholder.com/400x300/F39C12/FFFFFF?text=Racing+3'
                ],
                thumbnail: 'https://via.placeholder.com/300x200/E74C3C/FFFFFF?text=Speed+Racer',
                createdAt: '2023-09-10',
                updatedAt: '2023-11-20',
                size: '85 MB',
                engine: 'Unity',
                features: ['Multiple Tracks', 'Car Customization', 'Time Trials'],
                controls: 'Keyboard + Gamepad',
                multiplayer: true,
                mobile: false
            },
            {
                id: 'game_004',
                title: 'Crystal Quest 3D',
                description: 'Explore mystical worlds and collect magical crystals in this 3D adventure.',
                author: 'FantasyGames',
                authorId: 'user_004',
                category: 'Action',
                rating: 4.9,
                downloads: 34560,
                plays: 203450,
                price: '$4.99',
                tags: ['3d', 'adventure', 'fantasy', 'crystals'],
                screenshots: [
                    'https://via.placeholder.com/400x300/1ABC9C/FFFFFF?text=3D+World+1',
                    'https://via.placeholder.com/400x300/8E44AD/FFFFFF?text=3D+World+2'
                ],
                thumbnail: 'https://via.placeholder.com/300x200/1ABC9C/FFFFFF?text=Crystal+Quest',
                createdAt: '2023-08-15',
                updatedAt: '2023-11-30',
                size: '120 MB',
                engine: 'Unity',
                features: ['Open World', '3D Graphics', 'Quest System', 'Inventory'],
                controls: 'Keyboard + Mouse',
                multiplayer: false,
                mobile: false
            },
            {
                id: 'game_005',
                title: 'Zen Garden Builder',
                description: 'Create peaceful zen gardens with relaxing gameplay and beautiful visuals.',
                author: 'RelaxGames',
                authorId: 'user_005',
                category: 'Casual',
                rating: 4.7,
                downloads: 19780,
                plays: 87650,
                price: 'Free',
                tags: ['zen', 'relaxing', 'builder', 'peaceful'],
                screenshots: [
                    'https://via.placeholder.com/400x300/27AE60/FFFFFF?text=Zen+Garden',
                    'https://via.placeholder.com/400x300/16A085/FFFFFF?text=Peaceful'
                ],
                thumbnail: 'https://via.placeholder.com/300x200/27AE60/FFFFFF?text=Zen+Garden',
                createdAt: '2023-11-01',
                updatedAt: '2023-11-25',
                size: '45 MB',
                engine: 'HTML5',
                features: ['Creative Mode', 'Relaxing Music', 'Share Creations'],
                controls: 'Mouse + Touch',
                multiplayer: false,
                mobile: true
            }
        ];

        sampleGames.forEach(game => {
            this.games.set(game.id, game);
        });
    }

    /**
     * Create sample users
     */
    createSampleUsers() {
        const sampleUsers = [
            {
                id: 'user_001',
                username: 'GameDev123',
                displayName: 'Game Developer',
                avatar: 'https://via.placeholder.com/64x64/4A90E2/FFFFFF?text=GD',
                joinDate: '2023-06-15',
                gamesPublished: 3,
                totalDownloads: 45670,
                reputation: 4.8,
                verified: true,
                bio: 'Passionate indie game developer focused on platformer games.'
            },
            {
                id: 'user_002',
                username: 'PuzzleMaster',
                displayName: 'Puzzle Master',
                avatar: 'https://via.placeholder.com/64x64/9B59B6/FFFFFF?text=PM',
                joinDate: '2023-05-20',
                gamesPublished: 5,
                totalDownloads: 23450,
                reputation: 4.6,
                verified: true,
                bio: 'Creating mind-bending puzzles since 2020.'
            },
            {
                id: 'user_003',
                username: 'RacingFan99',
                displayName: 'Racing Enthusiast',
                avatar: 'https://via.placeholder.com/64x64/E74C3C/FFFFFF?text=RF',
                joinDate: '2023-07-10',
                gamesPublished: 2,
                totalDownloads: 34560,
                reputation: 4.4,
                verified: false,
                bio: 'Speed is life. Creating fast-paced racing experiences.'
            }
        ];

        sampleUsers.forEach(user => {
            this.users.set(user.id, user);
        });
    }

    /**
     * Generate marketplace UI
     */
    generateMarketplaceUI() {
        return `
        <div id="marketplacePanel" class="fixed inset-0 z-50 bg-gray-900 hidden">
            <!-- Marketplace Header -->
            <div class="bg-gray-800 border-b border-gray-700 p-4">
                <div class="flex justify-between items-center">
                    <div class="flex items-center space-x-4">
                        <button id="backFromMarketplace" class="text-gray-400 hover:text-white transition">
                            <i class="fas fa-arrow-left text-xl"></i>
                        </button>
                        <div>
                            <h1 class="text-2xl font-bold text-white">Game Marketplace</h1>
                            <p class="text-gray-400">Discover and share amazing games</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3">
                        <button id="publishGameBtn" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-medium transition">
                            <i class="fas fa-upload mr-2"></i>Publish Game
                        </button>
                        <button id="myGamesBtn" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition">
                            <i class="fas fa-gamepad mr-2"></i>My Games
                        </button>
                        <button id="profileBtn" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-medium transition">
                            <i class="fas fa-user mr-2"></i>Profile
                        </button>
                    </div>
                </div>
            </div>

            <!-- Marketplace Content -->
            <div class="flex h-full">
                <!-- Sidebar Filters -->
                <div class="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto">
                    <div class="p-6">
                        <!-- Search -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-2">Search Games</label>
                            <div class="relative">
                                <input type="text" id="marketplaceSearch" placeholder="Search titles, tags, authors..." 
                                       class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 pl-10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                                <i class="fas fa-search absolute left-3 top-3.5 text-gray-400"></i>
                            </div>
                        </div>

                        <!-- Categories -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-3">Categories</label>
                            <div id="categoryFilter" class="space-y-2">
                                <button class="category-btn w-full text-left px-3 py-2 rounded-lg bg-purple-600 text-white" data-category="All">
                                    <i class="fas fa-th mr-2"></i>All Games
                                </button>
                                <!-- Category buttons will be populated here -->
                            </div>
                        </div>

                        <!-- Sort Options -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-3">Sort By</label>
                            <select id="sortFilter" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                                <option value="Popular">Most Popular</option>
                                <option value="Recent">Most Recent</option>
                                <option value="Rating">Highest Rated</option>
                                <option value="Downloads">Most Downloaded</option>
                            </select>
                        </div>

                        <!-- Filters -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-3">Filters</label>
                            <div class="space-y-3">
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" id="freeOnly" class="mr-2">
                                    Free Games Only
                                </label>
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" id="mobileSupport" class="mr-2">
                                    Mobile Support
                                </label>
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" id="multiplayerOnly" class="mr-2">
                                    Multiplayer
                                </label>
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" id="verifiedOnly" class="mr-2">
                                    Verified Creators
                                </label>
                            </div>
                        </div>

                        <!-- Featured Creators -->
                        <div class="mb-6">
                            <h3 class="text-sm font-medium text-white mb-3">Featured Creators</h3>
                            <div id="featuredCreators" class="space-y-3">
                                <!-- Featured creators will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Main Content Area -->
                <div class="flex-1 overflow-y-auto">
                    <div class="p-6">
                        <!-- Results Header -->
                        <div class="flex justify-between items-center mb-6">
                            <div>
                                <h2 id="resultsTitle" class="text-xl font-bold text-white">Popular Games</h2>
                                <p id="resultsCount" class="text-gray-400">Showing 5 games</p>
                            </div>
                            <div class="flex items-center space-x-3">
                                <button id="gridViewBtn" class="p-2 bg-purple-600 text-white rounded-lg">
                                    <i class="fas fa-th-large"></i>
                                </button>
                                <button id="listViewBtn" class="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">
                                    <i class="fas fa-list"></i>
                                </button>
                            </div>
                        </div>

                        <!-- Games Grid -->
                        <div id="gamesGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            <!-- Games will be populated here -->
                        </div>

                        <!-- Load More -->
                        <div class="text-center mt-8">
                            <button id="loadMoreBtn" class="bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg text-white font-medium transition">
                                Load More Games
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Initialize marketplace UI
     */
    initializeMarketplaceUI() {
        document.body.insertAdjacentHTML('beforeend', this.generateMarketplaceUI());
        this.setupMarketplaceEventListeners();
        this.populateCategories();
        this.populateFeaturedCreators();
        this.displayGames();
    }

    /**
     * Setup marketplace event listeners
     */
    setupMarketplaceEventListeners() {
        // Navigation
        document.getElementById('backFromMarketplace').addEventListener('click', () => {
            this.hideMarketplace();
        });

        // Search
        document.getElementById('marketplaceSearch').addEventListener('input', (e) => {
            this.currentFilter.search = e.target.value;
            this.displayGames();
        });

        // Sort
        document.getElementById('sortFilter').addEventListener('change', (e) => {
            this.currentFilter.sort = e.target.value;
            this.displayGames();
        });

        // View toggles
        document.getElementById('gridViewBtn').addEventListener('click', () => {
            this.setViewMode('grid');
        });

        document.getElementById('listViewBtn').addEventListener('click', () => {
            this.setViewMode('list');
        });

        // Filter checkboxes - Add null checks
        ['freeOnly', 'mobileSupport', 'multiplayerOnly', 'verifiedOnly'].forEach(filterId => {
            const element = document.getElementById(filterId);
            if (element) {
                element.addEventListener('change', () => {
                    this.displayGames();
                });
            }
        });

        // Action buttons
        document.getElementById('publishGameBtn').addEventListener('click', () => {
            this.showPublishDialog();
        });

        document.getElementById('myGamesBtn').addEventListener('click', () => {
            this.showMyGames();
        });

        document.getElementById('profileBtn').addEventListener('click', () => {
            this.showProfile();
        });

        // Load More button
        document.getElementById('loadMoreBtn').addEventListener('click', () => {
            this.loadMoreGames();
        });
    }

    /**
     * Populate category buttons
     */
    populateCategories() {
        const categoryContainer = document.getElementById('categoryFilter');
        
        this.categories.forEach(category => {
            const button = document.createElement('button');
            button.className = 'category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300';
            button.dataset.category = category;
            button.innerHTML = `<i class="fas fa-gamepad mr-2"></i>${category}`;
            
            button.addEventListener('click', () => {
                this.selectCategory(category);
            });
            
            categoryContainer.appendChild(button);
        });
    }

    /**
     * Populate featured creators
     */
    populateFeaturedCreators() {
        const container = document.getElementById('featuredCreators');
        const featuredUsers = Array.from(this.users.values()).slice(0, 3);
        
        featuredUsers.forEach(user => {
            const creatorDiv = document.createElement('div');
            creatorDiv.className = 'flex items-center space-x-3 p-2 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600 transition';
            creatorDiv.innerHTML = `
                <img src="${user.avatar}" alt="${user.displayName}" class="w-8 h-8 rounded-full">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-white truncate">${user.displayName}</p>
                    <p class="text-xs text-gray-400">${user.gamesPublished} games</p>
                </div>
                ${user.verified ? '<i class="fas fa-check-circle text-blue-400 text-sm"></i>' : ''}
            `;
            
            creatorDiv.addEventListener('click', () => {
                this.showCreatorProfile(user.id);
            });
            
            container.appendChild(creatorDiv);
        });
    }

    /**
     * Select category filter
     */
    selectCategory(category) {
        // Update active category button
        document.querySelectorAll('.category-btn').forEach(btn => {
            if (btn.dataset.category === category) {
                btn.className = 'category-btn w-full text-left px-3 py-2 rounded-lg bg-purple-600 text-white';
            } else {
                btn.className = 'category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300';
            }
        });
        
        this.currentFilter.category = category;
        this.displayGames();
    }

    /**
     * Display games based on current filters
     */
    displayGames() {
        try {
            const filteredGames = this.filterGames();
            const sortedGames = this.sortGames(filteredGames);
            
            const container = document.getElementById('gamesGrid');
            if (!container) {
                console.error('Games grid container not found');
                return;
            }
            
            container.innerHTML = '';
            
            if (sortedGames.length === 0) {
                container.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <i class="fas fa-search text-4xl text-gray-500 mb-4"></i>
                        <h3 class="text-xl font-bold text-white mb-2">No games found</h3>
                        <p class="text-gray-400">Try adjusting your search or filters</p>
                    </div>
                `;
                
                // Update results count
                const resultsCount = document.getElementById('resultsCount');
                if (resultsCount) {
                    resultsCount.textContent = 'No games found';
                }
                
                this.updateResultsTitle();
                return;
            }
            
            sortedGames.forEach(game => {
                try {
                    const gameCard = this.createGameCard(game);
                    container.appendChild(gameCard);
                } catch (error) {
                    console.error('Error creating game card:', error, game);
                }
            });
            
            // Update results count
            const resultsCount = document.getElementById('resultsCount');
            if (resultsCount) {
                resultsCount.textContent = `Showing ${sortedGames.length} games`;
            }
            
            // Update results title
            this.updateResultsTitle();
            
            // Update favorite button states
            setTimeout(() => {
                this.updateFavoriteButtons();
            }, 100);
            
        } catch (error) {
            console.error('Error displaying games:', error);
            const container = document.getElementById('gamesGrid');
            if (container) {
                container.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <i class="fas fa-exclamation-triangle text-4xl text-red-500 mb-4"></i>
                        <h3 class="text-xl font-bold text-white mb-2">Error loading games</h3>
                        <p class="text-gray-400">Please try refreshing the page</p>
                    </div>
                `;
            }
        }
    }

    /**
     * Filter games based on current criteria
     */
    filterGames() {
        let filtered = Array.from(this.games.values());
        
        // Category filter
        if (this.currentFilter.category !== 'All') {
            filtered = filtered.filter(game => game.category === this.currentFilter.category);
        }
        
        // Search filter
        if (this.currentFilter.search) {
            const search = this.currentFilter.search.toLowerCase();
            filtered = filtered.filter(game =>
                game.title.toLowerCase().includes(search) ||
                game.description.toLowerCase().includes(search) ||
                game.author.toLowerCase().includes(search) ||
                game.tags.some(tag => tag.toLowerCase().includes(search))
            );
        }
        
        // Checkbox filters with null checks
        const freeOnlyElement = document.getElementById('freeOnly');
        if (freeOnlyElement && freeOnlyElement.checked) {
            filtered = filtered.filter(game => game.price === 'Free');
        }
        
        const mobileSupportElement = document.getElementById('mobileSupport');
        if (mobileSupportElement && mobileSupportElement.checked) {
            filtered = filtered.filter(game => game.mobile);
        }
        
        const multiplayerOnlyElement = document.getElementById('multiplayerOnly');
        if (multiplayerOnlyElement && multiplayerOnlyElement.checked) {
            filtered = filtered.filter(game => game.multiplayer);
        }
        
        const verifiedOnlyElement = document.getElementById('verifiedOnly');
        if (verifiedOnlyElement && verifiedOnlyElement.checked) {
            filtered = filtered.filter(game => {
                const author = this.users.get(game.authorId);
                return author && author.verified;
            });
        }
        
        return filtered;
    }

    /**
     * Sort games based on selected criteria
     */
    sortGames(games) {
        switch (this.currentFilter.sort) {
            case 'Popular':
                return games.sort((a, b) => b.plays - a.plays);
            case 'Recent':
                return games.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            case 'Rating':
                return games.sort((a, b) => b.rating - a.rating);
            case 'Downloads':
                return games.sort((a, b) => b.downloads - a.downloads);
            default:
                return games;
        }
    }

    /**
     * Create a game card element
     */
    createGameCard(game) {
        if (!game || !game.id) {
            console.error('Invalid game data:', game);
            return document.createElement('div');
        }

        const card = document.createElement('div');
        card.className = 'game-card bg-gray-800 rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition duration-300 cursor-pointer';
        
        const author = this.users.get(game.authorId) || { avatar: 'https://via.placeholder.com/24x24', verified: false };
        const priceDisplay = game.price === 'Free' ? 
            '<span class="text-green-400 font-bold">Free</span>' : 
            `<span class="text-yellow-400 font-bold">${game.price || 'N/A'}</span>`;
        
        // Safely handle missing properties
        const title = game.title || 'Untitled Game';
        const authorName = game.author || 'Unknown Author';
        const description = game.description || 'No description available';
        const category = game.category || 'General';
        const rating = game.rating || 0;
        const downloads = game.downloads || 0;
        const plays = game.plays || 0;
        const tags = game.tags || [];
        const thumbnail = game.thumbnail || 'https://via.placeholder.com/400x300/333333/FFFFFF?text=No+Image';
        
        card.innerHTML = `
            <div class="relative">
                <img src="${thumbnail}" alt="${title}" class="w-full h-48 object-cover" 
                     onerror="this.src='https://via.placeholder.com/400x300/333333/FFFFFF?text=Image+Error'">
                <div class="absolute top-3 left-3">
                    <span class="bg-purple-600 text-white text-xs px-2 py-1 rounded-full">${category}</span>
                </div>
                <div class="absolute top-3 right-3">
                    ${priceDisplay}
                </div>
                <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-70"></div>
            </div>
            
            <div class="p-4">
                <h3 class="font-bold text-lg text-white mb-1 truncate" title="${title}">${title}</h3>
                <div class="flex items-center space-x-2 mb-2">
                    <img src="${author.avatar}" alt="${authorName}" class="w-6 h-6 rounded-full" 
                         onerror="this.src='https://via.placeholder.com/24x24/666666/FFFFFF?text=?'">
                    <span class="text-sm text-gray-400">${authorName}</span>
                    ${author.verified ? '<i class="fas fa-check-circle text-blue-400 text-xs"></i>' : ''}
                </div>
                <p class="text-gray-400 text-sm mb-3 line-clamp-2" title="${description}">${description}</p>
                
                <div class="flex justify-between items-center mb-3">
                    <div class="flex items-center text-yellow-400">
                        <i class="fas fa-star mr-1"></i>
                        <span class="text-sm font-medium">${rating.toFixed(1)}</span>
                    </div>
                    <div class="flex items-center text-gray-400">
                        <i class="fas fa-download mr-1"></i>
                        <span class="text-sm">${this.formatNumber(downloads)}</span>
                    </div>
                    <div class="flex items-center text-gray-400">
                        <i class="fas fa-play mr-1"></i>
                        <span class="text-sm">${this.formatNumber(plays)}</span>
                    </div>
                </div>
                
                <div class="flex flex-wrap gap-1 mb-3">
                    ${tags.slice(0, 3).map(tag => 
                        `<span class="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">${tag}</span>`
                    ).join('')}
                    ${tags.length > 3 ? `<span class="text-xs text-gray-500">+${tags.length - 3} more</span>` : ''}
                </div>
                
                <div class="flex space-x-2">
                    <button class="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition play-game-btn" data-game-id="${game.id}">
                        <i class="fas fa-play mr-1"></i>Play
                    </button>
                    <button class="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-sm transition view-details-btn" data-game-id="${game.id}">
                        <i class="fas fa-info-circle"></i>
                    </button>
                    <button class="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-sm transition favorite-btn" data-game-id="${game.id}">
                        <i class="far fa-heart"></i>
                    </button>
                </div>
            </div>
        `;
        
        // Add event listeners with error handling
        try {
            const playBtn = card.querySelector('.play-game-btn');
            const detailsBtn = card.querySelector('.view-details-btn');
            const favoriteBtn = card.querySelector('.favorite-btn');
            
            if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.playGame(game.id);
                });
            }
            
            if (detailsBtn) {
                detailsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showGameDetails(game.id);
                });
            }
            
            if (favoriteBtn) {
                // Set initial favorite state
                if (this.isFavorited(game.id)) {
                    favoriteBtn.innerHTML = '<i class="fas fa-heart text-red-500"></i>';
                    favoriteBtn.title = 'Remove from favorites';
                } else {
                    favoriteBtn.innerHTML = '<i class="far fa-heart"></i>';
                    favoriteBtn.title = 'Add to favorites';
                }
                
                favoriteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleFavorite(game.id);
                });
            }
            
            card.addEventListener('click', () => {
                this.showGameDetails(game.id);
            });
            
        } catch (error) {
            console.error('Error adding event listeners to game card:', error);
        }
        
        return card;
    }

    /**
     * Format numbers for display
     */
    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    /**
     * Set view mode (grid or list)
     */
    setViewMode(mode) {
        const gridBtn = document.getElementById('gridViewBtn');
        const listBtn = document.getElementById('listViewBtn');
        const container = document.getElementById('gamesGrid');
        
        if (mode === 'grid') {
            gridBtn.className = 'p-2 bg-purple-600 text-white rounded-lg';
            listBtn.className = 'p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600';
            container.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6';
        } else {
            listBtn.className = 'p-2 bg-purple-600 text-white rounded-lg';
            gridBtn.className = 'p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600';
            container.className = 'space-y-4';
        }
        
        this.displayGames();
    }

    /**
     * Play a game
     */
    playGame(gameId) {
        const game = this.games.get(gameId);
        if (!game) {
            console.error('Game not found:', gameId);
            if (window.showErrorNotification) {
                window.showErrorNotification('Game not found', 'The selected game could not be loaded');
            }
            return;
        }
        
        try {
            // Increment play count
            game.plays = (game.plays || 0) + 1;
            
            // Create game data for player
            const gameData = {
                name: game.title || 'Untitled Game',
                type: (game.category || 'action').toLowerCase(),
                engine: (game.engine || 'html5').toLowerCase(),
                originalGame: game.title || 'Untitled Game',
                description: game.description || 'No description available',
                customizations: game.customizations || {}
            };
            
            // Launch game player
            if (window.gamePlayer) {
                this.hideMarketplace();
                window.gamePlayer.loadGame(gameData, { id: gameId, name: game.title });
                
                if (window.showSuccessNotification) {
                    window.showSuccessNotification('Loading Game', `Starting ${game.title}...`);
                }
            } else {
                console.error('Game player not available');
                if (window.showErrorNotification) {
                    window.showErrorNotification('Game Player Unavailable', 'The game player is not loaded. Please refresh the page.');
                } else {
                    alert('Game player not available. Please refresh the page and try again.');
                }
            }
            
            console.log('🎮 Playing game:', game.title);
            
        } catch (error) {
            console.error('Error launching game:', error);
            if (window.showErrorNotification) {
                window.showErrorNotification('Launch Error', 'Failed to start the game');
            }
        }
    }

    /**
     * Show game details
     */
    showGameDetails(gameId) {
        const game = this.games.get(gameId);
        if (!game) return;
        
        const author = this.users.get(game.authorId);
        
        // Create game details modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-60 bg-black bg-opacity-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-xl max-w-4xl w-full max-h-screen overflow-y-auto">
                <div class="p-6">
                    <div class="flex justify-between items-start mb-6">
                        <h2 class="text-2xl font-bold text-white">${game.title}</h2>
                        <button class="close-modal text-gray-400 hover:text-white">
                            <i class="fas fa-times text-2xl"></i>
                        </button>
                    </div>
                    
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <!-- Screenshots -->
                        <div>
                            <img src="${game.screenshots[0]}" alt="Screenshot" class="w-full rounded-lg mb-4">
                            <div class="grid grid-cols-3 gap-2">
                                ${game.screenshots.slice(1).map(screenshot => 
                                    `<img src="${screenshot}" alt="Screenshot" class="w-full rounded-lg cursor-pointer hover:opacity-80 transition">`
                                ).join('')}
                            </div>
                        </div>
                        
                        <!-- Game Info -->
                        <div>
                            <div class="flex items-center space-x-3 mb-4">
                                <img src="${author?.avatar}" alt="${game.author}" class="w-12 h-12 rounded-full">
                                <div>
                                    <p class="font-medium text-white">${game.author}</p>
                                    <p class="text-sm text-gray-400">Game Developer</p>
                                </div>
                                ${author?.verified ? '<i class="fas fa-check-circle text-blue-400"></i>' : ''}
                            </div>
                            
                            <p class="text-gray-300 mb-4">${game.description}</p>
                            
                            <div class="grid grid-cols-2 gap-4 mb-4">
                                <div class="bg-gray-700 p-3 rounded-lg">
                                    <p class="text-sm text-gray-400">Rating</p>
                                    <p class="text-xl font-bold text-yellow-400">${game.rating}/5</p>
                                </div>
                                <div class="bg-gray-700 p-3 rounded-lg">
                                    <p class="text-sm text-gray-400">Downloads</p>
                                    <p class="text-xl font-bold text-white">${this.formatNumber(game.downloads)}</p>
                                </div>
                                <div class="bg-gray-700 p-3 rounded-lg">
                                    <p class="text-sm text-gray-400">Category</p>
                                    <p class="text-xl font-bold text-white">${game.category}</p>
                                </div>
                                <div class="bg-gray-700 p-3 rounded-lg">
                                    <p class="text-sm text-gray-400">Price</p>
                                    <p class="text-xl font-bold ${game.price === 'Free' ? 'text-green-400' : 'text-yellow-400'}">${game.price}</p>
                                </div>
                            </div>
                            
                            <div class="mb-4">
                                <h3 class="font-bold text-white mb-2">Features</h3>
                                <div class="flex flex-wrap gap-2">
                                    ${game.features.map(feature => 
                                        `<span class="bg-purple-600 text-white text-sm px-3 py-1 rounded-full">${feature}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            
                            <div class="mb-6">
                                <h3 class="font-bold text-white mb-2">Tags</h3>
                                <div class="flex flex-wrap gap-2">
                                    ${game.tags.map(tag => 
                                        `<span class="bg-gray-700 text-gray-300 text-sm px-3 py-1 rounded-full">${tag}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            
                            <div class="flex space-x-3">
                                <button class="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium transition play-modal-btn">
                                    <i class="fas fa-play mr-2"></i>Play Game
                                </button>
                                <button class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition">
                                    <i class="fas fa-download mr-2"></i>Download
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add event listeners
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.querySelector('.play-modal-btn').addEventListener('click', () => {
            modal.remove();
            this.playGame(gameId);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    }

    /**
     * Show marketplace
     */
    showMarketplace() {
        document.getElementById('marketplacePanel').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide marketplace
     */
    hideMarketplace() {
        document.getElementById('marketplacePanel').classList.add('hidden');
        document.body.style.overflow = 'auto';
    }

    /**
     * Toggle favorite status
     */
    toggleFavorite(gameId) {
        try {
            const game = this.games.get(gameId);
            if (!game) {
                console.error('Game not found for favoriting:', gameId);
                return;
            }

            // Initialize favorites in localStorage if not exists
            let favorites = [];
            try {
                favorites = JSON.parse(localStorage.getItem('gameMarketplaceFavorites') || '[]');
            } catch (error) {
                console.error('Error parsing favorites from localStorage:', error);
                favorites = [];
            }

            const isFavorited = favorites.includes(gameId);
            
            if (isFavorited) {
                // Remove from favorites
                favorites = favorites.filter(id => id !== gameId);
                localStorage.setItem('gameMarketplaceFavorites', JSON.stringify(favorites));
                
                // Update UI
                const favoriteBtn = document.querySelector(`[data-game-id="${gameId}"] .favorite-btn`);
                if (favoriteBtn) {
                    favoriteBtn.innerHTML = '<i class="far fa-heart"></i>';
                    favoriteBtn.title = 'Add to favorites';
                }
                
                if (window.showInfoNotification) {
                    window.showInfoNotification('Removed from Favorites', `${game.title} removed from your favorites`);
                }
            } else {
                // Add to favorites
                favorites.push(gameId);
                localStorage.setItem('gameMarketplaceFavorites', JSON.stringify(favorites));
                
                // Update UI
                const favoriteBtn = document.querySelector(`[data-game-id="${gameId}"] .favorite-btn`);
                if (favoriteBtn) {
                    favoriteBtn.innerHTML = '<i class="fas fa-heart text-red-500"></i>';
                    favoriteBtn.title = 'Remove from favorites';
                }
                
                if (window.showSuccessNotification) {
                    window.showSuccessNotification('Added to Favorites', `${game.title} added to your favorites`);
                }
            }
            
            console.log('🎯 Toggled favorite for game:', game.title, 'Now favorited:', !isFavorited);
            
        } catch (error) {
            console.error('Error toggling favorite:', error);
            if (window.showErrorNotification) {
                window.showErrorNotification('Favorite Error', 'Failed to update favorite status');
            }
        }
    }

    /**
     * Check if a game is favorited
     */
    isFavorited(gameId) {
        try {
            const favorites = JSON.parse(localStorage.getItem('gameMarketplaceFavorites') || '[]');
            return favorites.includes(gameId);
        } catch (error) {
            console.error('Error checking favorite status:', error);
            return false;
        }
    }

    /**
     * Update favorite button states on page load
     */
    updateFavoriteButtons() {
        try {
            const favorites = JSON.parse(localStorage.getItem('gameMarketplaceFavorites') || '[]');
            
            favorites.forEach(gameId => {
                const favoriteBtn = document.querySelector(`[data-game-id="${gameId}"] .favorite-btn`);
                if (favoriteBtn) {
                    favoriteBtn.innerHTML = '<i class="fas fa-heart text-red-500"></i>';
                    favoriteBtn.title = 'Remove from favorites';
                }
            });
        } catch (error) {
            console.error('Error updating favorite buttons:', error);
        }
    }

    /**
     * Show creator profile
     */
    showCreatorProfile(userId) {
        console.log('Show creator profile:', userId);
        // Implementation for showing creator profiles
    }

    /**
     * Show publish dialog
     */
    showPublishDialog() {
        console.log('Show publish dialog');
        // Implementation for publishing games
    }

    /**
     * Show my games
     */
    showMyGames() {
        console.log('Show my games');
        // Implementation for showing user's games
    }

    /**
     * Show profile
     */
    showProfile() {
        console.log('Show profile');
        // Implementation for showing user profile
    }

    /**
     * Load more games (pagination)
     */
    loadMoreGames() {
        console.log('Loading more games...');
        // For now, just show a message since we have limited sample data
        if (window.showInfoNotification) {
            window.showInfoNotification('No more games', 'All available games are already displayed');
        }
    }

    /**
     * Update results title based on current filter
     */
    updateResultsTitle() {
        const titleElement = document.getElementById('resultsTitle');
        if (!titleElement) return;

        let title = 'Popular Games';
        if (this.currentFilter.category !== 'All') {
            title = `${this.currentFilter.category} Games`;
        }
        if (this.currentFilter.search) {
            title = `Search: "${this.currentFilter.search}"`;
        }
        if (this.currentFilter.sort !== 'Popular') {
            title = `${this.currentFilter.sort} Games`;
        }
        
        titleElement.textContent = title;
    }
}
}