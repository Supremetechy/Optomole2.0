# Optomole Fine-Tuning & Training Scheme
This document outlines the fine-tuning training scheme, dataset formatting, and system prompt structure required to train a Large Language Model (e.g., Gemini, GPT-4, Llama 3) to act as the **Optomole Experience Compiler**.

The compiler's sole job is to transform raw, draining unstructured content (emails, textbook chapters, documentation, research papers, account notices) into a structured, highly coherent, and portable game specification format: **ExperienceManifest.json** (XIR).

---

## 1. Portable Experience Schema (XIR Format)

Every training input must map directly to this JSON schema. No additional conversational prose or C++/Blueprints code should be produced.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ExperienceManifest",
  "type": "object",
  "properties": {
    "metadata": {
      "type": "object",
      "properties": {
        "title": { "type": "string", "description": "Compelling retro or narrative title of the experience" },
        "sourceType": { "type": "string", "enum": ["email", "newsletter", "ebook", "course", "notes", "cleanup", "manual"] },
        "domain": { "type": "string", "enum": ["strategy", "science", "defense", "engineering"] },
        "xpReward": { "type": "integer", "minimum": 50, "maximum": 1000 },
        "timeEstimate": { "type": "string", "description": "Estimated gameplay duration, e.g., '10 mins' or '1 hour'" }
      },
      "required": ["title", "sourceType", "domain", "xpReward", "timeEstimate"]
    },
    "narrative": {
      "type": "object",
      "properties": {
        "genre": { "type": "string", "description": "e.g., Survival RPG, Cyberpunk Adventure, Space Simulation" },
        "theme": { "type": "string", "description": "Atmosphere and aesthetic of the campaign" },
        "playerRole": { "type": "string", "description": "The specific title/profession of the user in this game world" },
        "conflict": { "type": "string", "description": "The core dilemma or obstacle extracted from the content" },
        "worldDescription": { "type": "string", "description": "Vivid description of the setting generated from the content" },
        "primaryGoal": { "type": "string", "description": "The ultimate win-condition of the experience" }
      },
      "required": ["genre", "theme", "playerRole", "conflict", "worldDescription", "primaryGoal"]
    },
    "quests": {
      "type": "object",
      "properties": {
        "mainQuest": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "description": { "type": "string" },
            "objectives": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["title", "description", "objectives"]
        },
        "sideQuests": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "title": { "type": "string" },
              "description": { "type": "string" },
              "objectives": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["id", "title", "description", "objectives"]
          }
        }
      },
      "required": ["mainQuest", "sideQuests"]
    },
    "analystChallenge": {
      "type": "object",
      "description": "Evidence verification task matching the original document's key learning units",
      "properties": {
        "instructions": { "type": "string" },
        "summaryToVerify": { "type": "string", "description": "A synthesized summary of the document which contains crucial points" },
        "correctEvidenceSnippets": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Verbatim sentences or key phrases extracted from the raw content that validate the summary"
        },
        "distractorSnippets": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Plausible but false or irrelevant snippets from the text that act as distractors"
        }
      },
      "required": ["instructions", "summaryToVerify", "correctEvidenceSnippets", "distractorSnippets"]
    },
    "npcs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "role": { "type": "string" },
          "personality": { "type": "string" },
          "knowledge": { "type": "string" },
          "dialogueStyle": { "type": "string" },
          "trust": { "type": "integer", "minimum": 0, "maximum": 100 },
          "dialogue": {
            "type": "object",
            "properties": {
              "initial": { "type": "string", "description": "Greeting line matching personality" },
              "choices": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "text": { "type": "string", "description": "Player choice" },
                    "textResponse": { "type": "string", "description": "NPC's retort" },
                    "trustModifier": { "type": "integer" }
                  },
                  "required": ["text", "textResponse", "trustModifier"]
                }
              }
            },
            "required": ["initial", "choices"]
          }
        },
        "required": ["id", "name", "role", "personality", "knowledge", "dialogueStyle", "trust", "dialogue"]
      }
    },
    "skillTree": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "category": { "type": "string" },
          "unlocks": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["id", "name", "description", "category", "unlocks"]
      }
    },
    "achievements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "condition": { "type": "string" },
          "points": { "type": "integer" }
        },
        "required": ["id", "title", "description", "condition", "points"]
      }
    },
    "branchingStory": {
      "type": "object",
      "properties": {
        "endings": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "description": { "type": "string" },
              "triggers": { "type": "string" }
            },
            "required": ["name", "description", "triggers"]
          }
        }
      },
      "required": ["endings"]
    },
    "difficultyRules": {
      "type": "object",
      "properties": {
        "lowXpAdjustments": { "type": "array", "items": { "type": "string" } },
        "highXpAdjustments": { "type": "array", "items": { "type": "string" } },
        "activeMutators": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["lowXpAdjustments", "highXpAdjustments", "activeMutators"]
    },
    "proceduralMap": {
      "type": "object",
      "properties": {
        "regionName": { "type": "string" },
        "description": { "type": "string" },
        "locations": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "description": { "type": "string" },
              "type": { "type": "string" },
              "hazards": { "type": "array", "items": { "type": "string" } },
              "spawns": { "type": "array", "items": { "type": "string" } },
              "lootTable": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["name", "description", "type", "hazards", "spawns", "lootTable"]
          }
        }
      },
      "required": ["regionName", "description", "locations"]
    },
    "voiceovers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "characterId": { "type": "string" },
          "text": { "type": "string" },
          "cues": { "type": "string" }
        },
        "required": ["characterId", "text", "cues"]
      }
    },
    "imagePrompts": {
      "type": "object",
      "properties": {
        "environmentPrompt": { "type": "string" },
        "npcPrompts": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "npcId": { "type": "string" },
              "prompt": { "type": "string" }
            },
            "required": ["npcId", "prompt"]
          }
        },
        "itemPrompts": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "prompt": { "type": "string" }
            },
            "required": ["name", "prompt"]
          }
        }
      },
      "required": ["environmentPrompt", "npcPrompts", "itemPrompts"]
    },
    "multiplayerSync": {
      "type": "object",
      "properties": {
        "roles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "roleName": { "type": "string" },
              "duty": { "type": "string" },
              "startingStats": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["roleName", "duty", "startingStats"]
          }
        },
        "sharedWorldState": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["roles", "sharedWorldState"]
    }
  },
  "required": [
    "metadata", "narrative", "quests", "analystChallenge", "npcs", 
    "skillTree", "achievements", "branchingStory", "difficultyRules", 
    "proceduralMap", "voiceovers", "imagePrompts", "multiplayerSync"
  ]
}
```

---

## 2. Training Prompt System Directive

The following prompt serves as the core system instruction when training a model via Supervised Fine-Tuning (SFT) or Reinforcement Learning (RLHF).

```text
You are the Optomole Experience Compiler (XIR engine). Your primary purpose is to convert boring, unstructured, or dense informational texts into a comprehensive portable game specification conforming strictly to the ExperienceManifest JSON schema.

