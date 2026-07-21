using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

// Action Adventure: Key & Lock — Unity runtime.
//
// Mirror of the Unreal template. Reads StreamingAssets/experience.json, chunks
// the compiled entities into rooms (6 per room), and builds a walled room-graph
// level at runtime: collect a room's keys to open its gate, avoid the red
// hazards, and clear the final room to win. Depleting Focus fails the run.
//
// Entity types are read via the generator's canonical `role` field, so any
// genre's mapping (loot/key-item -> key, enemy/hazard -> hazard,
// region-gate/lock -> gate) plays correctly.
public class OptomoleAdventure : MonoBehaviour
{
    [Serializable] public class Grid { public int col; public int row; }
    [Serializable] public class Entity
    {
        public string id;
        public string entityType;
        public string role;
        public string label;
        public bool hazard;
        public Grid grid;
    }
    [Serializable] public class Genre { public string id; public string title; }
    [Serializable] public class Spec
    {
        public string title;
        public Genre genre;
        public int xpReward;
        public Entity[] entities;
    }

    class Room
    {
        public int Index;
        public bool Final;
        public readonly List<Entity> Keys = new List<Entity>();
        public readonly List<Entity> Hazards = new List<Entity>();
        public readonly List<Entity> Objectives = new List<Entity>();
        public GameObject Gate;
    }

    // Layout + tuning (Unity units).
    const float RoomHalf = 7f;
    const float RoomSpacing = 14f;
    const float PlayY = 1f;
    const float GateGapHalf = 1.8f;
    const float MoveSpeed = 8f;

    Spec spec;
    readonly List<Room> rooms = new List<Room>();
    readonly List<KeyValuePair<GameObject, int>> keyObjs = new List<KeyValuePair<GameObject, int>>();
    readonly List<GameObject> hazObjs = new List<GameObject>();

    CharacterController controller;
    Camera cam;

    int currentRoom = 0, keysThisRoom = 0, focus = 100, xp = 0;
    bool won = false, failed = false;
    double lastHazard = -10.0;

    void Start()
    {
        spec = LoadSpec();
        if (spec == null) { Debug.LogWarning("[Optomole] no spec."); enabled = false; return; }
        BuildRooms();
        foreach (Room room in rooms) BuildRoom(room);
        SpawnPlayerAndCamera();
        Debug.Log($"[Optomole] adventure ready: {rooms.Count} rooms.");
    }

    Spec LoadSpec()
    {
        string path = Path.Combine(Application.streamingAssetsPath, "experience.json");
        try { return File.Exists(path) ? JsonUtility.FromJson<Spec>(File.ReadAllText(path)) : null; }
        catch (Exception ex) { Debug.LogError($"[Optomole] spec load failed: {ex.Message}"); return null; }
    }

    static string RoleOf(Entity e)
    {
        if (!string.IsNullOrEmpty(e.role)) return e.role;
        return e.hazard ? "hazard" : "objective";
    }

    void BuildRooms()
    {
        var playable = new List<Entity>();
        foreach (Entity e in spec.entities ?? new Entity[0])
        {
            string r = RoleOf(e);
            if (r == "gate" || r == "npc") continue; // gates become the room's exit
            playable.Add(e);
        }

        const int roomSize = 6;
        int count = Mathf.Max(1, Mathf.CeilToInt(playable.Count / (float)roomSize));
        for (int i = 0; i < count; i++)
        {
            var room = new Room { Index = i, Final = (i == count - 1) };
            int start = i * roomSize, end = Mathf.Min(start + roomSize, playable.Count);
            for (int j = start; j < end; j++)
            {
                Entity e = playable[j];
                string r = RoleOf(e);
                if (r == "key") room.Keys.Add(e);
                else if (r == "hazard" || e.hazard) room.Hazards.Add(e);
                else room.Objectives.Add(e);
            }
            if (room.Keys.Count == 0 && room.Objectives.Count > 0)
            {
                room.Keys.Add(room.Objectives[0]);
                room.Objectives.RemoveAt(0);
            }
            rooms.Add(room);
        }
    }

