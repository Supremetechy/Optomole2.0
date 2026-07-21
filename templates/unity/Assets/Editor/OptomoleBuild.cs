using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

// Headless build entry point invoked by the Optomole worker:
//
//   Unity -batchmode -nographics -quit -projectPath <proj> \
//     -executeMethod OptomoleBuild.PerformBuild \
//     -buildTarget StandaloneOSX -optomoleOutput <dir> -logFile <log>
//
// It builds a bootstrap scene programmatically (no hand-authored .unity YAML),
// attaches OptomoleBootstrap, and produces a standalone player. The bootstrap
// reads StreamingAssets/experience.json at runtime and spawns the compiled
// entities, so the built player actually contains the generated experience.
public static class OptomoleBuild
{
    public static void PerformBuild()
    {
        string output = GetArg("-optomoleOutput") ?? Path.Combine(Directory.GetCurrentDirectory(), "Build");
        BuildTarget target = ParseTarget(GetArg("-buildTarget"));
        Directory.CreateDirectory(output);

        // Build a scene in code and save it, so we never ship a binary .unity asset.
        // The empty-scene GameObject holds OptomoleAdventure, which builds the whole
        // key & lock level (rooms, keys, gates, hazards, player, camera) at runtime.
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var go = new GameObject("OptomoleAdventure");
        go.AddComponent<OptomoleAdventure>();
        Directory.CreateDirectory("Assets/Scenes");
        const string scenePath = "Assets/Scenes/OptomoleMain.unity";
        EditorSceneManager.SaveScene(scene, scenePath);

        string outPath = Path.Combine(output, ExecutableName(target));
        var options = new BuildPlayerOptions
        {
            scenes = new[] { scenePath },
            locationPathName = outPath,
            target = target,
            options = BuildOptions.None,
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        BuildSummary summary = report.summary;
        Debug.Log($"[Optomole] Build {summary.result} ({summary.totalSize} bytes) -> {outPath}");
        EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
    }

    static string GetArg(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        int i = Array.IndexOf(args, name);
        return (i >= 0 && i + 1 < args.Length) ? args[i + 1] : null;
    }

    static BuildTarget ParseTarget(string value)
    {
        switch ((value ?? "").ToLowerInvariant())
        {
            case "standalonewindows64": return BuildTarget.StandaloneWindows64;
            case "standalonelinux64": return BuildTarget.StandaloneLinux64;
            case "standaloneosx": return BuildTarget.StandaloneOSX;
            default: return BuildTarget.StandaloneOSX;
        }
    }

    static string ExecutableName(BuildTarget target)
    {
        switch (target)
        {
            case BuildTarget.StandaloneWindows64: return "OptomoleGame.exe";
            case BuildTarget.StandaloneLinux64: return "OptomoleGame.x86_64";
            default: return "OptomoleGame.app";
        }
    }
}
