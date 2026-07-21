#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "OptomolePlayerPawn.generated.h"

class USphereComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class UFloatingPawnMovement;

// Top-down explorer. Moves on the XY plane with WASD (legacy axis mappings in
// Config/DefaultInput.ini) and physically overlaps keys, hazards, and gates.
UCLASS()
class OPTOMOLEGAME_API AOptomolePlayerPawn : public APawn
{
    GENERATED_BODY()

public:
    AOptomolePlayerPawn();

    virtual void SetupPlayerInputComponent(UInputComponent* InputComponent) override;

protected:
    virtual void BeginPlay() override;

    void MoveForward(float Value);
    void MoveRight(float Value);

private:
    UPROPERTY(VisibleAnywhere) USphereComponent* Collision;
    UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Mesh;
    UPROPERTY(VisibleAnywhere) USpringArmComponent* SpringArm;
    UPROPERTY(VisibleAnywhere) UCameraComponent* Camera;
    UPROPERTY(VisibleAnywhere) UFloatingPawnMovement* Movement;
};
