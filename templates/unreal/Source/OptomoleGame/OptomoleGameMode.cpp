#include "OptomoleGameMode.h"
#include "OptomolePlayerPawn.h"
#include "OptomoleHUD.h"
#include "OptomoleKeyActor.h"
#include "OptomoleGateActor.h"
#include "OptomoleHazardActor.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/StaticMesh.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Components/LightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/Paths.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/PlayerController.h"

AOptomoleGameMode::AOptomoleGameMode()
{
    DefaultPawnClass = AOptomolePlayerPawn::StaticClass();
    HUDClass = AOptomoleHUD::StaticClass();
}

void AOptomoleGameMode::BeginPlay()
{
    Super::BeginPlay();

    if (!FOptomoleSpec::Load(FPaths::ProjectContentDir(), Spec))
    {
        UE_LOG(LogTemp, Warning, TEXT("[Optomole] no spec; nothing to build."));
        return;
    }
    Gates.SetNum(Spec.Rooms.Num());
    BuildLevel();
    SpawnLightingAndPlayer();

    UE_LOG(LogTemp, Log, TEXT("[Optomole] adventure ready: %d rooms."), Spec.Rooms.Num());
}

int32 AOptomoleGameMode::GetRequiredKeysThisRoom() const
{
    return Spec.Rooms.IsValidIndex(CurrentRoom) ? Spec.Rooms[CurrentRoom].Keys.Num() : 0;
}

void AOptomoleGameMode::BuildLevel()
{
    for (const FOptomoleRoom& Room : Spec.Rooms)
    {
        BuildRoom(Room);
    }
}

void AOptomoleGameMode::BuildRoom(const FOptomoleRoom& Room)
{
    const float CX = Room.Index * RoomSpacing;

    // Floor slab.
    SpawnBox(FVector(CX, 0.f, -10.f), FVector(RoomHalf / 50.f, RoomHalf / 50.f, 0.2f),
        FLinearColor(0.05f, 0.08f, 0.12f), false);

    // Side walls (+Y / -Y), spanning the room depth in X.
    const FVector SideScale(RoomHalf / 50.f, 0.4f, 3.f);
    SpawnBox(FVector(CX, RoomHalf, PlayZ), SideScale, FLinearColor(0.15f, 0.2f, 0.28f), true);
    SpawnBox(FVector(CX, -RoomHalf, PlayZ), SideScale, FLinearColor(0.15f, 0.2f, 0.28f), true);

    // Back wall only on the first room (entrance is sealed).
    if (Room.Index == 0)
    {
        SpawnBox(FVector(CX - RoomHalf, 0.f, PlayZ), FVector(0.4f, RoomHalf / 50.f, 3.f),
            FLinearColor(0.15f, 0.2f, 0.28f), true);
    }

    // Front boundary wall (+X) with a central gap for the gate.
    const float FX = CX + RoomHalf;
    const float SegLen = (RoomHalf - GateGapHalf) / 2.f; // half-length of each segment
    const float SegCenter = GateGapHalf + SegLen;
    SpawnBox(FVector(FX, SegCenter, PlayZ), FVector(0.4f, SegLen / 50.f, 3.f), FLinearColor(0.15f, 0.2f, 0.28f), true);
    SpawnBox(FVector(FX, -SegCenter, PlayZ), FVector(0.4f, SegLen / 50.f, 3.f), FLinearColor(0.15f, 0.2f, 0.28f), true);

    // The gate in the gap.
    if (AOptomoleGateActor* Gate = GetWorld()->SpawnActor<AOptomoleGateActor>(
            AOptomoleGateActor::StaticClass(), FVector(FX, 0.f, PlayZ), FRotator::ZeroRotator))
    {
        Gate->RoomIndex = Room.Index;
        Gates[Room.Index] = Gate;
    }

    // Place room contents on a grid centered in the room. Keys, then objectives,
    // then hazards spread around the edges.
    auto PlaceAt = [&](int32 Slot) -> FVector
    {
        const int32 Col = Slot % 3;
        const int32 RowN = Slot / 3;
        return FVector(CX + (RowN - 1) * 320.f, (Col - 1) * 340.f, PlayZ);
    };

    int32 Slot = 0;
    for (const FOptomoleEntity& K : Room.Keys)
    {
        if (AOptomoleKeyActor* Key = GetWorld()->SpawnActor<AOptomoleKeyActor>(
                AOptomoleKeyActor::StaticClass(), PlaceAt(Slot++), FRotator::ZeroRotator))
        {
            Key->RoomIndex = Room.Index;
            Key->Label = K.Label;
        }
    }
    for (const FOptomoleEntity& H : Room.Hazards)
    {
        if (AOptomoleHazardActor* Hz = GetWorld()->SpawnActor<AOptomoleHazardActor>(
                AOptomoleHazardActor::StaticClass(), PlaceAt(Slot++), FRotator::ZeroRotator))
        {
            Hz->Label = H.Label;
        }
    }
    // Objectives become inert markers so the room still reflects its content.
    for (const FOptomoleEntity& O : Room.Objectives)
    {
        SpawnBox(PlaceAt(Slot++), FVector(0.4f), FLinearColor(0.5f, 0.55f, 0.6f), false);
    }
}

