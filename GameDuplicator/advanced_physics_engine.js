/**
 * Advanced Physics Engine - Matter.js integration for realistic physics
 */

class AdvancedPhysicsEngine {
    constructor() {
        this.engine = null;
        this.world = null;
        this.render = null;
        this.runner = null;
        this.bodies = new Map();
        this.constraints = new Map();
        this.isInitialized = false;
        this.gravityScale = 1;
        this.timeScale = 1;
        this.collisionCategories = {
            PLAYER: 0x0001,
            ENEMY: 0x0002,
            PLATFORM: 0x0004,
            COLLECTIBLE: 0x0008,
            PROJECTILE: 0x0010,
            SENSOR: 0x0020
        };
    }

    /**
     * Initialize the physics engine
     */
    async initialize(canvas, options = {}) {
        console.log('🔬 Initializing Advanced Physics Engine...');
        
        try {
            // Load Matter.js if not already loaded
            if (typeof Matter === 'undefined') {
                await this.loadMatterJS();
            }

            // Create engine
            this.engine = Matter.Engine.create();
            this.world = this.engine.world;

            // Configure physics settings
            this.engine.world.gravity.y = options.gravity || 1;
            this.engine.world.gravity.x = 0;
            this.engine.enableSleeping = true;
            this.engine.timing.timeScale = this.timeScale;

            // Create renderer if canvas provided
            if (canvas) {
                this.render = Matter.Render.create({
                    canvas: canvas,
                    engine: this.engine,
                    options: {
                        width: canvas.width,
                        height: canvas.height,
                        pixelRatio: window.devicePixelRatio || 1,
                        background: 'transparent',
                        wireframes: options.wireframes || false,
                        showAngleIndicator: options.debug || false,
                        showVelocity: options.debug || false,
                        showCollisions: options.debug || false
                    }
                });
            }

            // Create runner
            this.runner = Matter.Runner.create();

            // Setup collision detection
            this.setupCollisionDetection();

            // Add world boundaries
            this.createWorldBoundaries(options.bounds);

            this.isInitialized = true;
            console.log('✅ Advanced Physics Engine initialized');

        } catch (error) {
            console.error('Failed to initialize physics engine:', error);
            throw error;
        }
    }

