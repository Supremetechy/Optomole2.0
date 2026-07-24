/**
 * Blockchain NFT Integration - NFT game assets and blockchain features
 */

class BlockchainNFTIntegration {
    constructor() {
        this.web3 = null;
        this.account = null;
        this.contracts = new Map();
        this.nftCollections = new Map();
        this.supportedChains = {
            ethereum: { id: 1, name: 'Ethereum', currency: 'ETH' },
            polygon: { id: 137, name: 'Polygon', currency: 'MATIC' },
            arbitrum: { id: 42161, name: 'Arbitrum', currency: 'ETH' },
            optimism: { id: 10, name: 'Optimism', currency: 'ETH' }
        };
        this.currentChain = 'polygon'; // Default to Polygon for lower fees
        this.nftMarketplace = {
            gameAssets: new Map(),
            userCollections: new Map(),
            tradingHistory: [],
            prices: new Map()
        };
        this.initializeBlockchain();
    }

    /**
     * Initialize blockchain connection
     */
    async initializeBlockchain() {
        console.log('🔗 Initializing Blockchain NFT Integration...');
        
        try {
            // Check if Web3 wallet is available
            if (typeof window.ethereum !== 'undefined') {
                await this.loadWeb3();
                await this.setupContracts();
                await this.loadNFTCollections();
                console.log('✅ Blockchain integration ready');
            } else {
                console.log('⚠️ No Web3 wallet detected - using demo mode');
                this.setupDemoMode();
            }
        } catch (error) {
            console.error('Blockchain initialization failed:', error);
            this.setupDemoMode();
        }
    }

    /**
     * Load Web3 and connect wallet
     */
    async loadWeb3() {
        if (window.ethereum) {
            this.web3 = new Web3(window.ethereum);
            
            // Request account access
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });
            
            this.account = accounts[0];
            console.log('🔐 Wallet connected:', this.account);
            
            // Listen for account changes
            window.ethereum.on('accountsChanged', (accounts) => {
                this.account = accounts[0];
                this.onAccountChanged();
            });
            
