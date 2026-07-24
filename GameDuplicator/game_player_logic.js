/**
 * Game Player Logic - Game update and rendering methods
 */

// Extend the GamePlayer class with game logic
Object.assign(GamePlayer.prototype, {
    /**
     * Update game logic
     */
    updateGame() {
        if (!this.isPlaying || this.isPaused) return;
        
        // Update game time
        this.gameState.time += 1/60;
        
        // Update player
        this.updatePlayer();
        
        // Update game objects
        this.updateGameObjects();
        
        // Check collisions
        this.checkCollisions();
        
        // Update HUD
        this.updateHUD();
        
        // Check win/lose conditions
        this.checkGameConditions();
    },

    /**
     * Update player physics and movement
     */
    updatePlayer() {
        const player = this.gameState.player;
        const input = this.inputManager;
        
        // Handle input
        let moveX = 0;
        if (input.keys['ArrowLeft'] || input.keys['KeyA']) {
            moveX = -1;
        }
        if (input.keys['ArrowRight'] || input.keys['KeyD']) {
            moveX = 1;
        }
        
        // Jump
        if ((input.keys['Space'] || input.keys['ArrowUp'] || input.keys['KeyW']) && player.grounded) {
            player.velocityY = -player.jumpPower;
            player.grounded = false;
        }
        
        // Apply movement
        player.velocityX = moveX * player.speed;
        
        // Apply gravity
        player.velocityY += 0.8; // Gravity
        
        // Update position
        player.x += player.velocityX;
        player.y += player.velocityY;
        
        // Ground collision (simple)
        if (player.y + player.height > 500) {
            player.y = 500 - player.height;
            player.velocityY = 0;
            player.grounded = true;
        }
        
        // Screen boundaries
        player.x = Math.max(0, Math.min(this.gameCanvas.width - player.width, player.x));
        
        // Fall off screen - lose life
        if (player.y > this.gameCanvas.height + 100) {
            this.loseLife();
        }
    },

    /**
     * Update game objects (enemies, collectibles, etc.)
     */
    updateGameObjects() {
        this.gameState.gameObjects.forEach(obj => {
            if (obj.type === 'basic' && obj.speed) {
                // Basic enemy movement
                obj.x += obj.speed * obj.direction;
                
                // Bounce off platforms
                if (obj.x <= 0 || obj.x >= this.gameCanvas.width - obj.width) {
                    obj.direction *= -1;
                }
            }
        });
    },

    /**
     * Check collisions between game objects
     */
    checkCollisions() {
        const player = this.gameState.player;
        
        this.gameState.gameObjects.forEach((obj, index) => {
            if (this.isColliding(player, obj)) {
                // Platform collision
                if (obj.color === '#2C3E50' || obj.color === '#34495E') {
                    this.handlePlatformCollision(player, obj);
                }
                // Collectible collision
                else if (obj.type === 'coin' || obj.type === 'gem') {
                    this.collectItem(obj, index);
                }
                // Enemy collision
                else if (obj.type === 'basic') {
                    this.handleEnemyCollision(obj);
                }
            }
        });
    },

    /**
     * Check if two objects are colliding
     */
    isColliding(obj1, obj2) {
        return obj1.x < obj2.x + obj2.width &&
               obj1.x + obj1.width > obj2.x &&
               obj1.y < obj2.y + obj2.height &&
               obj1.y + obj1.height > obj2.y;
    },

    /**
     * Handle platform collision
     */
    handlePlatformCollision(player, platform) {
        // Simple top collision
        if (player.velocityY > 0 && player.y < platform.y) {
            player.y = platform.y - player.height;
            player.velocityY = 0;
            player.grounded = true;
        }
    },

    /**
     * Collect an item
     */
    collectItem(item, index) {
        this.gameState.score += item.value;
        this.gameState.gameObjects.splice(index, 1);
        this.showGameMessage(`+${item.value} points!`, 'success', 1000);
        this.playSound('collect');
    },

    /**
     * Handle enemy collision
     */
    handleEnemyCollision(enemy) {
        const player = this.gameState.player;
        
        // Check if player is jumping on enemy
        if (player.velocityY > 0 && player.y < enemy.y - 10) {
            // Player defeats enemy
            const index = this.gameState.gameObjects.indexOf(enemy);
            if (index > -1) {
                this.gameState.gameObjects.splice(index, 1);
                this.gameState.score += 100;
                player.velocityY = -8; // Bounce
                this.showGameMessage('+100 points!', 'success', 1000);
                this.playSound('defeat');
            }
        } else {
            // Player takes damage
            this.loseLife();
        }
    },

    /**
     * Lose a life
     */
    loseLife() {
        this.gameState.lives--;
        this.resetPlayerPosition();
        this.showGameMessage('Life Lost!', 'error', 2000);
        this.playSound('damage');
        
        if (this.gameState.lives <= 0) {
            this.gameOver();
        }
    },

    /**
     * Reset player to starting position
     */
    resetPlayerPosition() {
        const player = this.gameState.player;
        player.x = 100;
        player.y = 300;
        player.velocityX = 0;
        player.velocityY = 0;
        player.grounded = false;
    },

    /**
     * Check game win/lose conditions
     */
    checkGameConditions() {
        // Check if all collectibles are collected
        const hasCollectibles = this.gameState.gameObjects.some(obj => 
            obj.type === 'coin' || obj.type === 'gem'
        );
        
        if (!hasCollectibles) {
            this.levelComplete();
        }
    },

    /**
     * Level completed
     */
    levelComplete() {
        this.pauseGame();
        this.gameState.level++;
        this.gameState.score += 1000; // Level bonus
        this.showGameMessage('Level Complete!', 'success', 3000);
        this.playSound('victory');
        
        // Generate new level after delay
        setTimeout(() => {
            this.generateNewLevel();
            this.startGame();
        }, 3000);
    },

    /**
     * Game over
     */
    gameOver() {
        this.stopGame();
        this.showGameMessage('Game Over!', 'error', 5000);
        this.playSound('gameOver');
        this.saveGameStats();
        
        // Show restart option
        setTimeout(() => {
            if (confirm('Game Over! Would you like to restart?')) {
                this.restartGame();
            }
        }, 2000);
    },

    /**
     * Generate a new level
     */
    generateNewLevel() {
        // Clear old collectibles and enemies
        this.gameState.gameObjects = this.gameState.gameObjects.filter(obj => 
            obj.color === '#2C3E50' || obj.color === '#34495E'
        );
        
        // Add new collectibles
        const numCoins = 3 + this.gameState.level;
        for (let i = 0; i < numCoins; i++) {
            this.gameState.gameObjects.push({
                x: 150 + Math.random() * 500,
                y: 100 + Math.random() * 300,
                width: 20,
                height: 20,
                color: '#F39C12',
                type: 'coin',
                value: 10
            });
        }
        
        // Add new enemies
        const numEnemies = 1 + Math.floor(this.gameState.level / 2);
        for (let i = 0; i < numEnemies; i++) {
            this.gameState.gameObjects.push({
                x: 200 + Math.random() * 400,
                y: 350,
                width: 25,
                height: 25,
                color: '#E74C3C',
                speed: 1 + Math.random() * 2,
                direction: Math.random() > 0.5 ? 1 : -1,
                type: 'basic'
            });
        }
        
        this.resetPlayerPosition();
    },

    /**
     * Render the game
     */
    renderGame() {
        if (!this.gameContext) return;
        
        const ctx = this.gameContext;
        const canvas = this.gameCanvas;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw background
        this.drawBackground(ctx, canvas);
        
        // Draw game objects
        this.gameState.gameObjects.forEach(obj => {
            this.drawGameObject(ctx, obj);
        });
        
        // Draw player
        this.drawPlayer(ctx);
        
        // Draw effects
        this.drawEffects(ctx);
    },

    /**
     * Draw background
     */
    drawBackground(ctx, canvas) {
        // Sky gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(1, '#98FB98');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Clouds (simple)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 0; i < 3; i++) {
            const x = (i * 200) + (this.gameState.time * 10) % (canvas.width + 100);
            this.drawCloud(ctx, x, 50 + i * 30);
        }
    },

    /**
     * Draw a simple cloud
     */
    drawCloud(ctx, x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.arc(x + 25, y, 30, 0, Math.PI * 2);
        ctx.arc(x + 50, y, 20, 0, Math.PI * 2);
        ctx.fill();
    },

    /**
     * Draw a game object
     */
    drawGameObject(ctx, obj) {
        ctx.fillStyle = obj.color;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        // Add some visual flair for different object types
        if (obj.type === 'coin') {
            ctx.fillStyle = '#F1C40F';
            ctx.beginPath();
            ctx.arc(obj.x + obj.width/2, obj.y + obj.height/2, obj.width/2 - 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (obj.type === 'gem') {
            ctx.fillStyle = '#E74C3C';
            ctx.beginPath();
            ctx.moveTo(obj.x + obj.width/2, obj.y);
            ctx.lineTo(obj.x + obj.width, obj.y + obj.height/2);
            ctx.lineTo(obj.x + obj.width/2, obj.y + obj.height);
            ctx.lineTo(obj.x, obj.y + obj.height/2);
            ctx.closePath();
            ctx.fill();
        } else if (obj.type === 'basic') {
            // Add eyes to enemies
            ctx.fillStyle = 'white';
            ctx.fillRect(obj.x + 5, obj.y + 5, 5, 5);
            ctx.fillRect(obj.x + 15, obj.y + 5, 5, 5);
            ctx.fillStyle = 'black';
            ctx.fillRect(obj.x + 6, obj.y + 6, 3, 3);
            ctx.fillRect(obj.x + 16, obj.y + 6, 3, 3);
        }
    },

    /**
     * Draw the player
     */
    drawPlayer(ctx) {
        const player = this.gameState.player;
        
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, player.width, player.height);
        
        // Add player details
        ctx.fillStyle = 'white';
        ctx.fillRect(player.x + 8, player.y + 8, 6, 6);
        ctx.fillRect(player.x + 18, player.y + 8, 6, 6);
        
        // Player direction indicator
        if (this.inputManager.keys['ArrowLeft'] || this.inputManager.keys['KeyA']) {
            ctx.fillStyle = 'red';
            ctx.fillRect(player.x + 2, player.y + 16, 4, 4);
        } else if (this.inputManager.keys['ArrowRight'] || this.inputManager.keys['KeyD']) {
            ctx.fillStyle = 'red';
            ctx.fillRect(player.x + 26, player.y + 16, 4, 4);
        }
    },

    /**
     * Draw visual effects
     */
    drawEffects(ctx) {
        // Draw particle effects, screen shake, etc.
        // This could be expanded with more sophisticated effects
    },

    /**
     * Update HUD elements
     */
    updateHUD() {
        document.getElementById('scoreDisplay').textContent = this.gameState.score;
        document.getElementById('livesDisplay').textContent = this.gameState.lives;
        document.getElementById('levelDisplay').textContent = this.gameState.level;
        
        const minutes = Math.floor(this.gameState.time / 60);
        const seconds = Math.floor(this.gameState.time % 60);
        document.getElementById('timeDisplay').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    },

    /**
     * Show game message
     */
    showGameMessage(message, type = 'info', duration = 3000) {
        const messagesContainer = document.getElementById('gameMessages');
        
        const messageElement = document.createElement('div');
        messageElement.className = `game-message bg-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-600 bg-opacity-90 text-white px-6 py-3 rounded-lg font-bold text-xl`;
        messageElement.textContent = message;
        
        messagesContainer.appendChild(messageElement);
        
        setTimeout(() => {
            messageElement.remove();
        }, duration);
    },

    /**
     * Handle keyboard input
     */
    handleKeyDown(event) {
        if (!this.isPlaying) return;
        
        this.inputManager.keys[event.code] = true;
        
        // Prevent default browser behavior for game keys
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
            event.preventDefault();
        }
    },

    /**
     * Handle keyboard release
     */
    handleKeyUp(event) {
        this.inputManager.keys[event.code] = false;
    },

    /**
     * Handle mobile input
     */
    handleMobileInput(action, pressed) {
        const keyMap = {
            'left': 'ArrowLeft',
            'right': 'ArrowRight',
            'jump': 'Space',
            'action': 'Space'
        };
        
        const key = keyMap[action];
        if (key) {
            this.inputManager.keys[key] = pressed;
        }
    },

    /**
     * Play sound effect
     */
    playSound(soundName) {
        // Simple sound implementation
        if (!this.audioManager.context) return;
        
        // This would play actual sound files in a real implementation
        console.log(`🔊 Playing sound: ${soundName}`);
    },

    /**
     * Update audio volume
     */
    updateAudioVolume() {
        this.audioManager.volume = this.settings.volume;
        // Update all audio sources with new volume
    },

    /**
     * Update controls guide
     */
    updateControlsGuide() {
        const guide = document.getElementById('controlsGuide');
        guide.innerHTML = `
            <div class="flex justify-between">
                <span>Move:</span>
                <span>← → or A D</span>
            </div>
            <div class="flex justify-between">
                <span>Jump:</span>
                <span>Space or ↑ or W</span>
            </div>
            <div class="flex justify-between">
                <span>Pause:</span>
                <span>P or Esc</span>
            </div>
        `;
    },

    /**
     * Update game features display
     */
    updateGameFeatures() {
        const features = document.getElementById('gameFeatures');
        const gameFeatures = [
            'Physics-based movement',
            'Collectible items',
            'Enemy AI',
            'Multiple levels',
            'Score system'
        ];
        
        features.innerHTML = gameFeatures.map(feature => 
            `<div class="flex items-center text-sm text-gray-300">
                <i class="fas fa-check text-green-400 mr-2"></i>
                ${feature}
            </div>`
        ).join('');
    },

    /**
     * Load game statistics
     */
    loadGameStats() {
        const gameId = this.currentGame?.project?.id || 'default';
        const stats = JSON.parse(localStorage.getItem(`gameStats_${gameId}`)) || {
            highScore: 0,
            bestTime: 0,
            gamesPlayed: 0,
            completion: 0
        };
        
        document.getElementById('highScore').textContent = stats.highScore;
        document.getElementById('bestTime').textContent = stats.bestTime > 0 ? 
            `${Math.floor(stats.bestTime / 60)}:${Math.floor(stats.bestTime % 60).toString().padStart(2, '0')}` : '--:--';
        document.getElementById('gamesPlayed').textContent = stats.gamesPlayed;
        document.getElementById('completion').textContent = stats.completion + '%';
    },

    /**
     * Save game statistics
     */
    saveGameStats() {
        const gameId = this.currentGame?.project?.id || 'default';
        const currentStats = JSON.parse(localStorage.getItem(`gameStats_${gameId}`)) || {
            highScore: 0,
            bestTime: 0,
            gamesPlayed: 0,
            completion: 0
        };
        
        const newStats = {
            highScore: Math.max(currentStats.highScore, this.gameState.score),
            bestTime: currentStats.bestTime === 0 ? this.gameState.time : Math.min(currentStats.bestTime, this.gameState.time),
            gamesPlayed: currentStats.gamesPlayed + 1,
            completion: Math.max(currentStats.completion, (this.gameState.level - 1) * 20)
        };
        
        localStorage.setItem(`gameStats_${gameId}`, JSON.stringify(newStats));
        this.loadGameStats(); // Refresh display
    },

    /**
     * Show settings modal
     */
    showSettings() {
        document.getElementById('gameSettingsModal').classList.remove('hidden');
    },

    /**
     * Hide settings modal
     */
    hideSettings() {
        document.getElementById('gameSettingsModal').classList.add('hidden');
    },

    /**
     * Save settings
     */
    saveSettings() {
        this.settings.volume = document.getElementById('volumeSlider').value / 100;
        this.settings.quality = document.getElementById('qualitySelect').value;
        this.settings.controls = document.getElementById('controlsSelect').value;
        
        // Apply settings
        this.updateAudioVolume();
        if (this.gameContext) {
            this.gameContext.imageSmoothingEnabled = this.settings.quality !== 'low';
        }
        
        // Save to localStorage
        localStorage.setItem('gamePlayerSettings', JSON.stringify(this.settings));
        
        this.hideSettings();
        this.showGameMessage('Settings saved!', 'success', 2000);
    },

    /**
     * Reset settings to defaults
     */
    resetSettings() {
        document.getElementById('volumeSlider').value = 80;
        document.getElementById('volumeValue').textContent = '80%';
        document.getElementById('qualitySelect').value = 'medium';
        document.getElementById('controlsSelect').value = 'keyboard';
        
        document.getElementById('showFPS').checked = false;
        document.getElementById('enableDebug').checked = false;
        document.getElementById('autoSave').checked = true;
    },

    /**
     * Toggle fullscreen
     */
    toggleFullscreen() {
        const gameContainer = document.getElementById('gameCanvasContainer');
        
        if (!document.fullscreenElement) {
            gameContainer.requestFullscreen();
            document.getElementById('fullscreenBtn').innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            document.exitFullscreen();
            document.getElementById('fullscreenBtn').innerHTML = '<i class="fas fa-expand"></i>';
        }
    },

    /**
     * Share game
     */
    shareGame() {
        if (navigator.share) {
            navigator.share({
                title: this.currentGame.name,
                text: `Check out this game I'm playing: ${this.currentGame.name}`,
                url: window.location.href
            });
        } else {
            // Fallback: copy link to clipboard
            navigator.clipboard.writeText(window.location.href);
            this.showGameMessage('Game link copied to clipboard!', 'success', 2000);
        }
    },

    /**
     * Edit game (opens customization panel)
     */
    editGame() {
        if (this.currentGame && window.customizationPanel) {
            this.pauseGame();
            this.hideGamePlayer();
            window.customizationPanel.init(this.currentGame.project?.analysisData);
            window.customizationPanel.show();
        }
    },

    /**
     * Export game
     */
    exportGame() {
        if (this.currentGame && window.projectManager) {
            const projectId = this.currentGame.project?.id;
            if (projectId) {
                window.projectManager.exportProject(projectId, 'zip');
            }
        }
    }
});

console.log('🎮 Game Player Logic loaded');