    /**
     * Load Matter.js library dynamically
     */
    async loadMatterJS() {
        return new Promise((resolve, reject) => {
            if (typeof Matter !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
            script.onload = () => {
                console.log('📦 Matter.js loaded');
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Matter.js'));
            document.head.appendChild(script);
        });
    }

    /**
     * Start the physics simulation
     */
    start() {
        if (!this.isInitialized) {
            console.warn('Physics engine not initialized');
            return;
        }

        Matter.Runner.run(this.runner, this.engine);
        
        if (this.render) {
            Matter.Render.run(this.render);
        }

        console.log('▶️ Physics simulation started');
    }

    /**
     * Stop the physics simulation
     */
    stop() {
        if (this.runner) {
            Matter.Runner.stop(this.runner);
        }
        
        if (this.render) {
            Matter.Render.stop(this.render);
        }

        console.log('⏹️ Physics simulation stopped');
    }

    /**
     * Setup collision detection events
     */
    setupCollisionDetection() {
        Matter.Events.on(this.engine, 'collisionStart', (event) => {
            event.pairs.forEach(pair => {
                this.handleCollision(pair.bodyA, pair.bodyB, 'start');
            });
        });

        Matter.Events.on(this.engine, 'collisionActive', (event) => {
            event.pairs.forEach(pair => {
                this.handleCollision(pair.bodyA, pair.bodyB, 'active');
            });
        });

        Matter.Events.on(this.engine, 'collisionEnd', (event) => {
            event.pairs.forEach(pair => {
                this.handleCollision(pair.bodyA, pair.bodyB, 'end');
            });
        });
    }

    /**
     * Handle collision events
     */
    handleCollision(bodyA, bodyB, phase) {
        // Emit custom collision events that game objects can listen to
        const collisionData = {
            bodyA,
            bodyB,
            phase,
            timestamp: Date.now()
        };

        // Trigger custom events
        document.dispatchEvent(new CustomEvent('physicsCollision', {
            detail: collisionData
        }));
    }

    /**
     * Create world boundaries
     */
    createWorldBoundaries(bounds) {
        if (!bounds) {
            bounds = {
                width: 800,
                height: 600,
                thickness: 50
            };
        }

        const options = {
            isStatic: true,
            render: { visible: false },
            collisionFilter: {
                category: this.collisionCategories.PLATFORM
            }
        };

        // Ground
        const ground = Matter.Bodies.rectangle(
            bounds.width / 2, 
            bounds.height + bounds.thickness / 2,
            bounds.width, 
            bounds.thickness, 
            options
        );

        // Ceiling
        const ceiling = Matter.Bodies.rectangle(
            bounds.width / 2, 
            -bounds.thickness / 2,
            bounds.width, 
            bounds.thickness, 
            options
        );

        // Left wall
        const leftWall = Matter.Bodies.rectangle(
            -bounds.thickness / 2, 
            bounds.height / 2,
            bounds.thickness, 
            bounds.height, 
            options
        );

        // Right wall
        const rightWall = Matter.Bodies.rectangle(
            bounds.width + bounds.thickness / 2, 
            bounds.height / 2,
            bounds.thickness, 
            bounds.height, 
            options
        );

        Matter.World.add(this.world, [ground, ceiling, leftWall, rightWall]);

        this.bodies.set('ground', ground);
        this.bodies.set('ceiling', ceiling);
        this.bodies.set('leftWall', leftWall);
        this.bodies.set('rightWall', rightWall);
    }

    /**
     * Create a player body with advanced physics
     */
    createPlayer(x, y, options = {}) {
        const playerOptions = {
            density: 0.001,
            friction: 0.1,
            frictionAir: 0.01,
            restitution: 0.1,
            render: {
                fillStyle: options.color || '#4A90E2'
            },
            collisionFilter: {
                category: this.collisionCategories.PLAYER,
                mask: this.collisionCategories.PLATFORM | 
                      this.collisionCategories.ENEMY | 
                      this.collisionCategories.COLLECTIBLE
            },
            ...options
        };

        const player = Matter.Bodies.rectangle(
            x, y, 
            options.width || 32, 
            options.height || 32, 
            playerOptions
        );

        // Add player-specific properties
        player.gameType = 'player';
        player.health = options.health || 100;
        player.jumpPower = options.jumpPower || 15;
        player.canJump = true;

        Matter.World.add(this.world, player);
        this.bodies.set('player', player);

        return player;
    }

    /**
     * Create a platform with physics
     */
    createPlatform(x, y, width, height, options = {}) {
        const platformOptions = {
            isStatic: true,
            render: {
                fillStyle: options.color || '#2C3E50'
            },
            collisionFilter: {
                category: this.collisionCategories.PLATFORM
            },
            ...options
        };

        const platform = Matter.Bodies.rectangle(x, y, width, height, platformOptions);
        platform.gameType = 'platform';

        Matter.World.add(this.world, platform);
        
        const id = options.id || `platform_${Date.now()}`;
        this.bodies.set(id, platform);

        return platform;
    }

    /**
     * Create a moving platform
     */
    createMovingPlatform(x, y, width, height, path, options = {}) {
        const platform = this.createPlatform(x, y, width, height, {
            ...options,
            isStatic: false,
            density: 0.001
        });

        // Create constraint for movement
        const constraint = Matter.Constraint.create({
            bodyA: platform,
            pointB: { x: x, y: y },
            stiffness: 1,
            length: 0
        });

        Matter.World.add(this.world, constraint);

        // Add movement behavior
        platform.movementPath = path;
        platform.movementSpeed = options.speed || 2;
        platform.currentPathIndex = 0;

        const constraintId = options.id || `moving_platform_${Date.now()}`;
        this.constraints.set(constraintId, constraint);

        return platform;
    }

    /**
     * Create collectible item
     */
    createCollectible(x, y, options = {}) {
        const collectibleOptions = {
            density: 0.001,
            frictionAir: 0.01,
            render: {
                fillStyle: options.color || '#F39C12'
            },
            collisionFilter: {
                category: this.collisionCategories.COLLECTIBLE,
                mask: this.collisionCategories.PLAYER
            },
            isSensor: true,
            ...options
        };

        const shape = options.shape || 'circle';
        let collectible;

        if (shape === 'circle') {
            collectible = Matter.Bodies.circle(x, y, options.radius || 10, collectibleOptions);
        } else {
            collectible = Matter.Bodies.rectangle(
                x, y, 
                options.width || 20, 
                options.height || 20, 
                collectibleOptions
            );
        }

        collectible.gameType = 'collectible';
        collectible.value = options.value || 10;
        collectible.effect = options.effect || 'score';

        Matter.World.add(this.world, collectible);
        
        const id = options.id || `collectible_${Date.now()}`;
        this.bodies.set(id, collectible);

        return collectible;
    }

    /**
     * Create enemy with AI behavior
     */
    createEnemy(x, y, options = {}) {
        const enemyOptions = {
            density: 0.001,
            friction: 0.1,
            frictionAir: 0.01,
            render: {
                fillStyle: options.color || '#E74C3C'
            },
            collisionFilter: {
                category: this.collisionCategories.ENEMY,
                mask: this.collisionCategories.PLATFORM | 
                      this.collisionCategories.PLAYER
            },
            ...options
        };

        const enemy = Matter.Bodies.rectangle(
            x, y, 
            options.width || 25, 
            options.height || 25, 
            enemyOptions
        );

        enemy.gameType = 'enemy';
        enemy.health = options.health || 50;
        enemy.speed = options.speed || 2;
        enemy.aiType = options.aiType || 'patrol';
        enemy.patrolRange = options.patrolRange || 100;
        enemy.startX = x;

        Matter.World.add(this.world, enemy);
        
        const id = options.id || `enemy_${Date.now()}`;
        this.bodies.set(id, enemy);

        return enemy;
    }

    /**
     * Apply force to a body
     */
    applyForce(body, force) {
        Matter.Body.applyForce(body, body.position, force);
    }

    /**
     * Make player jump
     */
    jump(player, force = null) {
        if (!player.canJump) return false;

        const jumpForce = force || { x: 0, y: -player.jumpPower };
        Matter.Body.applyForce(player, player.position, jumpForce);
        
        player.canJump = false;
        
        // Reset jump ability after a short delay
        setTimeout(() => {
            player.canJump = true;
        }, 100);

        return true;
    }

    /**
     * Move body horizontally
     */
    moveHorizontal(body, direction, speed = 5) {
        const force = { x: direction * speed * 0.01, y: 0 };
        Matter.Body.applyForce(body, body.position, force);
    }

    /**
     * Create rope/chain constraint
     */
    createRope(bodyA, bodyB, options = {}) {
        const constraint = Matter.Constraint.create({
            bodyA: bodyA,
            bodyB: bodyB,
            length: options.length || 100,
            stiffness: options.stiffness || 0.8,
            render: {
                type: 'line',
                strokeStyle: options.color || '#666666'
            },
            ...options
        });

        Matter.World.add(this.world, constraint);
        
        const id = options.id || `rope_${Date.now()}`;
        this.constraints.set(id, constraint);

        return constraint;
    }

    /**
     * Create spring constraint
     */
    createSpring(bodyA, bodyB, options = {}) {
        const spring = Matter.Constraint.create({
            bodyA: bodyA,
            bodyB: bodyB,
            length: options.length || 100,
            stiffness: options.stiffness || 0.1,
            damping: options.damping || 0.1,
            render: {
                type: 'line',
                strokeStyle: options.color || '#00FF00',
                lineWidth: 3
            },
            ...options
        });

        Matter.World.add(this.world, spring);
        
        const id = options.id || `spring_${Date.now()}`;
        this.constraints.set(id, spring);

        return spring;
    }

    /**
     * Update physics simulation
     */
    update(deltaTime) {
        if (!this.isInitialized) return;

        // Update moving platforms
        this.updateMovingPlatforms();
        
        // Update enemy AI
        this.updateEnemyAI();
        
        // Update collectible animations
        this.updateCollectibles();
    }

    /**
     * Update moving platforms
     */
    updateMovingPlatforms() {
        this.bodies.forEach((body, id) => {
            if (body.gameType === 'platform' && body.movementPath) {
                const path = body.movementPath;
                const currentTarget = path[body.currentPathIndex];
                
                if (currentTarget) {
                    const distance = Matter.Vector.magnitude(
                        Matter.Vector.sub(currentTarget, body.position)
                    );
                    
                    if (distance < 10) {
                        body.currentPathIndex = (body.currentPathIndex + 1) % path.length;
                    } else {
                        const direction = Matter.Vector.normalise(
                            Matter.Vector.sub(currentTarget, body.position)
                        );
                        const force = Matter.Vector.mult(direction, body.movementSpeed * 0.01);
                        Matter.Body.applyForce(body, body.position, force);
                    }
                }
            }
        });
    }

    /**
     * Update enemy AI
     */
    updateEnemyAI() {
        const player = this.bodies.get('player');
        
        this.bodies.forEach((body, id) => {
            if (body.gameType === 'enemy') {
                switch (body.aiType) {
                    case 'patrol':
                        this.updatePatrolAI(body);
                        break;
                    case 'chase':
                        this.updateChaseAI(body, player);
                        break;
                    case 'guard':
                        this.updateGuardAI(body, player);
                        break;
                }
            }
        });
    }

    /**
     * Update patrol AI
     */
    updatePatrolAI(enemy) {
        const leftBound = enemy.startX - enemy.patrolRange;
        const rightBound = enemy.startX + enemy.patrolRange;
        
        if (enemy.position.x <= leftBound) {
            enemy.patrolDirection = 1;
        } else if (enemy.position.x >= rightBound) {
            enemy.patrolDirection = -1;
        }
        
        if (!enemy.patrolDirection) {
            enemy.patrolDirection = Math.random() > 0.5 ? 1 : -1;
        }
        
        this.moveHorizontal(enemy, enemy.patrolDirection, enemy.speed);
    }

    /**
     * Update chase AI
     */
    updateChaseAI(enemy, player) {
        if (!player) return;
        
        const distance = Matter.Vector.magnitude(
            Matter.Vector.sub(player.position, enemy.position)
        );
        
        if (distance < 200) { // Chase range
            const direction = player.position.x > enemy.position.x ? 1 : -1;
            this.moveHorizontal(enemy, direction, enemy.speed * 1.5);
        }
    }

    /**
     * Update guard AI
     */
    updateGuardAI(enemy, player) {
        if (!player) return;
        
        const distance = Matter.Vector.magnitude(
            Matter.Vector.sub(player.position, enemy.position)
        );
        
        if (distance < 100) { // Guard range
            const direction = player.position.x > enemy.position.x ? 1 : -1;
            this.moveHorizontal(enemy, direction, enemy.speed * 0.5);
        } else {
            // Return to start position
            const returnDirection = enemy.startX > enemy.position.x ? 1 : -1;
            this.moveHorizontal(enemy, returnDirection, enemy.speed * 0.3);
        }
    }

    /**
     * Update collectibles (animations, effects)
     */
    updateCollectibles() {
        this.bodies.forEach((body, id) => {
            if (body.gameType === 'collectible') {
                // Add floating animation
                const time = Date.now() * 0.001;
                const floatForce = { x: 0, y: Math.sin(time * 2) * 0.001 };
                Matter.Body.applyForce(body, body.position, floatForce);
                
                // Add rotation
                Matter.Body.setAngle(body, time);
            }
        });
    }

    /**
     * Remove body from world
     */
    removeBody(bodyId) {
        const body = this.bodies.get(bodyId);
        if (body) {
            Matter.World.remove(this.world, body);
            this.bodies.delete(bodyId);
        }
    }

    /**
     * Remove constraint from world
     */
    removeConstraint(constraintId) {
        const constraint = this.constraints.get(constraintId);
        if (constraint) {
            Matter.World.remove(this.world, constraint);
            this.constraints.delete(constraintId);
        }
    }

    /**
     * Set gravity
     */
    setGravity(x, y) {
        this.engine.world.gravity.x = x;
        this.engine.world.gravity.y = y;
    }

    /**
     * Set time scale
     */
    setTimeScale(scale) {
        this.timeScale = scale;
        this.engine.timing.timeScale = scale;
    }

    /**
     * Get body by ID
     */
    getBody(bodyId) {
        return this.bodies.get(bodyId);
    }

    /**
     * Get all bodies of a specific type
     */
    getBodiesByType(gameType) {
        const result = [];
        this.bodies.forEach((body, id) => {
            if (body.gameType === gameType) {
                result.push({ id, body });
            }
        });
        return result;
    }

    /**
     * Clear all bodies and constraints
     */
    clear() {
        Matter.World.clear(this.world);
        this.bodies.clear();
        this.constraints.clear();
    }

    /**
     * Cleanup and destroy engine
     */
    destroy() {
        this.stop();
        
        if (this.render) {
            Matter.Render.stop(this.render);
            this.render.canvas.remove();
            this.render = null;
        }
        
        if (this.runner) {
            Matter.Runner.stop(this.runner);
            this.runner = null;
        }
        
        this.clear();
        
        if (this.engine) {
            Matter.Engine.clear(this.engine);
            this.engine = null;
        }
        
        this.world = null;
        this.isInitialized = false;
        
        console.log('🗑️ Physics engine destroyed');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdvancedPhysicsEngine;
} else {
    window.AdvancedPhysicsEngine = AdvancedPhysicsEngine;
}