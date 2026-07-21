using UnrealBuildTool;

public class OptomoleGameTarget : TargetRules
{
    public OptomoleGameTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V4;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("OptomoleGame");
    }
}