    void BuildRoom(Room room)
    {
        float cx = room.Index * RoomSpacing;

        Box(new Vector3(cx, 0f, 0f), new Vector3(RoomHalf * 2f, 0.2f, RoomHalf * 2f), new Color(0.05f, 0.08f, 0.12f), false);

        Color wall = new Color(0.15f, 0.2f, 0.28f);
        Box(new Vector3(cx, 1.5f, RoomHalf), new Vector3(RoomHalf * 2f, 3f, 0.4f), wall, true);
        Box(new Vector3(cx, 1.5f, -RoomHalf), new Vector3(RoomHalf * 2f, 3f, 0.4f), wall, true);
        if (room.Index == 0)
            Box(new Vector3(cx - RoomHalf, 1.5f, 0f), new Vector3(0.4f, 3f, RoomHalf * 2f), wall, true);

        float fx = cx + RoomHalf;
        float segLen = RoomHalf - GateGapHalf;
        float segCenter = GateGapHalf + segLen / 2f;
        Box(new Vector3(fx, 1.5f, segCenter), new Vector3(0.4f, 3f, segLen), wall, true);
        Box(new Vector3(fx, 1.5f, -segCenter), new Vector3(0.4f, 3f, segLen), wall, true);
        room.Gate = Box(new Vector3(fx, 1.5f, 0f), new Vector3(0.4f, 3f, GateGapHalf * 2f), new Color(0.85f, 0.7f, 0.15f), true);

        int slot = 0;
        foreach (Entity k in room.Keys)
        {
            GameObject go = Prop(PlaceAt(cx, slot++), new Color(0.95f, 0.75f, 0.15f), PrimitiveType.Cube, 0.6f);
            go.name = "key:" + k.id;
            keyObjs.Add(new KeyValuePair<GameObject, int>(go, room.Index));
        }
        foreach (Entity h in room.Hazards)
        {
            GameObject go = Prop(PlaceAt(cx, slot++), new Color(0.9f, 0.2f, 0.2f), PrimitiveType.Sphere, 1.0f);
            hazObjs.Add(go);
        }
        foreach (Entity o in room.Objectives)
            Prop(PlaceAt(cx, slot++), new Color(0.5f, 0.55f, 0.6f), PrimitiveType.Cube, 0.4f);
    }

    Vector3 PlaceAt(float cx, int slot)
    {
        int col = slot % 3;
        int rowN = slot / 3;
        return new Vector3(cx + (rowN - 1) * 3.2f, PlayY, (col - 1) * 3.4f);
    }

