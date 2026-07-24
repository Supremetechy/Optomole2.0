/**
 * WebGL 3D Engine - Three.js integration for 3D game rendering
 */

class WebGL3DEngine {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.clock = null;
        this.animationMixer = null;
        this.gameObjects = new Map();
        this.lights = new Map();
        this.materials = new Map();
        this.textures = new Map();
        this.animations = new Map();
        this.isInitialized = false;
        this.renderStats = {
            fps: 0,
            drawCalls: 0,
            triangles: 0
        };
    }

    /**
     * Initialize the 3D engine
     */
    async initialize(canvas, options = {}) {
        console.log('🎨 Initializing WebGL 3D Engine...');
        
        try {
            // Load Three.js if not already loaded
            if (typeof THREE === 'undefined') {
                await this.loadThreeJS();
            }

            // Create scene
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(options.backgroundColor || 0x87CEEB);

            // Create camera
            this.createCamera(canvas, options.camera);

            // Create renderer
            this.createRenderer(canvas, options.renderer);

            // Create clock for animations
            this.clock = new THREE.Clock();

            // Setup controls
            this.setupControls(options.controls);

            // Create default lighting
            this.createDefaultLighting();

            // Setup post-processing
            if (options.postProcessing) {
                await this.setupPostProcessing();
            }

            // Setup physics integration
            if (options.physics) {
                this.setupPhysicsIntegration();
            }

            this.isInitialized = true;
            console.log('✅ WebGL 3D Engine initialized');

        } catch (error) {
            console.error('Failed to initialize 3D engine:', error);
            throw error;
        }
    }

    /**
     * Load Three.js library dynamically
     */
    async loadThreeJS() {
        return new Promise((resolve, reject) => {
            if (typeof THREE !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r155/three.min.js';
            script.onload = async () => {
                console.log('📦 Three.js loaded');
                
                // Load additional Three.js modules
                await this.loadThreeJSModules();
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Three.js'));
            document.head.appendChild(script);
        });
    }

    /**
     * Load additional Three.js modules
     */
    async loadThreeJSModules() {
        const modules = [
            'https://cdnjs.cloudflare.com/ajax/libs/three.js/r155/controls/OrbitControls.js',
            'https://cdnjs.cloudflare.com/ajax/libs/three.js/r155/loaders/GLTFLoader.js',
            'https://cdnjs.cloudflare.com/ajax/libs/three.js/r155/loaders/TextureLoader.js'
        ];

        return Promise.all(modules.map(url => {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }));
    }

    /**
     * Create camera
     */
    createCamera(canvas, cameraOptions = {}) {
        const aspect = canvas.width / canvas.height;
        
        if (cameraOptions.type === 'orthographic') {
            const frustumSize = cameraOptions.frustumSize || 10;
            this.camera = new THREE.OrthographicCamera(
                frustumSize * aspect / -2,
                frustumSize * aspect / 2,
                frustumSize / 2,
                frustumSize / -2,
                0.1,
                1000
            );
        } else {
            this.camera = new THREE.PerspectiveCamera(
                cameraOptions.fov || 75,
                aspect,
                cameraOptions.near || 0.1,
                cameraOptions.far || 1000
            );
        }

        this.camera.position.set(
            cameraOptions.x || 0,
            cameraOptions.y || 5,
            cameraOptions.z || 10
        );
    }

    /**
     * Create renderer
     */
    createRenderer(canvas, rendererOptions = {}) {
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: rendererOptions.antialias !== false,
            alpha: rendererOptions.alpha || false,
            powerPreference: rendererOptions.powerPreference || 'high-performance'
        });

        this.renderer.setSize(canvas.width, canvas.height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // Enable shadows
        this.renderer.shadowMap.enabled = rendererOptions.shadows !== false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Set color space
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // Enable tone mapping
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    /**
     * Setup camera controls
     */
    setupControls(controlsOptions = {}) {
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.1;
            this.controls.maxPolarAngle = Math.PI / 2;
            
            if (controlsOptions.target) {
                this.controls.target.set(...controlsOptions.target);
            }
        }
    }

    /**
     * Create default lighting setup
     */
    createDefaultLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
        this.scene.add(ambientLight);
        this.lights.set('ambient', ambientLight);

        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        
        this.scene.add(directionalLight);
        this.lights.set('sun', directionalLight);

        // Point light for dramatic effect
        const pointLight = new THREE.PointLight(0xffffff, 0.5, 100);
        pointLight.position.set(0, 10, 0);
        pointLight.castShadow = true;
        this.scene.add(pointLight);
        this.lights.set('point', pointLight);
    }

    /**
     * Create a 3D player character
     */
    createPlayer(options = {}) {
        const geometry = new THREE.BoxGeometry(
            options.width || 1,
            options.height || 2,
            options.depth || 1
        );
        
        const material = new THREE.MeshPhongMaterial({
            color: options.color || 0x4A90E2
        });
        
        const player = new THREE.Mesh(geometry, material);
        player.position.set(
            options.x || 0,
            options.y || 1,
            options.z || 0
        );
        
        player.castShadow = true;
        player.receiveShadow = true;
        player.userData.gameType = 'player';
        player.userData.health = options.health || 100;
        player.userData.speed = options.speed || 5;
        
        this.scene.add(player);
        this.gameObjects.set('player', player);
        
        return player;
    }

    /**
     * Create a 3D platform
     */
    createPlatform(x, y, z, width, height, depth, options = {}) {
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const material = new THREE.MeshPhongMaterial({
            color: options.color || 0x2C3E50
        });
        
        const platform = new THREE.Mesh(geometry, material);
        platform.position.set(x, y, z);
        platform.receiveShadow = true;
        platform.userData.gameType = 'platform';
        
        this.scene.add(platform);
        
        const id = options.id || `platform_${Date.now()}`;
        this.gameObjects.set(id, platform);
        
        return platform;
    }

    /**
     * Create a 3D collectible
     */
    createCollectible(x, y, z, options = {}) {
        const geometry = options.shape === 'sphere' ? 
            new THREE.SphereGeometry(options.radius || 0.5, 16, 16) :
            new THREE.BoxGeometry(
                options.width || 1,
                options.height || 1,
                options.depth || 1
            );
        
        const material = new THREE.MeshPhongMaterial({
            color: options.color || 0xF39C12,
            emissive: 0x111111
        });
        
        const collectible = new THREE.Mesh(geometry, material);
        collectible.position.set(x, y, z);
        collectible.userData.gameType = 'collectible';
        collectible.userData.value = options.value || 10;
        collectible.userData.rotationSpeed = options.rotationSpeed || 0.02;
        
        this.scene.add(collectible);
        
        const id = options.id || `collectible_${Date.now()}`;
        this.gameObjects.set(id, collectible);
        
        return collectible;
    }

    /**
     * Create a 3D enemy
     */
    createEnemy(x, y, z, options = {}) {
        const geometry = new THREE.ConeGeometry(
            options.radius || 0.5,
            options.height || 2,
            8
        );
        
        const material = new THREE.MeshPhongMaterial({
            color: options.color || 0xE74C3C
        });
        
        const enemy = new THREE.Mesh(geometry, material);
        enemy.position.set(x, y, z);
        enemy.castShadow = true;
        enemy.userData.gameType = 'enemy';
        enemy.userData.health = options.health || 50;
        enemy.userData.speed = options.speed || 2;
        enemy.userData.aiType = options.aiType || 'patrol';
        
        this.scene.add(enemy);
        
        const id = options.id || `enemy_${Date.now()}`;
        this.gameObjects.set(id, enemy);
        
        return enemy;
    }

    /**
     * Load a 3D model
     */
    async loadModel(url, options = {}) {
        return new Promise((resolve, reject) => {
            if (typeof THREE.GLTFLoader === 'undefined') {
                reject(new Error('GLTFLoader not available'));
                return;
            }

            const loader = new THREE.GLTFLoader();
            loader.load(
                url,
                (gltf) => {
                    const model = gltf.scene;
                    
                    // Configure model
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = options.castShadow !== false;
                            child.receiveShadow = options.receiveShadow !== false;
                        }
                    });
                    
                    // Set position
                    if (options.position) {
                        model.position.set(...options.position);
                    }
                    
                    // Set scale
                    if (options.scale) {
                        model.scale.set(...options.scale);
                    }
                    
                    // Add to scene
                    this.scene.add(model);
                    
                    // Store animations
                    if (gltf.animations && gltf.animations.length > 0) {
                        if (!this.animationMixer) {
                            this.animationMixer = new THREE.AnimationMixer(model);
                        }
                        
                        gltf.animations.forEach((clip) => {
                            const action = this.animationMixer.clipAction(clip);
                            this.animations.set(clip.name, action);
                        });
                    }
                    
                    resolve(model);
                },
                (progress) => {
                    console.log('Loading progress:', progress);
                },
                (error) => {
                    reject(error);
                }
            );
        });
    }

    /**
     * Create terrain
     */
    createTerrain(width, depth, options = {}) {
        const geometry = new THREE.PlaneGeometry(width, depth, 32, 32);
        
        // Add noise for terrain variation
        if (options.heightMap) {
            this.applyHeightMap(geometry, options.heightMap);
        }
        
        const material = new THREE.MeshPhongMaterial({
            color: options.color || 0x4B7C2C,
            wireframe: options.wireframe || false
        });
        
        const terrain = new THREE.Mesh(geometry, material);
        terrain.rotation.x = -Math.PI / 2;
        terrain.receiveShadow = true;
        terrain.userData.gameType = 'terrain';
        
        this.scene.add(terrain);
        this.gameObjects.set('terrain', terrain);
        
        return terrain;
    }

    /**
     * Apply height map to geometry
     */
    applyHeightMap(geometry, heightMap) {
        const vertices = geometry.attributes.position.array;
        
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const z = vertices[i + 1];
            
            // Simple noise function
            vertices[i + 2] = heightMap(x, z) || Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
        }
        
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    /**
     * Create skybox
     */
    createSkybox(textureUrls) {
        if (textureUrls && textureUrls.length === 6) {
            const loader = new THREE.CubeTextureLoader();
            const texture = loader.load(textureUrls);
            this.scene.background = texture;
        } else {
            // Create procedural sky
            this.createProceduralSky();
        }
    }

    /**
     * Create procedural sky
     */
    createProceduralSky() {
        const sky = new THREE.Sky();
        sky.scale.setScalar(450000);
        this.scene.add(sky);

        const sun = new THREE.Vector3();
        const uniforms = sky.material.uniforms;
        uniforms['turbidity'].value = 10;
        uniforms['rayleigh'].value = 2;
        uniforms['mieCoefficient'].value = 0.005;
        uniforms['mieDirectionalG'].value = 0.8;

        const elevation = 2;
        const azimuth = 180;
        const phi = THREE.MathUtils.degToRad(90 - elevation);
        const theta = THREE.MathUtils.degToRad(azimuth);

        sun.setFromSphericalCoords(1, phi, theta);
        uniforms['sunPosition'].value.copy(sun);
    }

    /**
     * Add particle system
     */
    createParticleSystem(options = {}) {
        const particleCount = options.count || 1000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        
        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = (Math.random() - 0.5) * (options.spread || 100);
            positions[i + 1] = Math.random() * (options.height || 50);
            positions[i + 2] = (Math.random() - 0.5) * (options.spread || 100);
            
            colors[i] = Math.random();
            colors[i + 1] = Math.random();
            colors[i + 2] = Math.random();
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: options.size || 2,
            vertexColors: true,
            transparent: true,
            opacity: options.opacity || 0.8
        });
        
        const particles = new THREE.Points(geometry, material);
        this.scene.add(particles);
        
        const id = options.id || `particles_${Date.now()}`;
        this.gameObjects.set(id, particles);
        
        return particles;
    }

    /**
     * Update 3D scene
     */
    update(deltaTime) {
        if (!this.isInitialized) return;

        // Update controls
        if (this.controls) {
            this.controls.update();
        }

        // Update animations
        if (this.animationMixer) {
            this.animationMixer.update(deltaTime);
        }

        // Update game objects
        this.updateGameObjects(deltaTime);

        // Update render stats
        this.updateRenderStats();
    }

    /**
     * Update game objects
     */
    updateGameObjects(deltaTime) {
        this.gameObjects.forEach((object, id) => {
            const userData = object.userData;
            
            // Rotate collectibles
            if (userData.gameType === 'collectible') {
                object.rotation.y += userData.rotationSpeed || 0.02;
                
                // Add floating animation
                const time = Date.now() * 0.001;
                object.position.y += Math.sin(time * 2) * 0.01;
            }
            
            // Update enemy AI
            if (userData.gameType === 'enemy') {
                this.updateEnemyAI3D(object, deltaTime);
            }
            
            // Update particles
            if (object.isPoints) {
                this.updateParticles(object, deltaTime);
            }
        });
    }

    /**
     * Update 3D enemy AI
     */
    updateEnemyAI3D(enemy, deltaTime) {
        const player = this.gameObjects.get('player');
        if (!player) return;

        const userData = enemy.userData;
        const distance = enemy.position.distanceTo(player.position);

        switch (userData.aiType) {
            case 'patrol':
                // Simple patrol behavior
                if (!userData.patrolDirection) {
                    userData.patrolDirection = new THREE.Vector3(
                        Math.random() - 0.5,
                        0,
                        Math.random() - 0.5
                    ).normalize();
                }
                
                enemy.position.add(
                    userData.patrolDirection.clone().multiplyScalar(userData.speed * deltaTime)
                );
                
                // Change direction occasionally
                if (Math.random() < 0.01) {
                    userData.patrolDirection = new THREE.Vector3(
                        Math.random() - 0.5,
                        0,
                        Math.random() - 0.5
                    ).normalize();
                }
                break;

            case 'chase':
                if (distance < 20) {
                    const direction = player.position.clone().sub(enemy.position).normalize();
                    enemy.position.add(direction.multiplyScalar(userData.speed * deltaTime));
                    enemy.lookAt(player.position);
                }
                break;
        }
    }

    /**
     * Update particle systems
     */
    updateParticles(particles, deltaTime) {
        const positions = particles.geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] -= deltaTime * 10; // Fall down
            
            // Reset particles that fall too low
            if (positions[i + 1] < -50) {
                positions[i + 1] = 50;
            }
        }
        
        particles.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Update render statistics
     */
    updateRenderStats() {
        this.renderStats.fps = Math.round(1000 / this.clock.getDelta());
        this.renderStats.drawCalls = this.renderer.info.render.calls;
        this.renderStats.triangles = this.renderer.info.render.triangles;
    }

    /**
     * Render the 3D scene
     */
    render() {
        if (!this.isInitialized) return;
        
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Resize renderer
     */
    resize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Get object by ID
     */
    getObject(id) {
        return this.gameObjects.get(id);
    }

    /**
     * Remove object
     */
    removeObject(id) {
        const object = this.gameObjects.get(id);
        if (object) {
            this.scene.remove(object);
            this.gameObjects.delete(id);
        }
    }

    /**
     * Set camera position
     */
    setCameraPosition(x, y, z) {
        this.camera.position.set(x, y, z);
    }

    /**
     * Look at position
     */
    setCameraTarget(x, y, z) {
        this.camera.lookAt(x, y, z);
        if (this.controls) {
            this.controls.target.set(x, y, z);
        }
    }

    /**
     * Enable/disable shadows
     */
    setShadows(enabled) {
        this.renderer.shadowMap.enabled = enabled;
    }

    /**
     * Set fog
     */
    setFog(color, near, far) {
        this.scene.fog = new THREE.Fog(color, near, far);
    }

    /**
     * Get render statistics
     */
    getRenderStats() {
        return this.renderStats;
    }

    /**
     * Cleanup and destroy
     */
    destroy() {
        // Stop animations
        if (this.animationMixer) {
            this.animationMixer.stopAllAction();
        }

        // Clear scene
        while (this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }

        // Dispose of materials and geometries
        this.gameObjects.forEach((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });

        // Clear maps
        this.gameObjects.clear();
        this.lights.clear();
        this.materials.clear();
        this.textures.clear();
        this.animations.clear();

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.isInitialized = false;
        console.log('🗑️ 3D Engine destroyed');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebGL3DEngine;
} else {
    window.WebGL3DEngine = WebGL3DEngine;
}