void AOptomoleGameMode::CollectKey(int32 RoomIndex, const FString& Label)
{
    if (bWon || bFailed || RoomIndex != CurrentRoom) return;

    ++KeysThisRoom;
    Xp += 100;
    UE_LOG(LogTemp, Log, TEXT("[Optomole] key '%s' (%d/%d)"), *Label, KeysThisRoom, GetRequiredKeysThisRoom());

    if (KeysThisRoom >= GetRequiredKeysThisRoom())
    {
        if (Gates.IsValidIndex(CurrentRoom) && Gates[CurrentRoom]) Gates[CurrentRoom]->Open();
        AdvanceRoom();
    }
}

void AOptomoleGameMode::AdvanceRoom()
{
    if (Spec.Rooms.IsValidIndex(CurrentRoom) && Spec.Rooms[CurrentRoom].bFinal)
    {
        bWon = true;
        Xp += 500;
        UE_LOG(LogTemp, Log, TEXT("[Optomole] all rooms cleared."));
        return;
    }
    ++CurrentRoom;
    KeysThisRoom = 0;
}

void AOptomoleGameMode::HitHazard(const FString& Label)
{
    if (bWon || bFailed) return;
    Focus = FMath::Max(0, Focus - 20);
    UE_LOG(LogTemp, Log, TEXT("[Optomole] hazard '%s' focus=%d"), *Label, Focus);
    if (Focus <= 0) FailRun();
}

void AOptomoleGameMode::FailRun()
{
    bFailed = true;
    if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
    {
        if (APawn* P = PC->GetPawn()) P->DisableInput(PC);
    }
}

AStaticMeshActor* AOptomoleGameMode::SpawnBox(const FVector& Location, const FVector& Scale, const FLinearColor& Color, bool bBlocking)
{
    AStaticMeshActor* Box = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), Location, FRotator::ZeroRotator);
    if (!Box) return nullptr;

    UStaticMeshComponent* MeshComp = Box->GetStaticMeshComponent();
    MeshComp->SetMobility(EComponentMobility::Movable);
    if (UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")))
    {
        MeshComp->SetStaticMesh(Cube);
    }
    Box->SetActorScale3D(Scale);
    MeshComp->SetCollisionEnabled(bBlocking ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
    if (bBlocking) MeshComp->SetCollisionProfileName(TEXT("BlockAllDynamic"));

    if (UMaterialInstanceDynamic* MID = MeshComp->CreateAndSetMaterialInstanceDynamic(0))
    {
        MID->SetVectorParameterValue(TEXT("Color"), Color);
    }
    return Box;
}

void AOptomoleGameMode::SpawnLightingAndPlayer()
{
    // The Entry map is empty, so provide our own light and place the player in
    // room 0. FloatingPawnMovement has no gravity, so the fixed PlayZ holds.
    if (ADirectionalLight* Sun = GetWorld()->SpawnActor<ADirectionalLight>(
            ADirectionalLight::StaticClass(), FVector(0, 0, 1200), FRotator(-55.f, -30.f, 0.f)))
    {
        Sun->GetLightComponent()->SetIntensity(6.f);
    }
    GetWorld()->SpawnActor<ASkyLight>(ASkyLight::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator);

    if (APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
    {
        Pawn->SetActorLocation(FVector(0.f, 0.f, PlayZ));
    }
}
