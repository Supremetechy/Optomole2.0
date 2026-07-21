using UnrealBuildTool;

public class OptomoleGameEditorTarget : TargetRules
{
    public OptomoleGameEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V4;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("OptomoleGame");
    }
}
