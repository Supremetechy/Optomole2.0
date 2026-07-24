/**
 * Unity Code Generator - Generates Unity C# scripts and project files
 */

class UnityCodeGenerator {
    constructor() {
        this.templates = {
            monoBehaviour: this.getMonoBehaviourTemplate(),
            scriptableObject: this.getScriptableObjectTemplate(),
            interface: this.getInterfaceTemplate(),
            enum: this.getEnumTemplate(),
            staticClass: this.getStaticClassTemplate()
        };
        this.generatedScripts = new Map();
    }

    /**
     * Generate complete Unity project from analysis data
     */
    async generateUnityProject(analysisData, customizations = {}) {
        console.log('🔧 Generating Unity C# scripts...');
        
        const project = {
            scripts: await this.generateAllScripts(analysisData, customizations),
            projectSettings: this.generateProjectSettings(analysisData, customizations),
            scenes: await this.generateSceneFiles(analysisData, customizations),
            prefabs: await this.generatePrefabFiles(analysisData, customizations),
            materials: await this.generateMaterialFiles(analysisData, customizations),
            packageManifest: this.generatePackageManifest(analysisData),
            buildSettings: this.generateBuildSettings(customizations)
        };
        
        console.log('✅ Unity project generation complete');
        return project;
    }

    /**
     * Generate all C# scripts
     */
    async generateAllScripts(analysisData, customizations) {
        const scripts = {};
        
        // Generate PlayerController
        scripts['PlayerController.cs'] = this.generatePlayerController(analysisData, customizations);
        
        // Generate GameManager
        scripts['GameManager.cs'] = this.generateGameManager(analysisData, customizations);
        
        // Generate EnemyAI
        scripts['EnemyAI.cs'] = this.generateEnemyAI(analysisData, customizations);
        
        // Generate UI Manager
        scripts['UIManager.cs'] = this.generateUIManager(analysisData, customizations);
        
        // Generate Audio Manager
        scripts['AudioManager.cs'] = this.generateAudioManager(analysisData, customizations);
        
        // Generate Level Manager
        scripts['LevelManager.cs'] = this.generateLevelManager(analysisData, customizations);
        
        // Generate ScriptableObjects
        scripts['GameConfig.cs'] = this.generateGameConfig(analysisData, customizations);
        scripts['LevelData.cs'] = this.generateLevelData(analysisData, customizations);
        
        // Generate Interfaces
        scripts['ICollectable.cs'] = this.generateICollectable();
        scripts['IDamageable.cs'] = this.generateIDamageable();
        scripts['IInteractable.cs'] = this.generateIInteractable();
        
        // Generate Enums
        scripts['GameEnums.cs'] = this.generateGameEnums(analysisData);
        
        // Generate Utility classes
        scripts['GameUtils.cs'] = this.generateGameUtils();
        scripts['MathUtils.cs'] = this.generateMathUtils();
        
        return scripts;
    }

