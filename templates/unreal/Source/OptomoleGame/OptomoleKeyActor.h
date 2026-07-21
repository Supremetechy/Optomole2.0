#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "OptomoleKeyActor.generated.h"

class USphereComponent;
class UStaticMeshComponent;

// A collectible key. Overlapping it as the player collects it and notifies the
// game mode, which opens the room's gate once every key is collected.
UCLASS()
class OPTOMOLEGAME_API AOptomoleKeyActor : public AActor
{
    GENERATED_BODY()

public:
    AOptomoleKeyActor();

    // Which room this key belongs to (set at spawn by the game mode).
    int32 RoomIndex = 0;
    FString Label;

    virtual void Tick(float DeltaSeconds) override;

protected:
    virtual void BeginPlay() override;

    UFUNCTION()
    void OnOverlap(UPrimitiveComponent* OverlappedComp, AActor* OtherActor, UPrimitiveComponent* OtherComp,
        int32 OtherBodyIndex, bool bFromSweep, const FHitResult& Sweep);

private:
    UPROPERTY(VisibleAnywhere) USphereComponent* Trigger;
    UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Mesh;
    bool bCollected = false;
    float Spin = 0.f;
};
