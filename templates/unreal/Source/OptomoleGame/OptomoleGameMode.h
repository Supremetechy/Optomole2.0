#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "OptomoleTypes.h"
#include "OptomoleGameMode.generated.h"

class AOptomoleGateActor;

/**
 * Action-adventure key & lock game mode. Reads Content/Data/Experience.json,
 * chunks the compiled entities into rooms, and builds a walled room-graph level
 * where each room's keys open its gate. Clearing the final room wins the run;
 * hazards drain focus and depleting it fails it.
 */
UCLASS()
class OPTOMOLEGAME_API AOptomoleGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AOptomoleGameMode();

    virtual void BeginPlay() override;

    // Called by actors.
    void CollectKey(int32 RoomIndex, const FString& Label);
    void HitHazard(const FString& Label);

    // HUD accessors.
    FString GetTitle() const { return Spec.Title; }
    FString GetGenreTitle() const { return Spec.GenreTitle; }
    int32 GetCurrentRoom() const { return CurrentRoom; }
    int32 GetRoomCount() const { return Spec.Rooms.Num(); }
    int32 GetKeysThisRoom() const { return KeysThisRoom; }
    int32 GetRequiredKeysThisRoom() const;
    int32 GetFocus() const { return Focus; }
    int32 GetXp() const { return Xp; }
    bool IsWon() const { return bWon; }
    bool IsFailed() const { return bFailed; }

private:
    void BuildLevel();
    void BuildRoom(const FOptomoleRoom& Room);
    void AdvanceRoom();
    void FailRun();

    // Spawn helpers.
    class AStaticMeshActor* SpawnBox(const FVector& Location, const FVector& Scale, const FLinearColor& Color, bool bBlocking);
    void SpawnLightingAndPlayer();

    FOptomoleSpec Spec;
    int32 CurrentRoom = 0;
    int32 KeysThisRoom = 0;
    int32 Focus = 100;
    int32 Xp = 0;
    bool bWon = false;
    bool bFailed = false;

    UPROPERTY() TArray<AOptomoleGateActor*> Gates;

    // Level layout constants (world units).
    static constexpr float RoomHalf = 700.f;   // interior half-extent
    static constexpr float RoomSpacing = 1400.f;
    static constexpr float PlayZ = 90.f;
    static constexpr float GateGapHalf = 180.f;
};
