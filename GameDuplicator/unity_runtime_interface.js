/**
 * Unity Runtime Interface - Direct communication with Unity WebGL builds
 */

class UnityRuntimeInterface {
    constructor() {
        this.unityInstances = new Map();
        this.messageCallbacks = new Map();
        this.interceptedData = new Map();
        this.isMonitoring = false;
        this.capturedEvents = [];
        this.gameAnalysisData = null;
    }

    /**
     * Hook into Unity WebGL build to extract runtime data
     */
    async hookIntoUnityBuild(gameUrl, options = {}) {
        console.log('🔗 Hooking into Unity WebGL build...');
        
        try {
            // Load Unity game in hidden iframe
            const gameFrame = await this.loadUnityInFrame(gameUrl);
            
            // Inject monitoring scripts
            await this.injectMonitoringScripts(gameFrame);
            
            // Start data capture
            this.startDataCapture(gameFrame);
            
            // Wait for initial data collection
            await this.waitForInitialData(options.captureTime || 30000);
            
            // Analyze captured data
            const analysisData = await this.analyzeRuntimeData();
            
            console.log('✅ Unity WebGL hook complete');
            return analysisData;
            
        } catch (error) {
            console.error('Unity WebGL hook failed:', error);
            throw error;
        }
    }

    /**
     * Load Unity game in hidden iframe for analysis
     */
    async loadUnityInFrame(gameUrl) {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.style.width = '960px';
            iframe.style.height = '600px';
            iframe.sandbox = 'allow-scripts allow-same-origin';
            
            iframe.onload = () => {
                console.log('📱 Unity game loaded in iframe');
                resolve(iframe);
            };
            
            iframe.onerror = () => {
                reject(new Error('Failed to load Unity game'));
            };
            
            iframe.src = gameUrl;
            document.body.appendChild(iframe);
            
            // Store reference
            this.currentGameFrame = iframe;
        });
    }

    /**
     * Inject monitoring scripts into Unity game
     */
    async injectMonitoringScripts(gameFrame) {
        const injectionScript = `
        (function() {
            // Unity WebGL monitoring interface
            window.GameDuplicatorMonitor = {
                capturedData: {
                    gameObjects: [],
                    components: [],
                    scripts: [],
                    assets: [],
                    events: [],
                    network: [],
                    performance: []
                },
                
                // Hook into Unity's messaging system
                interceptUnityMessages: function() {
                    if (window.unityInstance) {
                        const originalSendMessage = window.unityInstance.SendMessage;
                        window.unityInstance.SendMessage = function(gameObject, method, value) {
                            // Capture the message
                            window.GameDuplicatorMonitor.capturedData.events.push({
                                type: 'SendMessage',
                                gameObject: gameObject,
                                method: method,
                                value: value,
                                timestamp: Date.now()
                            });
                            
                            // Call original function
                            return originalSendMessage.call(this, gameObject, method, value);
                        };
                    }
                },
                
                // Monitor WebGL API calls
                monitorWebGL: function() {
                    const canvas = document.querySelector('canvas');
                    if (canvas) {
                        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
                        if (gl) {
                            // Hook into texture loading
                            const originalTexImage2D = gl.texImage2D;
                            gl.texImage2D = function(...args) {
                                window.GameDuplicatorMonitor.capturedData.assets.push({
                                    type: 'texture',
                                    width: args[3],
                                    height: args[4],
                                    format: args[6],
                                    timestamp: Date.now()
                                });
                                return originalTexImage2D.apply(this, args);
                            };
                            
                            // Hook into shader compilation
                            const originalCreateShader = gl.createShader;
                            gl.createShader = function(type) {
                                const shader = originalCreateShader.call(this, type);
                                window.GameDuplicatorMonitor.capturedData.assets.push({
                                    type: 'shader',
                                    shaderType: type === gl.VERTEX_SHADER ? 'vertex' : 'fragment',
                                    timestamp: Date.now()
                                });
                                return shader;
                            };
                        }
                    }
                },
                
                // Monitor network requests
                monitorNetwork: function() {
                    const originalFetch = window.fetch;
                    window.fetch = function(...args) {
                        const url = args[0];
                        window.GameDuplicatorMonitor.capturedData.network.push({
                            type: 'fetch',
                            url: url,
                            timestamp: Date.now()
                        });
                        return originalFetch.apply(this, args);
                    };
                    
                    const originalXHR = window.XMLHttpRequest.prototype.open;
                    window.XMLHttpRequest.prototype.open = function(method, url) {
                        window.GameDuplicatorMonitor.capturedData.network.push({
                            type: 'xhr',
                            method: method,
                            url: url,
                            timestamp: Date.now()
                        });
                        return originalXHR.apply(this, arguments);
                    };
                },
                
                // Monitor input events
                monitorInput: function() {
                    ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'wheel'].forEach(eventType => {
                        document.addEventListener(eventType, function(event) {
                            window.GameDuplicatorMonitor.capturedData.events.push({
                                type: 'input',
                                eventType: eventType,
                                key: event.key || event.button,
                                timestamp: Date.now()
                            });
                        }, true);
                    });
                },
                
                // Monitor performance
                monitorPerformance: function() {
                    setInterval(() => {
                        window.GameDuplicatorMonitor.capturedData.performance.push({
                            fps: this.calculateFPS(),
                            memory: performance.memory ? performance.memory.usedJSHeapSize : 0,
                            timestamp: Date.now()
                        });
                    }, 1000);
                },
                
                calculateFPS: function() {
                    // Simple FPS calculation
                    if (!this.lastTime) this.lastTime = performance.now();
                    if (!this.frameCount) this.frameCount = 0;
                    
                    this.frameCount++;
                    const now = performance.now();
                    const delta = now - this.lastTime;
                    
                    if (delta >= 1000) {
                        const fps = Math.round((this.frameCount * 1000) / delta);
                        this.frameCount = 0;
                        this.lastTime = now;
                        return fps;
                    }
                    return 60; // Default
                },
                
                // Extract Unity build information
                extractBuildInfo: function() {
                    const scripts = Array.from(document.scripts);
                    const unityScript = scripts.find(script => 
                        script.src.includes('Build/') && script.src.includes('.js')
                    );
                    
                    if (unityScript) {
                        // Try to determine Unity version from build files
                        this.capturedData.buildInfo = {
                            hasUnityScript: true,
                            scriptUrl: unityScript.src,
                            buildPath: unityScript.src.substring(0, unityScript.src.lastIndexOf('/')),
                            detectedAt: Date.now()
                        };
                    }
                },
                
                // Initialize all monitoring
                initialize: function() {
                    this.extractBuildInfo();
                    this.monitorNetwork();
                    this.monitorInput();
                    this.monitorPerformance();
                    this.monitorWebGL();
                    
                    // Wait for Unity to load then hook messages
                    const checkUnity = setInterval(() => {
                        if (window.unityInstance) {
                            this.interceptUnityMessages();
                            clearInterval(checkUnity);
                        }
                    }, 100);
                },
                
                // Get all captured data
                getCapturedData: function() {
                    return this.capturedData;
                }
            };
            
            // Start monitoring immediately
            window.GameDuplicatorMonitor.initialize();
            
            // Signal parent that monitoring is ready
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'unity-monitor-ready',
                    source: 'GameDuplicatorMonitor'
                }, '*');
            }
        })();
        `;
        
        // Inject the script into the iframe
        const script = gameFrame.contentDocument.createElement('script');
        script.textContent = injectionScript;
        gameFrame.contentDocument.head.appendChild(script);
        
        console.log('💉 Monitoring scripts injected');
    }

    /**
     * Start capturing data from Unity game
     */
    startDataCapture(gameFrame) {
        this.isMonitoring = true;
        
        // Listen for messages from monitoring script
        window.addEventListener('message', (event) => {
            if (event.data.type === 'unity-monitor-ready') {
                console.log('📡 Unity monitoring active');
            }
        });
        
        // Periodically collect data
        this.dataCollectionInterval = setInterval(() => {
            this.collectFrameData(gameFrame);
        }, 1000);
    }

    /**
     * Collect data from the monitoring frame
     */
    collectFrameData(gameFrame) {
        try {
            const monitor = gameFrame.contentWindow.GameDuplicatorMonitor;
            if (monitor) {
                const data = monitor.getCapturedData();
                
                // Store captured events
                this.capturedEvents.push({
                    timestamp: Date.now(),
                    data: JSON.parse(JSON.stringify(data))
                });
                
                // Limit stored events to prevent memory issues
                if (this.capturedEvents.length > 100) {
                    this.capturedEvents.shift();
                }
            }
        } catch (error) {
            console.warn('Failed to collect frame data:', error);
        }
    }

    /**
     * Wait for initial data collection period
     */
    async waitForInitialData(captureTime) {
        console.log(`⏱️ Collecting data for ${captureTime/1000} seconds...`);
        
        return new Promise((resolve) => {
            setTimeout(() => {
                this.stopDataCapture();
                resolve();
            }, captureTime);
        });
    }

    /**
     * Stop data capture
     */
    stopDataCapture() {
        this.isMonitoring = false;
        
        if (this.dataCollectionInterval) {
            clearInterval(this.dataCollectionInterval);
        }
        
        if (this.currentGameFrame) {
            this.currentGameFrame.remove();
        }
        
        console.log('⏹️ Data capture stopped');
    }

    /**
     * Analyze captured runtime data
     */
    async analyzeRuntimeData() {
        console.log('🔍 Analyzing captured Unity data...');
        
        const aggregatedData = this.aggregateCapturedData();
        
        const analysis = {
            gameInfo: this.extractGameInfo(aggregatedData),
            assets: this.analyzeAssets(aggregatedData),
            scripts: this.analyzeScripts(aggregatedData),
            input: this.analyzeInput(aggregatedData),
            performance: this.analyzePerformance(aggregatedData),
            network: this.analyzeNetwork(aggregatedData),
            gameObjects: this.analyzeGameObjects(aggregatedData),
            buildInfo: this.extractBuildInfo(aggregatedData)
        };
        
        this.gameAnalysisData = analysis;
        return analysis;
    }

    /**
     * Aggregate all captured data
     */
    aggregateCapturedData() {
        const aggregated = {
            gameObjects: [],
            components: [],
            scripts: [],
            assets: [],
            events: [],
            network: [],
            performance: [],
            buildInfo: null
        };
        
        this.capturedEvents.forEach(event => {
            Object.keys(aggregated).forEach(key => {
                if (event.data[key]) {
                    if (Array.isArray(aggregated[key])) {
                        aggregated[key].push(...event.data[key]);
                    } else {
                        aggregated[key] = event.data[key];
                    }
                }
            });
        });
        
        return aggregated;
    }

    /**
     * Extract game information
     */
    extractGameInfo(data) {
        return {
            title: document.title || 'Unity Game',
            detectedUnity: data.buildInfo?.hasUnityScript || false,
            buildPath: data.buildInfo?.buildPath || '',
            captureDate: new Date().toISOString(),
            totalEvents: data.events.length,
            totalAssets: data.assets.length,
            networkRequests: data.network.length
        };
    }

    /**
     * Analyze captured assets
     */
    analyzeAssets(data) {
        const textures = data.assets.filter(a => a.type === 'texture');
        const shaders = data.assets.filter(a => a.type === 'shader');
        
        return {
            textures: {
                count: textures.length,
                sizes: this.getTextureSizes(textures),
                formats: this.getTextureFormats(textures)
            },
            shaders: {
                count: shaders.length,
                vertexShaders: shaders.filter(s => s.shaderType === 'vertex').length,
                fragmentShaders: shaders.filter(s => s.shaderType === 'fragment').length
            },
            totalAssets: data.assets.length
        };
    }

    /**
     * Analyze script behavior
     */
    analyzeScripts(data) {
        const sendMessages = data.events.filter(e => e.type === 'SendMessage');
        
        return {
            unityMessages: {
                count: sendMessages.length,
                gameObjects: [...new Set(sendMessages.map(m => m.gameObject))],
                methods: [...new Set(sendMessages.map(m => m.method))]
            },
            detectedGameObjects: [...new Set(sendMessages.map(m => m.gameObject))],
            detectedMethods: [...new Set(sendMessages.map(m => m.method))]
        };
    }

    /**
     * Analyze input patterns
     */
    analyzeInput(data) {
        const inputEvents = data.events.filter(e => e.type === 'input');
        
        return {
            totalInputEvents: inputEvents.length,
            keyboardEvents: inputEvents.filter(e => e.eventType.includes('key')).length,
            mouseEvents: inputEvents.filter(e => e.eventType.includes('mouse')).length,
            detectedKeys: [...new Set(inputEvents.map(e => e.key).filter(k => k))],
            inputTypes: [...new Set(inputEvents.map(e => e.eventType))]
        };
    }

    /**
     * Analyze performance data
     */
    analyzePerformance(data) {
        const perfData = data.performance;
        
        if (perfData.length === 0) {
            return { fps: 'Unknown', memory: 'Unknown', samples: 0 };
        }
        
        const avgFps = perfData.reduce((sum, p) => sum + p.fps, 0) / perfData.length;
        const avgMemory = perfData.reduce((sum, p) => sum + p.memory, 0) / perfData.length;
        
        return {
            averageFPS: Math.round(avgFps),
            averageMemory: Math.round(avgMemory / 1024 / 1024) + ' MB',
            samples: perfData.length,
            fpsRange: {
                min: Math.min(...perfData.map(p => p.fps)),
                max: Math.max(...perfData.map(p => p.fps))
            }
        };
    }

    /**
     * Analyze network requests
     */
    analyzeNetwork(data) {
        return {
            totalRequests: data.network.length,
            requestTypes: [...new Set(data.network.map(n => n.type))],
            requestedUrls: [...new Set(data.network.map(n => n.url))],
            assetRequests: data.network.filter(n => 
                n.url.includes('.png') || n.url.includes('.jpg') || 
                n.url.includes('.ogg') || n.url.includes('.mp3') ||
                n.url.includes('.data') || n.url.includes('.wasm')
            ).length
        };
    }

    /**
     * Analyze game objects
     */
    analyzeGameObjects(data) {
        const sendMessages = data.events.filter(e => e.type === 'SendMessage');
        const gameObjects = [...new Set(sendMessages.map(m => m.gameObject))];
        
        return gameObjects.map(name => ({
            name: name,
            messageCount: sendMessages.filter(m => m.gameObject === name).length,
            methods: [...new Set(sendMessages.filter(m => m.gameObject === name).map(m => m.method))]
        }));
    }

    /**
     * Extract build information
     */
    extractBuildInfo(data) {
        return data.buildInfo || {
            hasUnityScript: false,
            detectedVersion: 'Unknown',
            buildPath: '',
            compressionFormat: 'Unknown'
        };
    }

    // Helper methods
    getTextureSizes(textures) {
        return [...new Set(textures.map(t => `${t.width}x${t.height}`))];
    }

    getTextureFormats(textures) {
        return [...new Set(textures.map(t => t.format))];
    }

    /**
     * Generate Unity recreation data
     */
    generateRecreationData() {
        if (!this.gameAnalysisData) {
            throw new Error('No analysis data available');
        }
        
        return {
            projectStructure: this.generateProjectStructure(),
            scripts: this.generateScriptTemplates(),
            scenes: this.generateSceneData(),
            assets: this.generateAssetList(),
            buildSettings: this.generateBuildSettings()
        };
    }

    generateProjectStructure() {
        return {
            folders: [
                'Assets/Scripts',
                'Assets/Scenes',
                'Assets/Prefabs',
                'Assets/Materials',
                'Assets/Textures',
                'Assets/Audio'
            ],
            packages: [
                'com.unity.inputsystem',
                'com.unity.render-pipelines.universal'
            ]
        };
    }

    generateScriptTemplates() {
        const templates = {};
        
        if (this.gameAnalysisData.scripts.detectedGameObjects) {
            this.gameAnalysisData.scripts.detectedGameObjects.forEach(gameObject => {
                templates[`${gameObject}Controller.cs`] = this.generateControllerScript(gameObject);
            });
        }
        
        return templates;
    }

    generateControllerScript(gameObjectName) {
        const methods = this.gameAnalysisData.scripts.detectedMethods || [];
        
        return `using UnityEngine;

public class ${gameObjectName}Controller : MonoBehaviour
{
    private void Start()
    {
        // Initialize ${gameObjectName}
    }
    
    private void Update()
    {
        // Update ${gameObjectName} logic
    }
    
${methods.map(method => `    
    public void ${method}()
    {
        // Implement ${method} logic
    }`).join('\n')}
}`;
    }

    generateSceneData() {
        return this.gameAnalysisData.gameObjects.map(go => ({
            name: go.name,
            components: ['Transform', `${go.name}Controller`],
            methods: go.methods
        }));
    }

    generateAssetList() {
        return {
            textures: this.gameAnalysisData.assets.textures.count,
            shaders: this.gameAnalysisData.assets.shaders.count,
            estimatedSize: '50 MB'
        };
    }

    generateBuildSettings() {
        return {
            platform: 'WebGL',
            compressionFormat: 'Gzip',
            codeOptimization: 'Size',
            stripEngineCode: true
        };
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.stopDataCapture();
        this.unityInstances.clear();
        this.messageCallbacks.clear();
        this.interceptedData.clear();
        this.capturedEvents = [];
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnityRuntimeInterface;
} else {
    window.UnityRuntimeInterface = UnityRuntimeInterface;
}