            // Listen for chain changes
            window.ethereum.on('chainChanged', (chainId) => {
                this.onChainChanged(chainId);
            });
        }
    }

    /**
     * Setup smart contracts
     */
    async setupContracts() {
        // Game Asset NFT Contract (ERC-721)
        const gameAssetContract = {
            address: '0x1234567890123456789012345678901234567890',
            abi: this.getGameAssetABI(),
            type: 'ERC721'
        };
        
        // Game Item NFT Contract (ERC-1155)
        const gameItemContract = {
            address: '0x0987654321098765432109876543210987654321',
            abi: this.getGameItemABI(),
            type: 'ERC1155'
        };
        
        // Marketplace Contract
        const marketplaceContract = {
            address: '0x1111222233334444555566667777888899990000',
            abi: this.getMarketplaceABI(),
            type: 'Marketplace'
        };
        
        this.contracts.set('gameAssets', gameAssetContract);
        this.contracts.set('gameItems', gameItemContract);
        this.contracts.set('marketplace', marketplaceContract);
    }

    /**
     * Load NFT collections and demo data
     */
    async loadNFTCollections() {
        // Create demo NFT collections
        this.createDemoNFTCollections();
        
        // Load user's NFTs if wallet connected
        if (this.account) {
            await this.loadUserNFTs();
        }
    }

    /**
     * Create demo NFT collections
     */
    createDemoNFTCollections() {
        const demoCollections = [
            {
                id: 'legendary_characters',
                name: 'Legendary Game Characters',
                description: 'Unique playable characters with special abilities',
                type: 'character',
                items: [
                    {
                        tokenId: '001',
                        name: 'Quantum Leap Hero',
                        description: 'A time-traveling hero with temporal abilities',
                        image: 'https://via.placeholder.com/400x400/4A90E2/FFFFFF?text=Quantum+Hero',
                        attributes: [
                            { trait_type: 'Power', value: 'Time Manipulation' },
                            { trait_type: 'Rarity', value: 'Legendary' },
                            { trait_type: 'Speed', value: 95 },
                            { trait_type: 'Magic', value: 88 },
                            { trait_type: 'Health', value: 92 }
                        ],
                        price: '0.5 ETH',
                        owned: false,
                        gameCompatible: ['Quantum Leap Runner', 'Time Warrior', 'Chrono Quest']
                    },
                    {
                        tokenId: '002',
                        name: 'Crystal Mind Mage',
                        description: 'A mystical puzzle solver with crystal powers',
                        image: 'https://via.placeholder.com/400x400/9B59B6/FFFFFF?text=Crystal+Mage',
                        attributes: [
                            { trait_type: 'Power', value: 'Crystal Resonance' },
                            { trait_type: 'Rarity', value: 'Epic' },
                            { trait_type: 'Intelligence', value: 98 },
                            { trait_type: 'Magic', value: 95 },
                            { trait_type: 'Wisdom', value: 90 }
                        ],
                        price: '0.3 ETH',
                        owned: true,
                        gameCompatible: ['Crystal Mind Palace', 'Puzzle Realms', 'Mind Games']
                    },
                    {
                        tokenId: '003',
                        name: 'Neon Speed Racer',
                        description: 'Cyberpunk racer with enhanced reflexes',
                        image: 'https://via.placeholder.com/400x400/E74C3C/FFFFFF?text=Neon+Racer',
                        attributes: [
                            { trait_type: 'Power', value: 'Cyber Enhancement' },
                            { trait_type: 'Rarity', value: 'Rare' },
                            { trait_type: 'Speed', value: 99 },
                            { trait_type: 'Tech', value: 94 },
                            { trait_type: 'Reflexes', value: 96 }
                        ],
                        price: '0.2 ETH',
                        owned: false,
                        gameCompatible: ['Neon Speed Circuit', 'Cyber Racers', 'Future Streets']
                    }
                ]
            },
            {
                id: 'magical_items',
                name: 'Magical Game Items',
                description: 'Powerful items and equipment for your games',
                type: 'item',
                items: [
                    {
                        tokenId: '101',
                        name: 'Temporal Sword',
                        description: 'A blade that can cut through time itself',
                        image: 'https://via.placeholder.com/300x300/FFD700/FFFFFF?text=Temporal+Sword',
                        attributes: [
                            { trait_type: 'Type', value: 'Weapon' },
                            { trait_type: 'Rarity', value: 'Legendary' },
                            { trait_type: 'Attack Power', value: 150 },
                            { trait_type: 'Special Effect', value: 'Time Slow' }
                        ],
                        price: '0.1 ETH',
                        owned: true,
                        gameCompatible: ['All Platformers', 'Action Games']
                    },
                    {
                        tokenId: '102',
                        name: 'Crystal of Wisdom',
                        description: 'Enhances puzzle-solving abilities',
                        image: 'https://via.placeholder.com/300x300/1ABC9C/FFFFFF?text=Wisdom+Crystal',
                        attributes: [
                            { trait_type: 'Type', value: 'Accessory' },
                            { trait_type: 'Rarity', value: 'Epic' },
                            { trait_type: 'Intelligence Boost', value: 25 },
                            { trait_type: 'Hint Generation', value: 'Unlimited' }
                        ],
                        price: '0.08 ETH',
                        owned: false,
                        gameCompatible: ['All Puzzle Games']
                    },
                    {
                        tokenId: '103',
                        name: 'Nitro Boost Engine',
                        description: 'Extreme speed enhancement for vehicles',
                        image: 'https://via.placeholder.com/300x300/FF6B6B/FFFFFF?text=Nitro+Engine',
                        attributes: [
                            { trait_type: 'Type', value: 'Vehicle Upgrade' },
                            { trait_type: 'Rarity', value: 'Rare' },
                            { trait_type: 'Speed Boost', value: 200 },
                            { trait_type: 'Duration', value: '10 seconds' }
                        ],
                        price: '0.05 ETH',
                        owned: true,
                        gameCompatible: ['All Racing Games']
                    }
                ]
            },
            {
                id: 'game_skins',
                name: 'Exclusive Game Skins',
                description: 'Cosmetic skins and themes for your games',
                type: 'cosmetic',
                items: [
                    {
                        tokenId: '201',
                        name: 'Cyberpunk Neon Theme',
                        description: 'Transform any game with cyberpunk aesthetics',
                        image: 'https://via.placeholder.com/350x200/FF1493/FFFFFF?text=Cyberpunk+Theme',
                        attributes: [
                            { trait_type: 'Type', value: 'Theme' },
                            { trait_type: 'Rarity', value: 'Epic' },
                            { trait_type: 'Color Scheme', value: 'Neon' },
                            { trait_type: 'Music Style', value: 'Synthwave' }
                        ],
                        price: '0.03 ETH',
                        owned: false,
                        gameCompatible: ['All Game Types']
                    },
                    {
                        tokenId: '202',
                        name: 'Retro Pixel Pack',
                        description: 'Classic 8-bit pixel art styling',
                        image: 'https://via.placeholder.com/350x200/8E44AD/FFFFFF?text=Retro+Pixel',
                        attributes: [
                            { trait_type: 'Type', value: 'Art Style' },
                            { trait_type: 'Rarity', value: 'Rare' },
                            { trait_type: 'Era', value: '8-bit' },
                            { trait_type: 'Nostalgia Factor', value: 'Maximum' }
                        ],
                        price: '0.02 ETH',
                        owned: true,
                        gameCompatible: ['2D Games', 'Platformers', 'Puzzle Games']
                    }
                ]
            }
        ];

        demoCollections.forEach(collection => {
            this.nftCollections.set(collection.id, collection);
        });
    }

    /**
     * Setup demo mode when no wallet is available
     */
    setupDemoMode() {
        console.log('🎭 Setting up NFT demo mode');
        this.account = '0xDemo1234567890123456789012345678901234567890';
        this.createDemoNFTCollections();
    }

    /**
     * Generate NFT marketplace UI
     */
    generateNFTMarketplaceUI() {
        return `
        <div id="nftMarketplacePanel" class="fixed inset-0 z-50 bg-gray-900 hidden">
            <!-- NFT Marketplace Header -->
            <div class="bg-gray-800 border-b border-gray-700 p-4">
                <div class="flex justify-between items-center">
                    <div class="flex items-center space-x-4">
                        <button id="backFromNFT" class="text-gray-400 hover:text-white transition">
                            <i class="fas fa-arrow-left text-xl"></i>
                        </button>
                        <div>
                            <h1 class="text-2xl font-bold text-white">
                                <i class="fas fa-gem mr-3 text-purple-500"></i>NFT Game Assets
                            </h1>
                            <p class="text-gray-400">Collect, trade, and use NFT assets in your games</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3">
                        <div id="walletStatus" class="bg-gray-700 px-4 py-2 rounded-lg">
                            <span class="text-sm text-gray-300">Wallet: </span>
                            <span id="walletAddress" class="text-sm text-green-400">Not Connected</span>
                        </div>
                        <button id="connectWallet" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition">
                            <i class="fas fa-wallet mr-2"></i>Connect Wallet
                        </button>
                        <button id="createNFT" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-medium transition">
                            <i class="fas fa-plus mr-2"></i>Create NFT
                        </button>
                    </div>
                </div>
            </div>

            <!-- NFT Content -->
            <div class="flex h-full">
                <!-- NFT Categories Sidebar -->
                <div class="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto">
                    <div class="p-6">
                        <!-- User's Collection -->
                        <div class="mb-6">
                            <h3 class="text-lg font-bold text-white mb-3">My Collection</h3>
                            <div class="bg-gray-700 rounded-lg p-4">
                                <div class="text-center">
                                    <i class="fas fa-gem text-3xl text-purple-500 mb-2"></i>
                                    <p class="text-white font-bold" id="userNFTCount">0</p>
                                    <p class="text-gray-400 text-sm">NFTs Owned</p>
                                </div>
                            </div>
                        </div>

                        <!-- Categories -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-3">Categories</label>
                            <div id="nftCategories" class="space-y-2">
                                <button class="nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-purple-600 text-white" data-category="all">
                                    <i class="fas fa-th mr-2"></i>All Assets
                                </button>
                                <button class="nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="character">
                                    <i class="fas fa-user mr-2"></i>Characters
                                </button>
                                <button class="nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="item">
                                    <i class="fas fa-sword mr-2"></i>Items & Weapons
                                </button>
                                <button class="nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="cosmetic">
                                    <i class="fas fa-palette mr-2"></i>Skins & Themes
                                </button>
                                <button class="nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="owned">
                                    <i class="fas fa-star mr-2"></i>My NFTs
                                </button>
                            </div>
                        </div>

                        <!-- Price Range -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-3">Price Range (ETH)</label>
                            <div class="space-y-3">
                                <div class="flex space-x-2">
                                    <input type="number" id="minPrice" placeholder="Min" step="0.01" 
                                           class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                                    <input type="number" id="maxPrice" placeholder="Max" step="0.01"
                                           class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                                </div>
                                <button id="applyPriceFilter" class="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm transition">
                                    Apply Filter
                                </button>
                            </div>
                        </div>

                        <!-- Rarity Filter -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-white mb-3">Rarity</label>
                            <div class="space-y-2">
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" class="rarity-filter mr-2" value="Common">
                                    <span class="text-gray-400">Common</span>
                                </label>
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" class="rarity-filter mr-2" value="Rare">
                                    <span class="text-blue-400">Rare</span>
                                </label>
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" class="rarity-filter mr-2" value="Epic">
                                    <span class="text-purple-400">Epic</span>
                                </label>
                                <label class="flex items-center text-sm text-gray-300">
                                    <input type="checkbox" class="rarity-filter mr-2" value="Legendary">
                                    <span class="text-yellow-400">Legendary</span>
                                </label>
                            </div>
                        </div>

                        <!-- Blockchain Info -->
                        <div class="bg-gray-700 rounded-lg p-4">
                            <h4 class="text-white font-bold mb-2">Blockchain Info</h4>
                            <div class="space-y-2 text-sm">
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Network:</span>
                                    <span id="currentNetwork" class="text-purple-400">Polygon</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Gas Fee:</span>
                                    <span class="text-green-400">~$0.01</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Total NFTs:</span>
                                    <span class="text-white" id="totalNFTCount">0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Main NFT Display Area -->
                <div class="flex-1 overflow-y-auto">
                    <div class="p-6">
                        <!-- Search and Sort -->
                        <div class="flex justify-between items-center mb-6">
                            <div class="flex-1 mr-4">
                                <input type="text" id="nftSearch" placeholder="Search NFTs by name, creator, or attributes..." 
                                       class="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                            </div>
                            <select id="nftSort" class="bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="price_low">Price: Low to High</option>
                                <option value="price_high">Price: High to Low</option>
                                <option value="rarity">Rarity</option>
                            </select>
                        </div>

                        <!-- NFT Grid -->
                        <div id="nftGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                            <!-- NFTs will be populated here -->
                        </div>

                        <!-- Load More -->
                        <div class="text-center mt-8">
                            <button id="loadMoreNFTs" class="bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg text-white font-medium transition">
                                Load More NFTs
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Initialize NFT marketplace UI
     */
    initializeNFTMarketplaceUI() {
        document.body.insertAdjacentHTML('beforeend', this.generateNFTMarketplaceUI());
        this.setupNFTEventListeners();
        this.updateWalletDisplay();
        this.displayNFTs();
    }

    /**
     * Setup NFT marketplace event listeners
     */
    setupNFTEventListeners() {
        // Navigation
        document.getElementById('backFromNFT').addEventListener('click', () => {
            this.hideNFTMarketplace();
        });

        // Wallet connection
        document.getElementById('connectWallet').addEventListener('click', () => {
            this.connectWallet();
        });

        // Category filters
        document.querySelectorAll('.nft-category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectNFTCategory(e.target.dataset.category);
            });
        });

        // Search and sort
        document.getElementById('nftSearch').addEventListener('input', () => {
            this.displayNFTs();
        });

        document.getElementById('nftSort').addEventListener('change', () => {
            this.displayNFTs();
        });

        // Price filter
        document.getElementById('applyPriceFilter').addEventListener('click', () => {
            this.displayNFTs();
        });

        // Rarity filters
        document.querySelectorAll('.rarity-filter').forEach(filter => {
            filter.addEventListener('change', () => {
                this.displayNFTs();
            });
        });

        // Create NFT
        document.getElementById('createNFT').addEventListener('click', () => {
            this.showCreateNFTDialog();
        });
    }

    /**
     * Connect wallet
     */
    async connectWallet() {
        try {
            if (typeof window.ethereum !== 'undefined') {
                await this.loadWeb3();
                this.updateWalletDisplay();
                await this.loadUserNFTs();
                this.displayNFTs();
            } else {
                alert('Please install MetaMask or another Web3 wallet to connect.');
            }
        } catch (error) {
            console.error('Wallet connection failed:', error);
        }
    }

    /**
     * Update wallet display
     */
    updateWalletDisplay() {
        const walletAddress = document.getElementById('walletAddress');
        const connectBtn = document.getElementById('connectWallet');
        
        if (this.account) {
            walletAddress.textContent = this.account.substring(0, 6) + '...' + this.account.substring(38);
            walletAddress.className = 'text-sm text-green-400';
            connectBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Connected';
            connectBtn.className = 'bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-medium transition';
        } else {
            walletAddress.textContent = 'Not Connected';
            walletAddress.className = 'text-sm text-red-400';
        }
    }

    /**
     * Display NFTs in the marketplace
     */
    displayNFTs() {
        const container = document.getElementById('nftGrid');
        const allNFTs = this.getAllNFTs();
        const filteredNFTs = this.filterNFTs(allNFTs);
        const sortedNFTs = this.sortNFTs(filteredNFTs);
        
        container.innerHTML = '';
        
        if (sortedNFTs.length === 0) {
            container.innerHTML = `
                <div class="col-span-full text-center py-12">
                    <i class="fas fa-gem text-4xl text-gray-500 mb-4"></i>
                    <h3 class="text-xl font-bold text-white mb-2">No NFTs found</h3>
                    <p class="text-gray-400">Try adjusting your filters or search terms</p>
                </div>
            `;
            return;
        }
        
        sortedNFTs.forEach(nft => {
            const nftCard = this.createNFTCard(nft);
            container.appendChild(nftCard);
        });
        
        // Update counts
        document.getElementById('totalNFTCount').textContent = allNFTs.length;
        document.getElementById('userNFTCount').textContent = allNFTs.filter(nft => nft.owned).length;
    }

    /**
     * Get all NFTs from collections
     */
    getAllNFTs() {
        const allNFTs = [];
        this.nftCollections.forEach(collection => {
            collection.items.forEach(item => {
                allNFTs.push({
                    ...item,
                    collection: collection.name,
                    collectionType: collection.type
                });
            });
        });
        return allNFTs;
    }

    /**
     * Show NFT marketplace
     */
    showNFTMarketplace() {
        document.getElementById('nftMarketplacePanel').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide NFT marketplace
     */
    hideNFTMarketplace() {
        document.getElementById('nftMarketplacePanel').classList.add('hidden');
        document.body.style.overflow = 'auto';
    }

    /**
     * Filter NFTs based on current criteria
     */
    filterNFTs(nfts) {
        let filtered = [...nfts];
        
        // Category filter
        const activeCategory = document.querySelector('.nft-category-btn.bg-purple-600')?.dataset.category;
        if (activeCategory && activeCategory !== 'all') {
            if (activeCategory === 'owned') {
                filtered = filtered.filter(nft => nft.owned);
            } else {
                filtered = filtered.filter(nft => nft.collectionType === activeCategory);
            }
        }
        
        // Search filter
        const searchTerm = document.getElementById('nftSearch')?.value.toLowerCase();
        if (searchTerm) {
            filtered = filtered.filter(nft =>
                nft.name.toLowerCase().includes(searchTerm) ||
                nft.description.toLowerCase().includes(searchTerm) ||
                nft.attributes.some(attr => 
                    attr.trait_type.toLowerCase().includes(searchTerm) ||
                    attr.value.toString().toLowerCase().includes(searchTerm)
                )
            );
        }
        
        // Price filter
        const minPrice = parseFloat(document.getElementById('minPrice')?.value || 0);
        const maxPrice = parseFloat(document.getElementById('maxPrice')?.value || Infinity);
        filtered = filtered.filter(nft => {
            const price = parseFloat(nft.price.split(' ')[0]);
            return price >= minPrice && price <= maxPrice;
        });
        
        // Rarity filter
        const selectedRarities = Array.from(document.querySelectorAll('.rarity-filter:checked'))
            .map(cb => cb.value);
        if (selectedRarities.length > 0) {
            filtered = filtered.filter(nft =>
                selectedRarities.some(rarity =>
                    nft.attributes.some(attr => 
                        attr.trait_type === 'Rarity' && attr.value === rarity
                    )
                )
            );
        }
        
        return filtered;
    }

    /**
     * Sort NFTs based on selected criteria
     */
    sortNFTs(nfts) {
        const sortBy = document.getElementById('nftSort')?.value || 'newest';
        
        switch (sortBy) {
            case 'price_low':
                return nfts.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
            case 'price_high':
                return nfts.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
            case 'rarity':
                const rarityOrder = { 'Common': 1, 'Rare': 2, 'Epic': 3, 'Legendary': 4 };
                return nfts.sort((a, b) => {
                    const aRarity = a.attributes.find(attr => attr.trait_type === 'Rarity')?.value || 'Common';
                    const bRarity = b.attributes.find(attr => attr.trait_type === 'Rarity')?.value || 'Common';
                    return (rarityOrder[bRarity] || 0) - (rarityOrder[aRarity] || 0);
                });
            case 'oldest':
                return nfts.sort((a, b) => parseInt(a.tokenId) - parseInt(b.tokenId));
            case 'newest':
            default:
                return nfts.sort((a, b) => parseInt(b.tokenId) - parseInt(a.tokenId));
        }
    }

    /**
     * Create NFT card element
     */
    createNFTCard(nft) {
        const card = document.createElement('div');
        card.className = 'nft-card bg-gray-800 rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition duration-300 cursor-pointer border border-gray-700';
        
        const rarity = nft.attributes.find(attr => attr.trait_type === 'Rarity')?.value || 'Common';
        const rarityColors = {
            'Common': 'border-gray-500',
            'Rare': 'border-blue-500',
            'Epic': 'border-purple-500',
            'Legendary': 'border-yellow-500'
        };
        
        card.classList.add(rarityColors[rarity]);
        
        card.innerHTML = `
            <div class="relative">
                <img src="${nft.image}" alt="${nft.name}" class="w-full h-48 object-cover">
                <div class="absolute top-3 left-3">
                    <span class="bg-${rarity === 'Legendary' ? 'yellow' : rarity === 'Epic' ? 'purple' : rarity === 'Rare' ? 'blue' : 'gray'}-600 text-white text-xs px-2 py-1 rounded-full">
                        ${rarity}
                    </span>
                </div>
                <div class="absolute top-3 right-3">
                    ${nft.owned ? 
                        '<span class="bg-green-600 text-white text-xs px-2 py-1 rounded-full">Owned</span>' : 
                        `<span class="bg-gray-900 bg-opacity-80 text-white text-xs px-2 py-1 rounded-full">${nft.price}</span>`
                    }
                </div>
                <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-70"></div>
            </div>
            
            <div class="p-4">
                <h3 class="font-bold text-lg text-white mb-1 truncate">${nft.name}</h3>
                <p class="text-gray-400 text-sm mb-3 line-clamp-2">${nft.description}</p>
                
                <div class="mb-3">
                    <h4 class="text-sm font-medium text-gray-300 mb-2">Attributes</h4>
                    <div class="flex flex-wrap gap-1">
                        ${nft.attributes.slice(0, 3).map(attr => 
                            `<span class="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded" title="${attr.trait_type}: ${attr.value}">
                                ${attr.trait_type}: ${attr.value}
                            </span>`
                        ).join('')}
                    </div>
                </div>
                
                <div class="mb-3">
                    <h4 class="text-sm font-medium text-gray-300 mb-1">Compatible Games</h4>
                    <div class="text-xs text-blue-400">
                        ${nft.gameCompatible.slice(0, 2).join(', ')}
                        ${nft.gameCompatible.length > 2 ? ` +${nft.gameCompatible.length - 2} more` : ''}
                    </div>
                </div>
                
                <div class="flex space-x-2">
                    ${nft.owned ? `
                        <button class="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition use-nft-btn" data-nft-id="${nft.tokenId}">
                            <i class="fas fa-gamepad mr-1"></i>Use in Game
                        </button>
                        <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm transition trade-nft-btn" data-nft-id="${nft.tokenId}">
                            <i class="fas fa-exchange-alt"></i>
                        </button>
                    ` : `
                        <button class="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition buy-nft-btn" data-nft-id="${nft.tokenId}">
                            <i class="fas fa-shopping-cart mr-1"></i>Buy Now
                        </button>
                    `}
                    <button class="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-sm transition view-nft-btn" data-nft-id="${nft.tokenId}">
                        <i class="fas fa-info-circle"></i>
                    </button>
                </div>
            </div>
        `;
        
        // Add event listeners
        card.querySelector('.view-nft-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showNFTDetails(nft.tokenId);
        });
        
        if (nft.owned) {
            card.querySelector('.use-nft-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.useNFTInGame(nft.tokenId);
            });
            
            card.querySelector('.trade-nft-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.tradeNFT(nft.tokenId);
            });
        } else {
            card.querySelector('.buy-nft-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.buyNFT(nft.tokenId);
            });
        }
        
        card.addEventListener('click', () => {
            this.showNFTDetails(nft.tokenId);
        });
        
        return card;
    }

    /**
     * Select NFT category
     */
    selectNFTCategory(category) {
        document.querySelectorAll('.nft-category-btn').forEach(btn => {
            if (btn.dataset.category === category) {
                btn.className = 'nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-purple-600 text-white';
            } else {
                btn.className = 'nft-category-btn w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300';
            }
        });
        
        this.displayNFTs();
    }

    /**
     * Show NFT details modal
     */
    showNFTDetails(tokenId) {
        const nft = this.findNFTByTokenId(tokenId);
        if (!nft) return;
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-60 bg-black bg-opacity-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-xl max-w-4xl w-full max-h-screen overflow-y-auto">
                <div class="p-6">
                    <div class="flex justify-between items-start mb-6">
                        <h2 class="text-2xl font-bold text-white">${nft.name}</h2>
                        <button class="close-nft-modal text-gray-400 hover:text-white">
                            <i class="fas fa-times text-2xl"></i>
                        </button>
                    </div>
                    
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div>
                            <img src="${nft.image}" alt="${nft.name}" class="w-full rounded-lg mb-4">
                            <div class="bg-gray-700 rounded-lg p-4">
                                <h3 class="font-bold text-white mb-2">Blockchain Details</h3>
                                <div class="space-y-2 text-sm">
                                    <div class="flex justify-between">
                                        <span class="text-gray-400">Token ID:</span>
                                        <span class="text-white">#${nft.tokenId}</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-gray-400">Contract:</span>
                                        <span class="text-blue-400">0x1234...5678</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-gray-400">Standard:</span>
                                        <span class="text-white">ERC-721</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-gray-400">Network:</span>
                                        <span class="text-purple-400">Polygon</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <p class="text-gray-300 mb-4">${nft.description}</p>
                            
                            <div class="mb-4">
                                <h3 class="font-bold text-white mb-2">Attributes</h3>
                                <div class="grid grid-cols-2 gap-2">
                                    ${nft.attributes.map(attr => `
                                        <div class="bg-gray-700 p-3 rounded-lg">
                                            <p class="text-gray-400 text-sm">${attr.trait_type}</p>
                                            <p class="text-white font-bold">${attr.value}</p>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            
                            <div class="mb-6">
                                <h3 class="font-bold text-white mb-2">Compatible Games</h3>
                                <div class="flex flex-wrap gap-2">
                                    ${nft.gameCompatible.map(game => 
                                        `<span class="bg-blue-600 text-white text-sm px-3 py-1 rounded-full">${game}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            
                            <div class="flex space-x-3">
                                ${nft.owned ? `
                                    <button class="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition">
                                        <i class="fas fa-gamepad mr-2"></i>Use in Game
                                    </button>
                                    <button class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition">
                                        <i class="fas fa-exchange-alt mr-2"></i>Trade
                                    </button>
                                ` : `
                                    <button class="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium transition">
                                        <i class="fas fa-shopping-cart mr-2"></i>Buy for ${nft.price}
                                    </button>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        modal.querySelector('.close-nft-modal').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    }

    /**
     * Find NFT by token ID
     */
    findNFTByTokenId(tokenId) {
        const allNFTs = this.getAllNFTs();
        return allNFTs.find(nft => nft.tokenId === tokenId);
    }

    /**
     * Use NFT in game
     */
    useNFTInGame(tokenId) {
        const nft = this.findNFTByTokenId(tokenId);
        if (!nft) return;
        
        // Apply NFT effects to current game
        if (window.gamePlayer && window.gamePlayer.currentGame) {
            this.applyNFTToGame(nft);
            this.hideNFTMarketplace();
            
            if (window.showSuccessNotification) {
                window.showSuccessNotification(
                    `${nft.name} equipped!`,
                    'NFT effects applied to your game'
                );
            }
        } else {
            alert('Start a game first to use this NFT!');
        }
    }

    /**
     * Apply NFT effects to game
     */
    applyNFTToGame(nft) {
        console.log('🎮 Applying NFT effects:', nft.name);
        
        // Example NFT effect applications
        if (nft.collectionType === 'character') {
            // Apply character enhancements
            nft.attributes.forEach(attr => {
                switch (attr.trait_type) {
                    case 'Speed':
                        if (window.gamePlayer.gameState?.player) {
                            window.gamePlayer.gameState.player.speed *= (1 + attr.value / 100);
                        }
                        break;
                    case 'Magic':
                        // Apply magic effects
                        break;
                }
            });
        } else if (nft.collectionType === 'item') {
            // Apply item effects
            if (nft.name === 'Temporal Sword') {
                // Add time slow ability
                console.log('⚔️ Temporal Sword equipped - Time powers activated');
            }
        } else if (nft.collectionType === 'cosmetic') {
            // Apply visual themes
            if (nft.name === 'Cyberpunk Neon Theme') {
                // Change game visual style
                console.log('🌈 Cyberpunk theme applied');
            }
        }
    }

    /**
     * Buy NFT
     */
    async buyNFT(tokenId) {
        const nft = this.findNFTByTokenId(tokenId);
        if (!nft || !this.account) return;
        
        const confirmation = confirm(`Buy ${nft.name} for ${nft.price}?`);
        if (!confirmation) return;
        
        try {
            // Simulate blockchain transaction
            console.log('💰 Processing NFT purchase...');
            
            // Update ownership
            nft.owned = true;
            
            // Refresh display
            this.displayNFTs();
            
            if (window.showSuccessNotification) {
                window.showSuccessNotification(
                    'NFT Purchased!',
                    `${nft.name} is now in your collection`
                );
            }
        } catch (error) {
            console.error('NFT purchase failed:', error);
            if (window.showErrorNotification) {
                window.showErrorNotification('Purchase Failed', error.message);
            }
        }
    }

    /**
     * Trade NFT
     */
    tradeNFT(tokenId) {
        console.log('🔄 Trading NFT:', tokenId);
        // Implementation for NFT trading
    }

    /**
     * Show create NFT dialog
     */
    showCreateNFTDialog() {
        console.log('🎨 Show create NFT dialog');
        // Implementation for creating new NFTs
    }

    /**
     * Load user's NFTs from blockchain
     */
    async loadUserNFTs() {
        if (!this.account) return;
        
        console.log('📦 Loading user NFTs from blockchain...');
        // Implementation for loading actual NFTs from blockchain
    }

    /**
     * Handle account change
     */
    onAccountChanged() {
        console.log('👤 Account changed:', this.account);
        this.updateWalletDisplay();
        this.loadUserNFTs();
        this.displayNFTs();
    }

    /**
     * Handle chain change
     */
    onChainChanged(chainId) {
        console.log('🔗 Chain changed:', chainId);
        // Update UI to reflect new chain
    }

    // Placeholder smart contract ABIs
    getGameAssetABI() {
        return [
            {
                "inputs": [{"name": "to", "type": "address"}, {"name": "tokenId", "type": "uint256"}],
                "name": "mint",
                "outputs": [],
                "type": "function"
            }
        ];
    }

    getGameItemABI() {
        return [
            {
                "inputs": [{"name": "account", "type": "address"}, {"name": "id", "type": "uint256"}],
                "name": "balanceOf",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function"
            }
        ];
    }

    getMarketplaceABI() {
        return [
            {
                "inputs": [{"name": "tokenId", "type": "uint256"}, {"name": "price", "type": "uint256"}],
                "name": "listItem",
                "outputs": [],
                "type": "function"
            }
        ];
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BlockchainNFTIntegration;
} else {
    window.BlockchainNFTIntegration = BlockchainNFTIntegration;
}