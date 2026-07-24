/**
 * ProjectManager - Handles saving, loading, and managing game duplicates
 */

class ProjectManager {
    constructor() {
        this.projects = new Map();
        this.currentProject = null;
        this.storageKey = 'gameDuplicatorProjects';
        this.loadProjects();
    }

    /**
     * Create a new project
     */
    createProject(projectData) {
        const project = {
            id: this.generateProjectId(),
            name: projectData.name || 'Untitled Game',
            originalGame: projectData.originalGame,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            version: '1.0.0',
            status: 'draft', // draft, building, completed, published
            analysisData: projectData.analysisData,
            customizations: projectData.customizations || {},
            generatedCode: null,
            buildSettings: projectData.buildSettings || {},
            thumbnail: projectData.thumbnail || this.generateThumbnail(),
            metadata: {
                engine: projectData.analysisData?.metadata?.engine || 'html5',
                genre: projectData.analysisData?.metadata?.genre || 'action',
                framework: projectData.framework || 'HTML5',
                fileSize: '0 MB',
                playCount: 0,
                rating: 0,
                tags: []
            }
        };

        this.projects.set(project.id, project);
        this.currentProject = project;
        this.saveProjects();
        
        return project;
    }

    /**
     * Update an existing project
     */
    updateProject(projectId, updates) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        const updatedProject = {
            ...project,
            ...updates,
            lastModified: new Date().toISOString()
        };

        // Update version if code changed
        if (updates.generatedCode && updates.generatedCode !== project.generatedCode) {
            updatedProject.version = this.incrementVersion(project.version);
        }

        this.projects.set(projectId, updatedProject);
        this.saveProjects();
        