    /**
     * Generate PlayerController script
     */
    generatePlayerController(analysisData, customizations) {
        const speed = customizations.logic?.playerSpeed || analysisData.gameLogic?.variables?.playerSpeed || 5;
        const jumpHeight = customizations.logic?.jumpHeight || analysisData.gameLogic?.variables?.jumpHeight || 10;
        const hasDoubleJump = customizations.logic?.doubleJump || false;
        
        return `using UnityEngine;
using UnityEngine.InputSystem;

namespace Game.Player
{
    [RequireComponent(typeof(Rigidbody))]
    [RequireComponent(typeof(Collider))]
    public class PlayerController : MonoBehaviour, IDamageable
    {
        [Header("Movement Settings")]
        [SerializeField] private float moveSpeed = ${speed}f;
        [SerializeField] private float jumpHeight = ${jumpHeight}f;
        [SerializeField] private float acceleration = 10f;
        [SerializeField] private float deceleration = 8f;
        ${hasDoubleJump ? '[SerializeField] private bool canDoubleJump = true;' : ''}
        
        [Header("Ground Detection")]
        [SerializeField] private Transform groundCheck;
        [SerializeField] private LayerMask groundLayerMask = 1;
        [SerializeField] private float groundCheckRadius = 0.2f;
        
        [Header("Health")]
        [SerializeField] private int maxHealth = 100;
        [SerializeField] private int currentHealth;
        
        [Header("Audio")]
        [SerializeField] private AudioClip jumpSound;
        [SerializeField] private AudioClip damageSound;
        [SerializeField] private AudioClip collectSound;
        
        // Private fields
        private Rigidbody rb;
        private AudioSource audioSource;
        private PlayerInputActions inputActions;
        private Vector3 moveDirection;
        private bool isGrounded;
        private bool canMove = true;
        ${hasDoubleJump ? 'private bool hasDoubleJumped = false;' : ''}
        
        // Events
        public System.Action<int> OnHealthChanged;
        public System.Action OnPlayerDeath;
        public System.Action<ICollectable> OnItemCollected;
        
        #region Unity Lifecycle
        
        private void Awake()
        {
            rb = GetComponent<Rigidbody>();
            audioSource = GetComponent<AudioSource>();
            inputActions = new PlayerInputActions();
            currentHealth = maxHealth;
            
            // Freeze rotation to prevent player from falling over
            rb.freezeRotation = true;
        }
        
        private void OnEnable()
        {
            inputActions.Player.Enable();
            inputActions.Player.Jump.performed += OnJump;
            inputActions.Player.Move.performed += OnMove;
            inputActions.Player.Move.canceled += OnMoveStop;
        }
        
        private void OnDisable()
        {
            inputActions.Player.Disable();
            inputActions.Player.Jump.performed -= OnJump;
            inputActions.Player.Move.performed -= OnMove;
            inputActions.Player.Move.canceled -= OnMoveStop;
        }
        
        private void Update()
        {
            CheckGrounded();
            HandleMovement();
        }
        
        private void FixedUpdate()
        {
            ApplyMovement();
        }
        
        #endregion
        
        #region Movement
        
        private void HandleMovement()
        {
            if (!canMove) return;
            
            Vector2 input = inputActions.Player.Move.ReadValue<Vector2>();
            moveDirection = new Vector3(input.x, 0, input.y).normalized;
        }
        
        private void ApplyMovement()
        {
            if (!canMove) return;
            
            Vector3 targetVelocity = moveDirection * moveSpeed;
            Vector3 currentVelocity = new Vector3(rb.velocity.x, 0, rb.velocity.z);
            
            float accelerationRate = moveDirection.magnitude > 0 ? acceleration : deceleration;
            Vector3 newVelocity = Vector3.MoveTowards(currentVelocity, targetVelocity, accelerationRate * Time.fixedDeltaTime);
            
            rb.velocity = new Vector3(newVelocity.x, rb.velocity.y, newVelocity.z);
        }
        
        private void CheckGrounded()
        {
            bool wasGrounded = isGrounded;
            isGrounded = Physics.CheckSphere(groundCheck.position, groundCheckRadius, groundLayerMask);
            
            ${hasDoubleJump ? `
            if (isGrounded && !wasGrounded)
            {
                hasDoubleJumped = false;
            }` : ''}
        }
        
        #endregion
        
        #region Input Handlers
        
        private void OnMove(InputAction.CallbackContext context)
        {
            // Movement is handled in Update
        }
        
        private void OnMoveStop(InputAction.CallbackContext context)
        {
            moveDirection = Vector3.zero;
        }
        
        private void OnJump(InputAction.CallbackContext context)
        {
            if (!canMove) return;
            
            ${hasDoubleJump ? `
            if (isGrounded || (!hasDoubleJumped && canDoubleJump))
            {
                if (!isGrounded && canDoubleJump)
                    hasDoubleJumped = true;
                    
                Jump();
            }` : `
            if (isGrounded)
            {
                Jump();
            }`}
        }
        
        #endregion
        
        #region Actions
        
        private void Jump()
        {
            rb.velocity = new Vector3(rb.velocity.x, jumpHeight, rb.velocity.z);
            PlaySound(jumpSound);
        }
        
        public void SetMovementEnabled(bool enabled)
        {
            canMove = enabled;
            if (!enabled)
                rb.velocity = new Vector3(0, rb.velocity.y, 0);
        }
        
        private void PlaySound(AudioClip clip)
        {
            if (audioSource && clip)
                audioSource.PlayOneShot(clip);
        }
        
        #endregion
        
        #region Health & Damage
        
        public void TakeDamage(int damage)
        {
            currentHealth = Mathf.Max(0, currentHealth - damage);
            OnHealthChanged?.Invoke(currentHealth);
            PlaySound(damageSound);
            
            if (currentHealth <= 0)
            {
                Die();
            }
        }
        
        public void Heal(int amount)
        {
            currentHealth = Mathf.Min(maxHealth, currentHealth + amount);
            OnHealthChanged?.Invoke(currentHealth);
        }
        
        public int GetHealth()
        {
            return currentHealth;
        }
        
        public int GetMaxHealth()
        {
            return maxHealth;
        }
        
        private void Die()
        {
            SetMovementEnabled(false);
            OnPlayerDeath?.Invoke();
        }
        
        #endregion
        
        #region Collision & Triggers
        
        private void OnTriggerEnter(Collider other)
        {
            // Handle collectables
            ICollectable collectable = other.GetComponent<ICollectable>();
            if (collectable != null)
            {
                collectable.Collect();
                OnItemCollected?.Invoke(collectable);
                PlaySound(collectSound);
                return;
            }
            
            // Handle damage zones
            IDamageable damageZone = other.GetComponent<IDamageable>();
            if (other.CompareTag("DamageZone"))
            {
                TakeDamage(10);
                return;
            }
        }
        
        private void OnCollisionEnter(Collision collision)
        {
            // Handle enemy collision
            if (collision.gameObject.CompareTag("Enemy"))
            {
                TakeDamage(20);
            }
        }
        
        #endregion
        
        #region Gizmos
        
        private void OnDrawGizmosSelected()
        {
            if (groundCheck)
            {
                Gizmos.color = isGrounded ? Color.green : Color.red;
                Gizmos.DrawWireSphere(groundCheck.position, groundCheckRadius);
            }
        }
        
        #endregion
    }
}`;
    }

