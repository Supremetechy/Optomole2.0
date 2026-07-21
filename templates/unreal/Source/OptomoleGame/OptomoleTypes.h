#pragma once

#include "CoreMinimal.h"

// Plain (non-reflected) data the adventure is built from. Parsed from the
// injected Content/Data/Experience.json by FOptomoleSpec::Load.

struct FOptomoleEntity
{
    FString Id;
    FString EntityType;   // genre-native type: key-item | loot | enemy | region-gate | ...
    FString Role;         // canonical: key | hazard | gate | npc | objective
    FString Label;
    FString Description;
    bool bHazard = false;
    int32 Col = 0;
    int32 Row = 0;
};

// One playable room: a chunk of entities with the keys needed to open its gate.
struct FOptomoleRoom
{
    int32 Index = 0;
    FString Title;
    TArray<FOptomoleEntity> Keys;         // collect all of these...
    TArray<FOptomoleEntity> Hazards;      // ...while avoiding these...
    TArray<FOptomoleEntity> Objectives;   // ...to open the gate.
    bool bFinal = false;
};

struct FOptomoleSpec
{
    FString Title;
    FString GenreTitle;
    int32 XpReward = 0;
    TArray<FOptomoleRoom> Rooms;

    int32 TotalKeys() const
    {
        int32 Total = 0;
        for (const FOptomoleRoom& Room : Rooms) Total += Room.Keys.Num();
        return Total;
    }

    // Load + parse + chunk into rooms (roomSize matches the browser default of 6).
    static bool Load(const FString& ContentDir, FOptomoleSpec& Out, int32 RoomSize = 6);
};
