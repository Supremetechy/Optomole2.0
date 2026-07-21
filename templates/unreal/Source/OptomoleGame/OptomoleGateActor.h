#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "OptomoleGateActor.generated.h"

class UStaticMeshComponent;

// A locked gate at a room's exit. Blocks the player until the room's keys are
// collected, then Open() slides it away so the player can advance.
UCLASS()
class OPTOMOLEGAME_API AOptomoleGateActor : public AActor
{
    GENERATED_BODY()

public:
    AOptomoleGateActor();

    int32 RoomIndex = 0;

    virtual void Tick(float DeltaSeconds) override;

    // Unlock: drop the gate into the floor and disable collision.
    void Open();
    bool IsOpen() const { return bOpen; }

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Mesh;
    bool bOpen = false;
    float ClosedZ = 0.f;
    float OpenZ = 0.f;
};