    /**
     * Generate GameManager script
     */
    generateGameManager(analysisData, customizations) {
        const lives = customizations.logic?.maxLives || analysisData.gameLogic?.variables?.lives || 3;
        const hasSaveSystem = customizations.logic?.saveProgress || false;
        
        return `using UnityEngine;
using UnityEngine.SceneManagement;
using System.Collections;

namespace Game.Core
{
    public class GameManager : MonoBehaviour
    {
        [Header("Game Settings")]
        [SerializeField] private int maxLives = ${lives};
        [SerializeField] private GameConfig gameConfig;
        ${hasSaveSystem ? '[SerializeField] private bool autoSave = true;' : ''}
        
        [Header("Scene References")]
        [SerializeField] private string mainMenuScene = "MainMenu";
        [SerializeField] private string gameOverScene = "GameOver";
        [SerializeField] private string[] levelScenes;
        
        // Game State
        private GameState currentState = GameState.Menu;
        private int currentScore = 0;
        private int currentLives;
        private int currentLevel = 0;
        private float gameTime = 0f;
        
        // References
        private PlayerController player;
        private UIManager uiManager;
        private AudioManager audioManager;
        
        // Events
        public System.Action<GameState> OnGameStateChanged;
        public System.Action<int> OnScoreChanged;
        public System.Action<int> OnLivesChanged;
        public System.Action<int> OnLevelChanged;
        
        // Singleton
        public static GameManager Instance { get; private set; }
        
        #region Unity Lifecycle
        
        private void Awake()
        {
            // Singleton pattern
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
                InitializeGame();
            }
            else
            {
                Destroy(gameObject);
            }
        }
        
        private void Start()
        {
            StartCoroutine(InitializeGameSystems());
        }
        
        private void Update()
        {
            if (currentState == GameState.Playing)
            {
                gameTime += Time.deltaTime;
            }
            
            HandleInput();
        }
        
        #endregion
        
        #region Initialization
        
        private void InitializeGame()
        {
            currentLives = maxLives;
            Application.targetFrameRate = 60;
            
            ${hasSaveSystem ? `
            // Load saved game if available
            if (autoSave)
            {
                LoadGame();
            }` : ''}
        }
        
        private IEnumerator InitializeGameSystems()
        {
            // Wait for scene to fully load
            yield return new WaitForEndOfFrame();
            
            // Find and initialize references
            player = FindObjectOfType<PlayerController>();
            uiManager = FindObjectOfType<UIManager>();
            audioManager = FindObjectOfType<AudioManager>();
            
            // Subscribe to events
            if (player)
            {
                player.OnPlayerDeath += OnPlayerDied;
                player.OnHealthChanged += OnPlayerHealthChanged;
                player.OnItemCollected += OnItemCollected;
            }
            
            // Initialize UI
            if (uiManager)
            {
                uiManager.UpdateScore(currentScore);
                uiManager.UpdateLives(currentLives);
                uiManager.UpdateLevel(currentLevel + 1);
            }
            
            // Start background music
            if (audioManager)
            {
                audioManager.PlayBackgroundMusic();
            }
        }
        
        #endregion
        
        #region Game State Management
        
        public void StartGame()
        {
            ChangeGameState(GameState.Playing);
            currentScore = 0;
            currentLives = maxLives;
            currentLevel = 0;
            gameTime = 0f;
            
            OnScoreChanged?.Invoke(currentScore);
            OnLivesChanged?.Invoke(currentLives);
            OnLevelChanged?.Invoke(currentLevel + 1);
            
            if (levelScenes.Length > 0)
            {
                LoadLevel(0);
            }
        }
        
        public void PauseGame()
        {
            if (currentState == GameState.Playing)
            {
                ChangeGameState(GameState.Paused);
                Time.timeScale = 0f;
                
                if (uiManager)
                    uiManager.ShowPauseMenu(true);
            }
        }
        
        public void ResumeGame()
        {
            if (currentState == GameState.Paused)
            {
                ChangeGameState(GameState.Playing);
                Time.timeScale = 1f;
                
                if (uiManager)
                    uiManager.ShowPauseMenu(false);
            }
        }
        
        public void GameOver()
        {
            ChangeGameState(GameState.GameOver);
            
            ${hasSaveSystem ? `
            if (autoSave)
            {
                SaveGame();
            }` : ''}
            
            if (uiManager)
                uiManager.ShowGameOverScreen(currentScore, gameTime);
        }
        
        public void RestartLevel()
        {
            Time.timeScale = 1f;
            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
        
        public void LoadMainMenu()
        {
            Time.timeScale = 1f;
            ChangeGameState(GameState.Menu);
            SceneManager.LoadScene(mainMenuScene);
        }
        
        private void ChangeGameState(GameState newState)
        {
            currentState = newState;
            OnGameStateChanged?.Invoke(currentState);
        }
        
        #endregion
        
        #region Level Management
        
        public void LoadLevel(int levelIndex)
        {
            if (levelIndex >= 0 && levelIndex < levelScenes.Length)
            {
                currentLevel = levelIndex;
                OnLevelChanged?.Invoke(currentLevel + 1);
                SceneManager.LoadScene(levelScenes[levelIndex]);
            }
        }
        
        public void LoadNextLevel()
        {
            if (currentLevel + 1 < levelScenes.Length)
            {
                LoadLevel(currentLevel + 1);
            }
            else
            {
                // Game completed
                GameCompleted();
            }
        }
        
        private void GameCompleted()
        {
            ChangeGameState(GameState.Completed);
            
            if (uiManager)
                uiManager.ShowGameCompletedScreen(currentScore, gameTime);
        }
        
        #endregion
        
        #region Score & Lives
        
        public void AddScore(int points)
        {
            currentScore += points;
            OnScoreChanged?.Invoke(currentScore);
            
            if (uiManager)
                uiManager.UpdateScore(currentScore);
        }
        
        public void LoseLife()
        {
            currentLives = Mathf.Max(0, currentLives - 1);
            OnLivesChanged?.Invoke(currentLives);
            
            if (uiManager)
                uiManager.UpdateLives(currentLives);
            
            if (currentLives <= 0)
            {
                GameOver();
            }
            else
            {
                RestartLevel();
            }
        }
        
        public void AddLife()
        {
            currentLives++;
            OnLivesChanged?.Invoke(currentLives);
            
            if (uiManager)
                uiManager.UpdateLives(currentLives);
        }
        
        #endregion
        
        #region Event Handlers
        
        private void OnPlayerDied()
        {
            LoseLife();
        }
        
        private void OnPlayerHealthChanged(int health)
        {
            if (uiManager)
                uiManager.UpdateHealth(health);
        }
        
        private void OnItemCollected(ICollectable item)
        {
            AddScore(item.GetValue());
        }
        
        #endregion
        
        #region Input Handling
        
        private void HandleInput()
        {
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                if (currentState == GameState.Playing)
                    PauseGame();
                else if (currentState == GameState.Paused)
                    ResumeGame();
            }
            
            if (Input.GetKeyDown(KeyCode.R) && currentState == GameState.GameOver)
            {
                RestartLevel();
            }
        }
        
        #endregion
        
        ${hasSaveSystem ? `
        #region Save/Load System
        
        public void SaveGame()
        {
            GameSaveData saveData = new GameSaveData
            {
                currentScore = this.currentScore,
                currentLives = this.currentLives,
                currentLevel = this.currentLevel,
                gameTime = this.gameTime
            };
            
            string json = JsonUtility.ToJson(saveData);
            PlayerPrefs.SetString("GameSave", json);
            PlayerPrefs.Save();
        }
        
        public void LoadGame()
        {
            if (PlayerPrefs.HasKey("GameSave"))
            {
                string json = PlayerPrefs.GetString("GameSave");
                GameSaveData saveData = JsonUtility.FromJson<GameSaveData>(json);
                
                currentScore = saveData.currentScore;
                currentLives = saveData.currentLives;
                currentLevel = saveData.currentLevel;
                gameTime = saveData.gameTime;
            }
        }
        
        #endregion` : ''}
        
        #region Public Getters
        
        public GameState GetCurrentState() => currentState;
        public int GetCurrentScore() => currentScore;
        public int GetCurrentLives() => currentLives;
        public int GetCurrentLevel() => currentLevel;
        public float GetGameTime() => gameTime;
        
        #endregion
    }
    
