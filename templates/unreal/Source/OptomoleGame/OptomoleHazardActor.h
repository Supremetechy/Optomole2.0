#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "OptomoleHazardActor.generated.h"

class USphereComponent;
class UStaticMeshComponent;

// A hazard. Overlapping it drains the player's focus (with a short cooldown so a
// single touch doesn't empty the whole bar). Focus reaching zero fails the run.
UCLASS()
class OPTOMOLEGAME_API AOptomoleHazardActor : public AActor
{
    GENERATED_BODY()

public:
    AOptomoleHazardActor();

    FString Label;

protected:
    virtual void BeginPlay() override;

    UFUNCTION()
    void OnOverlap(UPrimitiveComponent* OverlappedComp, AActor* OtherActor, UPrimitiveComponent* OtherComp,
        int32 OtherBodyIndex, bool bFromSweep, const FHitResult& Sweep);

private:
    UPROPERTY(VisibleAnywhere) USphereComponent* Trigger;
    UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Mesh;
    double LastHitTime = -100.0;
};