Do not write preambles, apologies, explanation text, or markdown decorations around the output outside the JSON. Return only the raw JSON payload matching the schema.

INSTRUCTIONS:
1. Normalize and classify: Extrapolate title, domain (strategy, science, defense, engineering), XP, and type.
2. Narrative Extraction: Identify the hidden story. Map real-world dilemmas to game genres (e.g. Compliance -> Sci-Fi security defense, Server Migration -> City-building or Siege, Sales Pitch -> Courtly Diplomacy).
3. Discover Quest Loops: Formulate a compelling Main Quest and logical side quests out of action points.
4. Forge Analyst Challenges: Create verification questions. The "correctEvidenceSnippets" MUST be verbatim phrases or sentences from the provided user content. The "distractorSnippets" should sound highly convincing but misstate the facts or represent logic errors.
5. Populate NPCs: Translate characters, services, or opposing factions into distinct NPCs with dialogue choices.
6. Create progression trees, procedural environments, and cinematic voiceover scripts. Ensure multiplayer roles align with diverse expertise styles.
```

---

## 3. Training Example (JSONL Format)

Below is an exemplar of training data in ChatML format.

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are the Optomole Experience Compiler. Produce valid JSON according to the ExperienceManifest schema based on user content."
    },
    {
      "role": "user",
      "content": "Subject: Welcome to Project Phoenix\nHi Sarah,\nCongratulations! You've been selected to join Project Phoenix, an initiative to restore abandoned communities after a global energy collapse.\nYour first mission is to establish power in Sector 7.\nYou'll work with engineers, security specialists, and local survivors.\nComplete your objectives before supplies run out.\nGood luck."
    },
    {
      "role": "assistant",
      "content": "{\n  \"metadata\": {\n    \"title\": \"Project Phoenix: Sector 7 Ignition\",\n    \"sourceType\": \"email\",\n    \"domain\": \"engineering\",\n    \"xpReward\": 350,\n    \"timeEstimate\": \"15 mins\"\n  },\n  \"narrative\": {\n    \"genre\": \"Survival RPG\",\n    \"theme\": \"Post-apocalyptic grid restoration\",\n    \"playerRole\": \"Reconstruction Officer\",\n    \"conflict\": \"Global energy collapse leaving Sector 7 dark and depleted of resources\",\n    \"worldDescription\": \"Sector 7 is an overgrown, decaying industrial complex cluttered with rusted transformers, active hazards, and isolated survivor outposts.\",\n    \"primaryGoal\": \"Establish power and synchronize the local grid before emergency rations expire\"\n  },\n  \"quests\": {\n    \"mainQuest\": {\n      \"title\": \"Restore the Core\",\n      \"description\": \"Repair local transformers and engage the generator grid.\",\n      \"objectives\": [\"Locate Sector 7 emergency generator\", \"Repair the magnetic induction coils\", \"Synchronize power distribution grid\"]\n    },\n    \"sideQuests\": [\n      {\n        \"id\": \"side_01\",\n        \"title\": \"Signal Fire\",\n        \"description\": \"Establish a stable long-range radio to call security reinforcements.\",\n        \"objectives\": [\"Climb the rusted radio tower\", \"Swap the blown fuse\", \"Transmit diagnostic logs\"]\n      }\n    ]\n  },\n  \"analystChallenge\": {\n    \"instructions\": \"Locate the verbatim evidence proving your role and primary objectives.\",\n    \"summaryToVerify\": \"The Reconstruction Officer Sarah is tasked with restoring electric power in Sector 7 alongside a multidisciplinary crew before resources are depleted.\",\n    \"correctEvidenceSnippets\": [\n      \"You've been selected to join Project Phoenix, an initiative to restore abandoned communities after a global energy collapse.\",\n      \"Your first mission is to establish power in Sector 7.\",\n      \"Complete your objectives before supplies run out.\"\n    ],\n    \"distractorSnippets\": [\n      \"Your task is to immediately evacuate Sector 7 and destroy the generators.\",\n      \"Sarah must complete the mission alone without any local assistance.\",\n      \"The energy collapse was caused by an alien cyber attack on central command.\"\n    ]\n  },\n  \"npcs\": [\n    {\n      \"id\": \"npc_maya\",\n      \"name\": \"Engineer Maya\",\n      \"role\": \"Grid Architect\",\n      \"personality\": \"Brilliant but cynical and deeply exhausted\",\n      \"knowledge\": \"Power distribution systems and copper transformer wiring\",\n      \"dialogueStyle\": \"Sardonic, brief, filled with engineering jargon\",\n      \"trust\": 40,\n      \"dialogue\": {\n        \"initial\": \"The generator is dead as a doornail, Reconstruction Officer. Unless you brought replacement copper coils, we're sitting in the cold.\",\n        \"choices\": [\n          { \"text\": \"I'll search the wreckage of the adjacent warehouse for materials.\", \"textResponse\": \"Hurry up. The wolves get active in Sector 7 once night falls.\", \"trustModifier\": 10 },\n          { \"text\": \"Can we bypass the coils with simple aluminum wire?\", \"textResponse\": \"If you want to blow up the main transformer and light this region like a candle, sure.\", \"trustModifier\": -15 }\n        ]\n      }\n    }\n  ],\n  \"skillTree\": [\n    {\n      \"id\": \"skill_electrical_engineering\",\n      \"name\": \"Induction Repair\",\n      \"description\": \"Enables direct bypass and quick soldering of electrical lines under pressure\",\n      \"category\": \"engineering\",\n      \"unlocks\": [\"skill_grid_synchronization\"]\n    }\n  ],\n  \"achievements\": [\n    {\n      \"id\": \"ach_first_spark\",\n      \"title\": \"⚡ First Spark\",\n      \"description\": \"Success in establishing power to the Sector 7 emergency grid\",\n      \"condition\": \"Main quest completed\",\n      \"points\": 50\n    }\n  ],\n  \"branchingStory\": {\n    \"endings\": [\n      { \"name\": \"The Eternal Beacon\", \"description\": \"Sector 7 is fully secured, lighting the skies and drawing survivors from miles away.\", \"triggers\": \"Grid restored and Maya trust above 75%\" },\n      { \"name\": \"The Dark Outpost\", \"description\": \"The generator exploded due to improper bypass, leaving the area permanently uninhabitable.\", \"triggers\": \"Using aluminum wire shortcut with Maya trust below 30%\" }\n    ]\n  },\n  \"difficultyRules\": {\n    \"lowXpAdjustments\": [\"Generators hold charge 50% longer\", \"Fewer active hazards around electrical nodes\"],\n    \"highXpAdjustments\": [\"Coil temperature triggers spontaneous shorts\", \"Wandering cyber-scavengers raid the power station\"],\n    \"activeMutators\": [\"Acid rain limits outdoor construction speed\"]}\n  ,\n  \"proceduralMap\": {\n    \"regionName\": \"Sector 7 Badlands\",\n    \"description\": \"A desolate industrial perimeter containing a ruined power node and active electrical arcs.\",\n    \"locations\": [\n      {\n        \"name\": \"Rusted Power Plant\",\n        \"description\": \"The epicentre of Sector 7's historical power grid, filled with delicate circuits.\",\n        \"type\": \"control_center\",\n        \"hazards\": [\"Live voltage leaks\", \"Unstable walkways\"],\n        \"spawns\": [\"Scavenger drones\", \"Electrical spectres\"],\n        \"lootTable\": [\"Fusion batteries\", \"Copper wiring\", \"Maya's repair kit\"]\n      }\n    ]\n  },\n  \"voiceovers\": [\n    {\n      \"characterId\": \"commander_briggs\",\n      \"text\": \"The lights went out three years ago. People stopped believing. If you can restart that reactor... you'll give everyone hope.\",\n      \"cues\": \"Fades in with somber, gravelly acoustic undertones. Deep breath on 'restart'\"\n    }\n  ],\n  \"imagePrompts\": {\n    \"environmentPrompt\": \"Abandoned power station covered in vines, post-apocalyptic, sunset lighting, high-detail realistic game-ready concept art, Unreal Engine 5 styling\",\n    \"npcPrompts\": [\n      { \"npcId\": \"npc_maya\", \"prompt\": \"Female electrical engineer, late 30s, protective carbon gear, holding a blue diagnostic tablet, determined expression, futuristic digital painting\" }\n    ],\n    \"itemPrompts\": [\n      { \"name\": \"Fusion Core\", \"prompt\": \"Portable sci-fi fusion battery with glowing blue radioactive cylinders, high-detail metallic casing, isolated product display\" }\n    ]\n  },\n  \"multiplayerSync\": {\n    \"roles\": [\n      { \"roleName\": \"Grid Medic\", \"duty\": \"Keeps surviving engineers stabilized and keeps radiation/voltage levels normal\", \"startingStats\": [\"Intelligence: 12\", \"First Aid: 15\"] },\n      { \"roleName\": \"SecOps Shield\", \"duty\": \"Protects repairing engineers from wild scavengers\", \"startingStats\": [\"Tactics: 14\", \"Assault: 12\"] }\n    ],\n    \"sharedWorldState\": [\"Generator health\", \"Ambient Grid Temperature\", \"Sector Threat Level\"]\n  }\n}\n"
    }
  ]
}
```
