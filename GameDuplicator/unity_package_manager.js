/**
 * Unity Package Manager Integration - Manage Unity packages and dependencies
 */

class UnityPackageManager {
    constructor() {
        this.packageRegistry = new Map();
        this.installedPackages = new Map();
        this.dependencyGraph = new Map();
        this.packageSources = {
            unity: 'packages.unity.com',
            npmjs: 'npmjs.com',
            github: 'github.com',
            custom: 'custom'
        };
        this.initializeBuiltInPackages();
    }

    /**
     * Initialize built-in Unity packages
     */
    initializeBuiltInPackages() {
        const builtInPackages = [
            {
                name: 'com.unity.2d.animation',
                displayName: '2D Animation',
                version: '9.0.4',
                description: '2D Animation provides all the necessary tooling and runtime components for skeletal animation using Sprites.',
                category: '2D',
                keywords: ['2d', 'animation', 'skeletal', 'sprite'],
                unity: '2022.3',
                dependencies: {
                    'com.unity.2d.common': '8.0.2',
                    'com.unity.2d.sprite': '1.0.0',
                    'com.unity.modules.animation': '1.0.0'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/2d-animation.git'
                },
                recommended: true
            },
            {
                name: 'com.unity.inputsystem',
                displayName: 'Input System',
                version: '1.7.0',
                description: 'A new input system which can be used as a more extensible and customizable alternative to Unity\'s classic input system.',
                category: 'Input',
                keywords: ['input', 'controls', 'gamepad', 'keyboard', 'mouse'],
                unity: '2019.4',
                dependencies: {
                    'com.unity.modules.uielements': '1.0.0'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/InputSystem.git'
                },
                recommended: true
            },
            {
                name: 'com.unity.render-pipelines.universal',
                displayName: 'Universal RP',
                version: '14.0.9',
                description: 'The Universal Render Pipeline (URP) is a Scriptable Render Pipeline that is quick and easy to customize.',
                category: 'Rendering',
                keywords: ['urp', 'rendering', 'pipeline', 'graphics'],
                unity: '2022.3',
                dependencies: {
                    'com.unity.render-pipelines.core': '14.0.9',
                    'com.unity.shadergraph': '14.0.9'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/Graphics.git'
                },
                recommended: true
            },
            {
                name: 'com.unity.textmeshpro',
                displayName: 'TextMeshPro',
                version: '3.0.6',
                description: 'TextMeshPro is the ultimate text solution for Unity.',
                category: 'UI',
                keywords: ['text', 'ui', 'font', 'typography'],
                unity: '2019.4',
                dependencies: {
                    'com.unity.ugui': '1.0.0'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/TextMeshPro.git'
                },
                recommended: true
            },
            {
                name: 'com.unity.timeline',
                displayName: 'Timeline',
                version: '1.7.6',
                description: 'Use Unity Timeline to create cinematic content, game-play sequences, audio sequences, and complex particle effects.',
                category: 'Animation',
                keywords: ['timeline', 'cutscene', 'sequence', 'cinematic'],
                unity: '2019.4',
                dependencies: {
                    'com.unity.modules.director': '1.0.0',
                    'com.unity.modules.animation': '1.0.0'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/Timeline.git'
                },
                recommended: false
            },
            {
                name: 'com.unity.cinemachine',
                displayName: 'Cinemachine',
                version: '2.9.7',
                description: 'Smart camera tools for passionate creators.',
                category: 'Camera',
                keywords: ['camera', 'cinematography', 'virtual camera'],
                unity: '2019.4',
                dependencies: {
                    'com.unity.timeline': '1.0.0'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/Cinemachine.git'
                },
                recommended: false
            },
            {
                name: 'com.unity.addressables',
                displayName: 'Addressables',
                version: '1.21.19',
                description: 'The Addressables package provides tools and scripts to organize and package content for your application.',
                category: 'Asset Management',
                keywords: ['addressables', 'asset', 'loading', 'bundles'],
                unity: '2019.4',
                dependencies: {
                    'com.unity.scriptablebuildpipeline': '1.21.21'
                },
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/Addressables.git'
                },
                recommended: false
            },
            {
                name: 'com.unity.analytics',
                displayName: 'Unity Analytics',
                version: '3.8.1',
                description: 'Understand your players and make data-driven decisions.',
                category: 'Analytics',
                keywords: ['analytics', 'telemetry', 'metrics'],
                unity: '2019.4',
                dependencies: {},
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/UnityAnalytics.git'
                },
                recommended: false
            },
            {
                name: 'com.unity.ads',
                displayName: 'Unity Ads',
                version: '4.9.0',
                description: 'Unity Ads helps you monetize your games through high-quality ads.',
                category: 'Monetization',
                keywords: ['ads', 'monetization', 'revenue'],
                unity: '2019.4',
                dependencies: {},
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/UnityAds.git'
                },
                recommended: false
            },
            {
                name: 'com.unity.purchasing',
                displayName: 'In App Purchasing',
                version: '4.9.4',
                description: 'Unity In App Purchasing (IAP) makes it easy to implement in-app purchases.',
                category: 'Monetization',
                keywords: ['iap', 'purchasing', 'monetization'],
                unity: '2019.4',
                dependencies: {},
                repository: {
                    type: 'git',
                    url: 'https://github.com/Unity-Technologies/UnityIAP.git'
                },
                recommended: false
            }
        ];

        builtInPackages.forEach(pkg => {
            this.packageRegistry.set(pkg.name, pkg);
        });
    }

    /**
     * Analyze game and recommend packages
     */
    async analyzeAndRecommendPackages(analysisData) {
        console.log('📦 Analyzing game for package recommendations...');
        
        const recommendations = {
            essential: [],
            recommended: [],
            optional: [],
            dependencies: new Map()
        };

        try {
            // Essential packages (always needed)
            recommendations.essential = this.getEssentialPackages(analysisData);
            
            // Recommended based on game features
            recommendations.recommended = this.getRecommendedPackages(analysisData);
            
            // Optional based on advanced features
            recommendations.optional = this.getOptionalPackages(analysisData);
            
            // Calculate dependencies
            recommendations.dependencies = this.calculateDependencies([
                ...recommendations.essential,
                ...recommendations.recommended
            ]);
            
            console.log('✅ Package analysis complete');
            return recommendations;
            
        } catch (error) {
            console.error('Package analysis failed:', error);
            return this.getDefaultRecommendations();
        }
    }

    /**
     * Get essential packages for any Unity project
     */
    getEssentialPackages(analysisData) {
        const essential = [];
        
        // Always recommend Input System for modern projects
        essential.push(this.packageRegistry.get('com.unity.inputsystem'));
        
        // TextMeshPro for better text rendering
        essential.push(this.packageRegistry.get('com.unity.textmeshpro'));
        
        // If it's a 2D game, add 2D packages
        if (this.is2DGame(analysisData)) {
            essential.push(this.packageRegistry.get('com.unity.2d.animation'));
        }
        
        // If using URP (detected from analysis)
        if (this.usesURP(analysisData)) {
            essential.push(this.packageRegistry.get('com.unity.render-pipelines.universal'));
        }
        
        return essential.filter(pkg => pkg !== undefined);
    }

    /**
     * Get recommended packages based on game features
     */
    getRecommendedPackages(analysisData) {
        const recommended = [];
        
        // Timeline for cutscenes or complex animations
        if (this.hasCutscenes(analysisData) || this.hasComplexAnimations(analysisData)) {
            recommended.push(this.packageRegistry.get('com.unity.timeline'));
        }
        
        // Cinemachine for advanced camera work
        if (this.needsAdvancedCamera(analysisData)) {
            recommended.push(this.packageRegistry.get('com.unity.cinemachine'));
        }
        
        // Addressables for large projects
        if (this.isLargeProject(analysisData)) {
            recommended.push(this.packageRegistry.get('com.unity.addressables'));
        }
        
        return recommended.filter(pkg => pkg !== undefined);
    }

    /**
     * Get optional packages for advanced features
     */
    getOptionalPackages(analysisData) {
        const optional = [];
        
        // Analytics for data collection
        if (this.needsAnalytics(analysisData)) {
            optional.push(this.packageRegistry.get('com.unity.analytics'));
        }
        
        // Monetization packages
        if (this.needsMonetization(analysisData)) {
            optional.push(this.packageRegistry.get('com.unity.ads'));
            optional.push(this.packageRegistry.get('com.unity.purchasing'));
        }
        
        return optional.filter(pkg => pkg !== undefined);
    }

    /**
     * Calculate package dependencies
     */
    calculateDependencies(packages) {
        const dependencies = new Map();
        const visited = new Set();
        
        packages.forEach(pkg => {
            if (pkg && pkg.dependencies) {
                this.resolveDependencies(pkg, dependencies, visited);
            }
        });
        
        return dependencies;
    }

    /**
     * Recursively resolve package dependencies
     */
    resolveDependencies(pkg, dependencies, visited) {
        if (visited.has(pkg.name)) return;
        visited.add(pkg.name);
        
        Object.keys(pkg.dependencies || {}).forEach(depName => {
            const depVersion = pkg.dependencies[depName];
            
            if (!dependencies.has(depName) || this.isNewerVersion(depVersion, dependencies.get(depName))) {
                dependencies.set(depName, depVersion);
            }
            
            // Recursively resolve nested dependencies
            const depPackage = this.packageRegistry.get(depName);
            if (depPackage) {
                this.resolveDependencies(depPackage, dependencies, visited);
            }
        });
    }

    /**
     * Generate manifest.json for Unity Package Manager
     */
    generateManifest(selectedPackages) {
        const manifest = {
            dependencies: {},
            scopedRegistries: [],
            testables: []
        };
        
        // Add selected packages
        selectedPackages.forEach(pkg => {
            if (pkg && pkg.name && pkg.version) {
                manifest.dependencies[pkg.name] = pkg.version;
            }
        });
        
        // Add calculated dependencies
        const dependencies = this.calculateDependencies(selectedPackages);
        dependencies.forEach((version, name) => {
            if (!manifest.dependencies[name]) {
                manifest.dependencies[name] = version;
            }
        });
        
        // Add scoped registries for third-party packages
        manifest.scopedRegistries = [
            {
                name: "Unity Technologies",
                url: "https://packages.unity.com",
                scopes: ["com.unity"]
            }
        ];
        
        return manifest;
    }

    /**
     * Generate packages UI
     */
    generatePackageManagerUI() {
        return `
        <div id="packageManagerPanel" class="fixed inset-0 z-50 bg-black bg-opacity-50 hidden">
            <div class="flex h-full">
                <!-- Package Manager Sidebar -->
                <div class="w-80 bg-gray-800 overflow-y-auto">
                    <div class="p-6 border-b border-gray-700">
                        <h2 class="text-xl font-bold mb-2">Package Manager</h2>
                        <p class="text-gray-400 text-sm">Manage Unity packages and dependencies</p>
                    </div>
                    
                    <!-- Package Categories -->
                    <div class="p-4">
                        <h3 class="font-bold mb-3">Categories</h3>
                        <div id="packageCategories" class="space-y-2">
                            <button class="package-category w-full text-left px-3 py-2 rounded-lg bg-purple-600 text-white" data-category="essential">
                                <i class="fas fa-star mr-2"></i>Essential
                            </button>
                            <button class="package-category w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="recommended">
                                <i class="fas fa-thumbs-up mr-2"></i>Recommended
                            </button>
                            <button class="package-category w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="optional">
                                <i class="fas fa-plus mr-2"></i>Optional
                            </button>
                            <button class="package-category w-full text-left px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300" data-category="all">
                                <i class="fas fa-list mr-2"></i>All Packages
                            </button>
                        </div>
                    </div>
                    
                    <!-- Selected Packages -->
                    <div class="p-4 border-t border-gray-700">
                        <h3 class="font-bold mb-3">Selected Packages</h3>
                        <div id="selectedPackages" class="space-y-2">
                            <!-- Selected packages will appear here -->
                        </div>
                        <div class="mt-4">
                            <button id="generateManifest" class="w-full bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-medium transition">
                                <i class="fas fa-download mr-2"></i>Generate Manifest
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Main Content -->
                <div class="flex-1 bg-gray-900 overflow-y-auto">
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-6">
                            <h3 class="text-xl font-bold">Available Packages</h3>
                            <button id="closePackageManager" class="text-gray-400 hover:text-white">
                                <i class="fas fa-times text-2xl"></i>
                            </button>
                        </div>
                        
                        <!-- Search -->
                        <div class="mb-6">
                            <input type="text" id="packageSearch" placeholder="Search packages..." 
                                   class="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500">
                        </div>
                        
                        <!-- Package Grid -->
                        <div id="packageGrid" class="space-y-4">
                            <!-- Packages will be populated here -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Initialize Package Manager UI
     */
    initializePackageManagerUI() {
        document.body.insertAdjacentHTML('beforeend', this.generatePackageManagerUI());
        this.setupPackageManagerEventListeners();
    }

    /**
     * Setup Package Manager event listeners
     */
    setupPackageManagerEventListeners() {
        document.getElementById('closePackageManager').addEventListener('click', () => {
            this.hidePackageManager();
        });

        document.getElementById('packageSearch').addEventListener('input', (e) => {
            this.searchPackages(e.target.value);
        });

        document.getElementById('generateManifest').addEventListener('click', () => {
            this.downloadManifest();
        });

        // Category buttons
        document.querySelectorAll('.package-category').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchPackageCategory(e.target.dataset.category);
            });
        });
    }

    /**
     * Show Package Manager
     */
    showPackageManager(analysisData = null) {
        document.getElementById('packageManagerPanel').classList.remove('hidden');
        
        if (analysisData) {
            this.loadRecommendedPackages(analysisData);
        }
    }

    /**
     * Hide Package Manager
     */
    hidePackageManager() {
        document.getElementById('packageManagerPanel').classList.add('hidden');
    }

    /**
     * Load recommended packages
     */
    async loadRecommendedPackages(analysisData) {
        try {
            this.packageRecommendations = await this.analyzeAndRecommendPackages(analysisData);
            this.switchPackageCategory('essential');
        } catch (error) {
            console.error('Failed to load package recommendations:', error);
        }
    }

    /**
     * Switch package category
     */
    switchPackageCategory(category) {
        // Update active category button
        document.querySelectorAll('.package-category').forEach(btn => {
            if (btn.dataset.category === category) {
                btn.classList.remove('bg-gray-700', 'text-gray-300');
                btn.classList.add('bg-purple-600', 'text-white');
            } else {
                btn.classList.remove('bg-purple-600', 'text-white');
                btn.classList.add('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
            }
        });

        // Display packages for category
        this.displayPackagesForCategory(category);
    }

    /**
     * Display packages for category
     */
    displayPackagesForCategory(category) {
        const container = document.getElementById('packageGrid');
        let packages = [];

        if (this.packageRecommendations) {
            switch (category) {
                case 'essential':
                    packages = this.packageRecommendations.essential;
                    break;
                case 'recommended':
                    packages = this.packageRecommendations.recommended;
                    break;
                case 'optional':
                    packages = this.packageRecommendations.optional;
                    break;
                case 'all':
                    packages = Array.from(this.packageRegistry.values());
                    break;
            }
        }

        const packagesHTML = packages.map(pkg => this.generatePackageCard(pkg)).join('');
        container.innerHTML = packagesHTML;

        // Add click handlers
        document.querySelectorAll('.package-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const packageName = e.currentTarget.dataset.packageName;
                this.togglePackageSelection(packageName);
            });
        });
    }

    /**
     * Generate package card HTML
     */
    generatePackageCard(pkg) {
        if (!pkg) return '';
        
        const isSelected = this.installedPackages.has(pkg.name);
        
        return `
        <div class="package-card bg-gray-800 rounded-lg p-4 cursor-pointer hover:bg-gray-700 transition ${isSelected ? 'ring-2 ring-purple-500' : ''}" 
             data-package-name="${pkg.name}">
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-white">${pkg.displayName}</h4>
                <span class="text-sm bg-gray-700 px-2 py-1 rounded">${pkg.version}</span>
            </div>
            <p class="text-gray-400 text-sm mb-3">${pkg.description}</p>
            <div class="flex justify-between items-center">
                <div class="flex flex-wrap gap-1">
                    ${pkg.keywords.slice(0, 3).map(keyword => 
                        `<span class="text-xs bg-purple-600 text-white px-2 py-1 rounded">${keyword}</span>`
                    ).join('')}
                </div>
                <div class="flex items-center">
                    ${isSelected ? 
                        '<i class="fas fa-check-circle text-green-400"></i>' : 
                        '<i class="fas fa-plus-circle text-gray-400"></i>'
                    }
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Toggle package selection
     */
    togglePackageSelection(packageName) {
        const pkg = this.packageRegistry.get(packageName);
        if (!pkg) return;

        if (this.installedPackages.has(packageName)) {
            this.installedPackages.delete(packageName);
        } else {
            this.installedPackages.set(packageName, pkg);
        }

        this.updateSelectedPackagesDisplay();
        this.refreshCurrentCategory();
    }

    /**
     * Update selected packages display
     */
    updateSelectedPackagesDisplay() {
        const container = document.getElementById('selectedPackages');
        const selected = Array.from(this.installedPackages.values());

        if (selected.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No packages selected</p>';
            return;
        }

        const selectedHTML = selected.map(pkg => `
            <div class="flex justify-between items-center bg-gray-700 px-3 py-2 rounded">
                <span class="text-sm text-white">${pkg.displayName}</span>
                <button class="text-red-400 hover:text-red-300" onclick="packageManager.togglePackageSelection('${pkg.name}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        container.innerHTML = selectedHTML;
    }

    /**
     * Refresh current category display
     */
    refreshCurrentCategory() {
        const activeBtn = document.querySelector('.package-category.bg-purple-600');
        if (activeBtn) {
            this.displayPackagesForCategory(activeBtn.dataset.category);
        }
    }

    /**
     * Download manifest file
     */
    downloadManifest() {
        const selectedPackages = Array.from(this.installedPackages.values());
        const manifest = this.generateManifest(selectedPackages);
        
        const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'manifest.json';
        a.click();
        
        URL.revokeObjectURL(url);
        
        // Show success notification
        if (window.showSuccessNotification) {
            window.showSuccessNotification('Manifest Downloaded', `Generated manifest with ${selectedPackages.length} packages`);
        }
    }

    /**
     * Search packages
     */
    searchPackages(query) {
        if (!query.trim()) {
            this.refreshCurrentCategory();
            return;
        }

        const results = Array.from(this.packageRegistry.values()).filter(pkg =>
            pkg.displayName.toLowerCase().includes(query.toLowerCase()) ||
            pkg.description.toLowerCase().includes(query.toLowerCase()) ||
            pkg.keywords.some(keyword => keyword.toLowerCase().includes(query.toLowerCase()))
        );

        const container = document.getElementById('packageGrid');
        const resultsHTML = results.map(pkg => this.generatePackageCard(pkg)).join('');
        container.innerHTML = resultsHTML;

        // Re-add click handlers
        document.querySelectorAll('.package-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const packageName = e.currentTarget.dataset.packageName;
                this.togglePackageSelection(packageName);
            });
        });
    }

    // Helper methods for analysis
    is2DGame(analysisData) {
        return analysisData.metadata?.genre === 'platformer' || 
               analysisData.gameLogic?.gameType === 'platformer' ||
               (analysisData.assets?.sprites?.length || 0) > 0;
    }

    usesURP(analysisData) {
        return analysisData.renderPipeline === 'URP' || 
               analysisData.metadata?.framework === 'URP';
    }

    hasCutscenes(analysisData) {
        return analysisData.gameLogic?.mechanics?.includes('cutscenes') ||
               (analysisData.assets?.sounds?.length || 0) > 3;
    }

    hasComplexAnimations(analysisData) {
        return (analysisData.assets?.sprites?.length || 0) > 5 ||
               analysisData.gameLogic?.mechanics?.includes('animation');
    }

    needsAdvancedCamera(analysisData) {
        return analysisData.gameLogic?.gameType === 'platformer' ||
               analysisData.gameLogic?.gameType === 'racing';
    }

    isLargeProject(analysisData) {
        return (analysisData.assets?.totalAssets || 0) > 20 ||
               (analysisData.scripts?.estimatedScripts || 0) > 10;
    }

    needsAnalytics(analysisData) {
        return analysisData.gameLogic?.gameType !== 'prototype';
    }

    needsMonetization(analysisData) {
        return analysisData.gameLogic?.gameType === 'mobile' ||
               analysisData.platform === 'mobile';
    }

    isNewerVersion(version1, version2) {
        // Simple version comparison (in real implementation, use semantic versioning)
        return version1 > version2;
    }

    getDefaultRecommendations() {
        return {
            essential: [
                this.packageRegistry.get('com.unity.inputsystem'),
                this.packageRegistry.get('com.unity.textmeshpro')
            ],
            recommended: [],
            optional: [],
            dependencies: new Map()
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnityPackageManager;
} else {
    window.UnityPackageManager = UnityPackageManager;
}