        return updatedProject;
    }

    /**
     * Delete a project
     */
    deleteProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        this.projects.delete(projectId);
        
        if (this.currentProject && this.currentProject.id === projectId) {
            this.currentProject = null;
        }
        
        this.saveProjects();
        this.cleanupProjectAssets(projectId);
        
        return true;
    }

    /**
     * Get all projects
     */
    getAllProjects() {
        return Array.from(this.projects.values());
    }

    /**
     * Get projects by filter
     */
    getProjects(filter = {}) {
        let projects = this.getAllProjects();

        if (filter.status) {
            projects = projects.filter(p => p.status === filter.status);
        }

        if (filter.engine) {
            projects = projects.filter(p => p.metadata.engine === filter.engine);
        }

        if (filter.genre) {
            projects = projects.filter(p => p.metadata.genre === filter.genre);
        }

        if (filter.search) {
            const searchTerm = filter.search.toLowerCase();
            projects = projects.filter(p => 
                p.name.toLowerCase().includes(searchTerm) ||
                p.originalGame.toLowerCase().includes(searchTerm) ||
                p.metadata.tags.some(tag => tag.toLowerCase().includes(searchTerm))
            );
        }

        // Sort by last modified (newest first)
        projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

        return projects;
    }

    /**
     * Get a specific project
     */
    getProject(projectId) {
        return this.projects.get(projectId);
    }

    /**
     * Set current project
     */
    setCurrentProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error('Project not found');
        }
        
        this.currentProject = project;
        return project;
    }

    /**
     * Build/compile a project
     */
    async buildProject(projectId, buildOptions = {}) {
        const project = this.getProject(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        try {
            this.updateProject(projectId, { status: 'building' });

            // Generate the game using GameGenerator
            const generator = new GameGenerator();
            const result = await generator.generateGame(
                project.analysisData,
                project.customizations,
                (progress, status) => {
                    // Emit build progress events
                    this.emitBuildProgress(projectId, progress, status);
                }
            );

            // Update project with build results
            const updatedProject = this.updateProject(projectId, {
                status: 'completed',
                generatedCode: result.gameData,
                buildSettings: {
                    ...project.buildSettings,
                    ...buildOptions,
                    buildDate: new Date().toISOString()
                },
                metadata: {
                    ...project.metadata,
                    fileSize: this.calculateFileSize(result.gameData)
                }
            });

            // Save generated files
            await this.saveProjectFiles(projectId, result.gameData);

            return updatedProject;

        } catch (error) {
            this.updateProject(projectId, { 
                status: 'failed',
                buildError: error.message 
            });
            throw error;
        }
    }

    /**
     * Export project
     */
    async exportProject(projectId, exportFormat = 'zip') {
        const project = this.getProject(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        if (project.status !== 'completed') {
            throw new Error('Project must be built before exporting');
        }

        const exportData = {
            project: project,
            files: await this.getProjectFiles(projectId),
            format: exportFormat
        };

        switch (exportFormat) {
            case 'zip':
                return await this.exportAsZip(exportData);
            case 'html':
                return await this.exportAsHTML(exportData);
            case 'json':
                return await this.exportAsJSON(exportData);
            default:
                throw new Error('Unsupported export format');
        }
    }

    /**
     * Import project
     */
    async importProject(importData, format = 'json') {
        try {
            let projectData;

            switch (format) {
                case 'json':
                    projectData = JSON.parse(importData);
                    break;
                case 'zip':
                    projectData = await this.importFromZip(importData);
                    break;
                default:
                    throw new Error('Unsupported import format');
            }

            // Generate new ID to avoid conflicts
            const newProject = {
                ...projectData,
                id: this.generateProjectId(),
                name: projectData.name + ' (Imported)',
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString()
            };

            this.projects.set(newProject.id, newProject);
            this.saveProjects();

            return newProject;

        } catch (error) {
            throw new Error('Failed to import project: ' + error.message);
        }
    }

    /**
     * Generate project UI for management
     */
    generateProjectManagerUI() {
        return `
        <div id="projectManager" class="fixed inset-0 z-50 bg-black bg-opacity-50 hidden">
            <div class="flex h-full">
                <!-- Sidebar -->
                <div class="w-80 bg-gray-800 overflow-y-auto">
                    <div class="p-6 border-b border-gray-700">
                        <h2 class="text-xl font-bold mb-2">My Game Projects</h2>
                        <div class="flex space-x-2">
                            <button id="newProjectBtn" class="flex-1 bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg text-sm font-medium transition">
                                <i class="fas fa-plus mr-2"></i>New
                            </button>
                            <button id="importProjectBtn" class="flex-1 bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm font-medium transition">
                                <i class="fas fa-download mr-2"></i>Import
                            </button>
                        </div>
                    </div>
                    
                    <!-- Filters -->
                    <div class="p-4 border-b border-gray-700">
                        <div class="space-y-3">
                            <div>
                                <input type="text" id="projectSearch" placeholder="Search projects..." 
                                       class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                            </div>
                            <div class="flex space-x-2">
                                <select id="statusFilter" class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                                    <option value="">All Status</option>
                                    <option value="draft">Draft</option>
                                    <option value="building">Building</option>
                                    <option value="completed">Completed</option>
                                    <option value="published">Published</option>
                                </select>
                                <select id="engineFilter" class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                                    <option value="">All Engines</option>
                                    <option value="html5">HTML5</option>
                                    <option value="unity">Unity</option>
                                    <option value="phaser">Phaser</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Project List -->
                    <div id="projectList" class="p-4">
                        <!-- Projects will be populated here -->
                    </div>
                </div>
                
                <!-- Main Content -->
                <div class="flex-1 bg-gray-900 overflow-y-auto">
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-6">
                            <h3 class="text-xl font-bold">Project Details</h3>
                            <button id="closeProjectManager" class="text-gray-400 hover:text-white">
                                <i class="fas fa-times text-2xl"></i>
                            </button>
                        </div>
                        
                        <div id="projectDetails">
                            <div class="text-center text-gray-400 py-12">
                                <i class="fas fa-folder-open text-6xl mb-4"></i>
                                <p>Select a project to view details</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Initialize project manager UI
     */
    initializeUI() {
        // Add UI to page
        document.body.insertAdjacentHTML('beforeend', this.generateProjectManagerUI());
        
        // Setup event listeners
        this.setupUIEventListeners();
        
        // Load projects into UI
        this.refreshProjectList();
    }

    /**
     * Setup event listeners for project manager UI
     */
    setupUIEventListeners() {
        // Close button
        document.getElementById('closeProjectManager').addEventListener('click', () => {
            this.hideUI();
        });

        // Search and filters
        document.getElementById('projectSearch').addEventListener('input', (e) => {
            this.refreshProjectList({ search: e.target.value });
        });

        document.getElementById('statusFilter').addEventListener('change', (e) => {
            this.refreshProjectList({ status: e.target.value });
        });

        document.getElementById('engineFilter').addEventListener('change', (e) => {
            this.refreshProjectList({ engine: e.target.value });
        });

        // New project button
        document.getElementById('newProjectBtn').addEventListener('click', () => {
            this.showNewProjectDialog();
        });

        // Import project button
        document.getElementById('importProjectBtn').addEventListener('click', () => {
            this.showImportDialog();
        });
    }

    /**
     * Show project manager UI
     */
    showUI() {
        document.getElementById('projectManager').classList.remove('hidden');
        this.refreshProjectList();
    }

    /**
     * Hide project manager UI
     */
    hideUI() {
        document.getElementById('projectManager').classList.add('hidden');
    }

    /**
     * Refresh project list in UI
     */
    refreshProjectList(filter = {}) {
        const projects = this.getProjects(filter);
        const projectList = document.getElementById('projectList');
        
        if (projects.length === 0) {
            projectList.innerHTML = `
                <div class="text-center text-gray-400 py-6">
                    <i class="fas fa-folder text-4xl mb-3"></i>
                    <p>No projects found</p>
                </div>
            `;
            return;
        }

        const projectsHTML = projects.map(project => `
            <div class="project-item bg-gray-700 rounded-lg p-4 mb-3 cursor-pointer hover:bg-gray-600 transition" data-project-id="${project.id}">
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <h4 class="font-medium text-white mb-1">${project.name}</h4>
                        <p class="text-sm text-gray-400 mb-2">Based on: ${project.originalGame}</p>
                        <div class="flex items-center space-x-3 text-xs text-gray-500">
                            <span class="flex items-center">
                                <i class="fas fa-calendar mr-1"></i>
                                ${new Date(project.lastModified).toLocaleDateString()}
                            </span>
                            <span class="flex items-center">
                                <i class="fas fa-cog mr-1"></i>
                                ${project.metadata.engine}
                            </span>
                        </div>
                    </div>
                    <div class="ml-3">
                        <span class="status-badge px-2 py-1 rounded text-xs font-medium ${this.getStatusBadgeClass(project.status)}">
                            ${project.status}
                        </span>
                    </div>
                </div>
            </div>
        `).join('');

        projectList.innerHTML = projectsHTML;

        // Add click handlers
        document.querySelectorAll('.project-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const projectId = e.currentTarget.dataset.projectId;
                this.showProjectDetails(projectId);
            });
        });
    }

    /**
     * Show project details
     */
    showProjectDetails(projectId) {
        const project = this.getProject(projectId);
        if (!project) return;

        const detailsContainer = document.getElementById('projectDetails');
        detailsContainer.innerHTML = `
            <div class="space-y-6">
                <!-- Project Header -->
                <div class="bg-gray-800 rounded-lg p-6">
                    <div class="flex items-start justify-between">
                        <div>
                            <h3 class="text-2xl font-bold text-white mb-2">${project.name}</h3>
                            <p class="text-gray-400 mb-4">Based on: ${project.originalGame}</p>
                            <div class="flex items-center space-x-4 text-sm text-gray-500">
                                <span><i class="fas fa-calendar mr-1"></i> Created: ${new Date(project.createdAt).toLocaleDateString()}</span>
                                <span><i class="fas fa-edit mr-1"></i> Modified: ${new Date(project.lastModified).toLocaleDateString()}</span>
                                <span><i class="fas fa-tag mr-1"></i> Version: ${project.version}</span>
                            </div>
                        </div>
                        <span class="status-badge px-3 py-1 rounded-lg text-sm font-medium ${this.getStatusBadgeClass(project.status)}">
                            ${project.status}
                        </span>
                    </div>
                </div>

                <!-- Actions -->
                <div class="flex flex-wrap gap-2">
                    <button class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-medium transition" onclick="projectManager.playProject('${projectId}')">
                        <i class="fas fa-play mr-2"></i>Play Game
                    </button>
                    <button class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-medium transition" onclick="projectManager.editProject('${projectId}')">
                        <i class="fas fa-edit mr-2"></i>Edit
                    </button>
                    <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition" onclick="projectManager.buildProject('${projectId}')">
                        <i class="fas fa-hammer mr-2"></i>Build
                    </button>
                    <button class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg font-medium transition" onclick="projectManager.exportProject('${projectId}')">
                        <i class="fas fa-download mr-2"></i>Export
                    </button>
                    <button class="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg font-medium transition" onclick="projectManager.deleteProject('${projectId}')">
                        <i class="fas fa-trash mr-2"></i>Delete
                    </button>
                </div>

                <!-- Project Stats -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="bg-gray-800 rounded-lg p-4">
                        <h4 class="font-medium text-white mb-2">Technical Info</h4>
                        <div class="space-y-1 text-sm text-gray-400">
                            <p>Engine: ${project.metadata.engine}</p>
                            <p>Framework: ${project.metadata.framework}</p>
                            <p>File Size: ${project.metadata.fileSize}</p>
                        </div>
                    </div>
                    <div class="bg-gray-800 rounded-lg p-4">
                        <h4 class="font-medium text-white mb-2">Game Info</h4>
                        <div class="space-y-1 text-sm text-gray-400">
                            <p>Genre: ${project.metadata.genre}</p>
                            <p>Play Count: ${project.metadata.playCount}</p>
                            <p>Rating: ${project.metadata.rating}/5</p>
                        </div>
                    </div>
                    <div class="bg-gray-800 rounded-lg p-4">
                        <h4 class="font-medium text-white mb-2">Customizations</h4>
                        <div class="space-y-1 text-sm text-gray-400">
                            <p>Logic: ${Object.keys(project.customizations.logic || {}).length} changes</p>
                            <p>Assets: ${Object.keys(project.customizations.assets || {}).length} changes</p>
                            <p>UI: ${Object.keys(project.customizations.ui || {}).length} changes</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Helper methods
    generateProjectId() {
        return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    generateThumbnail() {
        return `https://via.placeholder.com/300x200/4B5563/FFFFFF?text=Game+Project`;
    }

    incrementVersion(version) {
        const parts = version.split('.');
        parts[2] = (parseInt(parts[2]) + 1).toString();
        return parts.join('.');
    }

    getStatusBadgeClass(status) {
        const classes = {
            'draft': 'bg-gray-600 text-gray-300',
            'building': 'bg-blue-600 text-blue-100',
            'completed': 'bg-green-600 text-green-100',
            'published': 'bg-purple-600 text-purple-100',
            'failed': 'bg-red-600 text-red-100'
        };
        return classes[status] || classes['draft'];
    }

    calculateFileSize(gameData) {
        // Rough calculation of file size
        const sizeInBytes = JSON.stringify(gameData).length;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
        return `${sizeInMB} MB`;
    }

    // Storage methods
    saveProjects() {
        const projectsData = Array.from(this.projects.entries());
        localStorage.setItem(this.storageKey, JSON.stringify(projectsData));
    }

    loadProjects() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const projectsData = JSON.parse(stored);
                this.projects = new Map(projectsData);
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            this.projects = new Map();
        }
    }

    // Placeholder methods for future implementation
    async saveProjectFiles(projectId, gameData) {
        // In a real implementation, this would save files to server or IndexedDB
        console.log('Saving project files for:', projectId);
    }

    async getProjectFiles(projectId) {
        // In a real implementation, this would load files from server or IndexedDB
        console.log('Loading project files for:', projectId);
        return {};
    }

    cleanupProjectAssets(projectId) {
        // Clean up any stored assets for the deleted project
        console.log('Cleaning up assets for:', projectId);
    }

    emitBuildProgress(projectId, progress, status) {
        // Emit build progress events
        console.log(`Build progress for ${projectId}: ${progress}% - ${status}`);
    }

    // Export methods (placeholder implementations)
    async exportAsZip(exportData) {
        console.log('Exporting as ZIP...');
        return 'zip-data';
    }

    async exportAsHTML(exportData) {
        console.log('Exporting as HTML...');
        return exportData.files;
    }

    async exportAsJSON(exportData) {
        console.log('Exporting as JSON...');
        return JSON.stringify(exportData.project, null, 2);
    }

    async importFromZip(zipData) {
        console.log('Importing from ZIP...');
        return {};
    }

    // UI dialog methods
    showNewProjectDialog() {
        // Show new project creation dialog
        console.log('Show new project dialog');
    }

    showImportDialog() {
        // Show import project dialog
        console.log('Show import dialog');
    }

    editProject(projectId) {
        // Open project in customization panel
        console.log('Edit project:', projectId);
    }

    playProject(projectId) {
        // Launch the game
        console.log('Play project:', projectId);
        
        const project = this.getProject(projectId);
        if (!project) {
            console.error('Project not found:', projectId);
            return;
        }
        
        // Check if project is built
        if (project.status !== 'completed') {
            if (confirm('This project needs to be built before playing. Build it now?')) {
                this.buildProject(projectId).then(() => {
                    this.playProject(projectId);
                });
            }
            return;
        }
        
        // Prepare game data for the player
        const gameData = {
            name: project.name,
            type: project.analysisData?.gameLogic?.gameType || 'platformer',
            engine: project.analysisData?.metadata?.engine || 'html5',
            originalGame: project.originalGame,
            customizations: project.customizations,
            generatedCode: project.generatedCode
        };
        
        // Launch the game player
        if (window.gamePlayer) {
            this.hideUI(); // Hide project manager
            window.gamePlayer.loadGame(gameData, project);
        } else {
            console.error('Game player not available');
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectManager;
} else {
    window.ProjectManager = ProjectManager;
}