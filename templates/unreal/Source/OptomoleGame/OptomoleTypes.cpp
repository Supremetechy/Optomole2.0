#include "OptomoleTypes.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

bool FOptomoleSpec::Load(const FString& ContentDir, FOptomoleSpec& Out, int32 RoomSize)
{
    const FString SpecPath = ContentDir / TEXT("Data/Experience.json");

    FString Raw;
    if (!FFileHelper::LoadFileToString(Raw, *SpecPath))
    {
        UE_LOG(LogTemp, Warning, TEXT("[Optomole] spec not found at %s"), *SpecPath);
        return false;
    }

    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Raw);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        UE_LOG(LogTemp, Warning, TEXT("[Optomole] failed to parse spec JSON"));
        return false;
    }

    Out.Title = Root->GetStringField(TEXT("title"));
    if (const TSharedPtr<FJsonObject>* Genre; Root->TryGetObjectField(TEXT("genre"), Genre))
    {
        (*Genre)->TryGetStringField(TEXT("title"), Out.GenreTitle);
    }
    Root->TryGetNumberField(TEXT("xpReward"), Out.XpReward);

    // Flatten entities, preserving order (grid layout came from the same order).
    TArray<FOptomoleEntity> Playable;
    const TArray<TSharedPtr<FJsonValue>>* Entities = nullptr;
    if (Root->TryGetArrayField(TEXT("entities"), Entities) && Entities)
    {
        for (const TSharedPtr<FJsonValue>& Value : *Entities)
        {
            const TSharedPtr<FJsonObject> E = Value->AsObject();
            if (!E.IsValid()) continue;

            FOptomoleEntity Entity;
            Entity.Id = E->GetStringField(TEXT("id"));
            Entity.EntityType = E->GetStringField(TEXT("entityType"));
            // Canonical cross-genre role from the generator: key | hazard | gate | npc | objective.
            E->TryGetStringField(TEXT("role"), Entity.Role);
            Entity.Label = E->GetStringField(TEXT("label"));
            E->TryGetStringField(TEXT("description"), Entity.Description);
            E->TryGetBoolField(TEXT("hazard"), Entity.bHazard);
            if (const TSharedPtr<FJsonObject>* Grid; E->TryGetObjectField(TEXT("grid"), Grid))
            {
                (*Grid)->TryGetNumberField(TEXT("col"), Entity.Col);
                (*Grid)->TryGetNumberField(TEXT("row"), Entity.Row);
            }

            // Gates and NPCs are not placed as room contents (gates become the
            // room's own exit). Mirrors the browser room-graph.
            if (Entity.Role == TEXT("gate") || Entity.Role == TEXT("npc"))
            {
                continue;
            }
            Playable.Add(Entity);
        }
    }

    // Chunk into rooms of RoomSize; classify each entity within a room.
    const int32 RoomCount = FMath::Max(1, FMath::DivideAndRoundUp(Playable.Num(), FMath::Max(1, RoomSize)));
    for (int32 i = 0; i < RoomCount; ++i)
    {
        FOptomoleRoom Room;
        Room.Index = i;
        Room.bFinal = (i == RoomCount - 1);
        Room.Title = FString::Printf(TEXT("Room %d"), i + 1);

        const int32 Start = i * RoomSize;
        const int32 End = FMath::Min(Start + RoomSize, Playable.Num());
        for (int32 j = Start; j < End; ++j)
        {
            const FOptomoleEntity& E = Playable[j];
            if (E.Role == TEXT("key")) Room.Keys.Add(E);
            else if (E.Role == TEXT("hazard") || E.bHazard) Room.Hazards.Add(E);
            else Room.Objectives.Add(E);
        }

        // Every room needs at least one key to open its gate; promote the first
        // objective if the chunk had none (matches the browser guarantee).
        if (Room.Keys.Num() == 0 && Room.Objectives.Num() > 0)
        {
            Room.Keys.Add(Room.Objectives[0]);
            Room.Objectives.RemoveAt(0);
        }
        Out.Rooms.Add(Room);
    }

    UE_LOG(LogTemp, Log, TEXT("[Optomole] loaded \"%s\": %d rooms, %d keys total"),
        *Out.Title, Out.Rooms.Num(), Out.TotalKeys());
    return true;
}