    GameObject Box(Vector3 pos, Vector3 size, Color color, bool blocking)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.transform.position = pos;
        go.transform.localScale = size;
        Colorize(go, color);
        if (!blocking) Destroy(go.GetComponent<Collider>());
        return go;
    }

    GameObject Prop(Vector3 pos, Color color, PrimitiveType type, float scale)
    {
        var go = GameObject.CreatePrimitive(type);
        go.transform.position = pos;
        go.transform.localScale = Vector3.one * scale;
        Colorize(go, color);
        Destroy(go.GetComponent<Collider>()); // props use distance checks, never block
        return go;
    }

    static void Colorize(GameObject go, Color color)
    {
        var rend = go.GetComponent<Renderer>();
        if (rend != null) rend.material.color = color;
    }

    void SpawnPlayerAndCamera()
    {
        var light = new GameObject("Sun").AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.1f;
        light.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

        var playerGo = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        playerGo.name = "Player";
        Destroy(playerGo.GetComponent<Collider>());
        Colorize(playerGo, new Color(0.2f, 0.8f, 0.95f));
        playerGo.transform.position = new Vector3(0f, PlayY, 0f);
        controller = playerGo.AddComponent<CharacterController>();
        controller.radius = 0.5f;
        controller.height = 2f;

        var camGo = new GameObject("MainCamera");
        camGo.tag = "MainCamera";
        cam = camGo.AddComponent<Camera>();
    }

    void Update()
    {
        if (controller == null) return;
        if (!won && !failed)
        {
            float h = Input.GetAxis("Horizontal");
            float v = Input.GetAxis("Vertical");
            Vector3 move = new Vector3(h, 0f, v);
            if (move.sqrMagnitude > 1f) move.Normalize();
            controller.Move(move * MoveSpeed * Time.deltaTime);
            CheckPickups();
        }
    }

    void LateUpdate()
    {
        if (cam == null || controller == null) return;
        Vector3 p = controller.transform.position;
        cam.transform.position = p + new Vector3(0f, 14f, -6f);
        cam.transform.LookAt(p);
    }

    void CheckPickups()
    {
        Vector3 pp = controller.transform.position;

        for (int i = keyObjs.Count - 1; i >= 0; i--)
        {
            var pair = keyObjs[i];
            if (pair.Key == null) { keyObjs.RemoveAt(i); continue; }
            if (pair.Value != currentRoom) continue;
            if (Vector3.Distance(pp, pair.Key.transform.position) < 1.1f)
            {
                Destroy(pair.Key);
                keyObjs.RemoveAt(i);
                CollectKey();
            }
        }

        double now = Time.timeAsDouble;
        if (now - lastHazard >= 1.0)
        {
            foreach (GameObject hz in hazObjs)
            {
                if (hz != null && Vector3.Distance(pp, hz.transform.position) < 1.3f)
                {
                    lastHazard = now;
                    focus = Mathf.Max(0, focus - 20);
                    if (focus <= 0) failed = true;
                    break;
                }
            }
        }
    }

    void CollectKey()
    {
        keysThisRoom++;
        xp += 100;
        if (keysThisRoom >= RequiredKeysThisRoom())
        {
            if (currentRoom < rooms.Count && rooms[currentRoom].Gate != null)
                Destroy(rooms[currentRoom].Gate);
            if (rooms[currentRoom].Final) { won = true; xp += 500; }
            else { currentRoom++; keysThisRoom = 0; }
        }
    }

    int RequiredKeysThisRoom()
    {
        return (currentRoom >= 0 && currentRoom < rooms.Count) ? rooms[currentRoom].Keys.Count : 0;
    }

    void OnGUI()
    {
        if (spec == null) return;
        GUI.color = new Color(0.4f, 0.9f, 1f);
        GUI.Label(new Rect(20, 20, 900, 30), spec.title, Big(20));
        GUI.color = Color.white;
        GUI.Label(new Rect(20, 48, 900, 24), $"{(spec.genre != null ? spec.genre.title : "")}  -  Action Adventure: Key & Lock", Big(14));

        if (won)
        {
            GUI.color = new Color(0.3f, 1f, 0.4f);
            GUI.Label(new Rect(20, 90, 900, 30), "ALL ROOMS CLEARED - Inbox Zero!", Big(22));
        }
        else if (failed)
        {
            GUI.color = new Color(1f, 0.35f, 0.35f);
            GUI.Label(new Rect(20, 90, 900, 30), "FOCUS DEPLETED - Run failed.", Big(20));
        }
        else
        {
            GUI.Label(new Rect(20, 90, 400, 24), $"Room  {currentRoom + 1} / {rooms.Count}", Big(16));
            GUI.color = new Color(0.85f, 0.7f, 0.15f);
            GUI.Label(new Rect(20, 116, 400, 24), $"Keys  {keysThisRoom} / {RequiredKeysThisRoom()}", Big(16));
            GUI.color = new Color(0.4f, 0.9f, 1f);
            GUI.Label(new Rect(20, 142, 400, 24), $"Focus {focus}", Big(16));
            GUI.color = Color.white;
            GUI.Label(new Rect(20, 168, 400, 24), $"XP    {xp}", Big(14));
            GUI.color = new Color(0.7f, 0.75f, 0.8f);
            GUI.Label(new Rect(20, 200, 900, 24), "WASD/arrows to move. Collect keys, avoid red hazards, reach the gate.", Big(12));
        }
    }

    static GUIStyle Big(int size)
    {
        return new GUIStyle(GUI.skin != null ? GUI.skin.label : new GUIStyle()) { fontSize = size, fontStyle = FontStyle.Bold };
    }
}