    ${hasSaveSystem ? `
    [System.Serializable]
    public class GameSaveData
    {
        public int currentScore;
        public int currentLives;
        public int currentLevel;
        public float gameTime;
    }` : ''}
}`;
    }

    // Template methods
    getMonoBehaviourTemplate() {
        return `using UnityEngine;

namespace {namespace}
{
    public class {className} : MonoBehaviour
    {
        {fields}
        
        private void Awake()
        {
            {awakeContent}
        }
        
        private void Start()
        {
            {startContent}
        }
        
        private void Update()
        {
            {updateContent}
        }
        
        {methods}
    }
}`;
    }

    getScriptableObjectTemplate() {
        return `using UnityEngine;

namespace {namespace}
{
    [CreateAssetMenu(fileName = "New {className}", menuName = "{menuName}")]
    public class {className} : ScriptableObject
    {
        {fields}
        
        {methods}
    }
}`;
    }

    getInterfaceTemplate() {
        return `namespace {namespace}
{
    public interface {interfaceName}
    {
        {methods}
    }
}`;
    }

    getEnumTemplate() {
        return `namespace {namespace}
{
    public enum {enumName}
    {
        {values}
    }
}`;
    }

    getStaticClassTemplate() {
        return `using UnityEngine;

namespace {namespace}
{
    public static class {className}
    {
        {methods}
    }
}`;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnityCodeGenerator;
} else {
    window.UnityCodeGenerator = UnityCodeGenerator;
}