#include "OptomoleKeyActor.h"
#include "OptomoleGameMode.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"

AOptomoleKeyActor::AOptomoleKeyActor()
{
    PrimaryActorTick.bCanEverTick = true;

    Trigger = CreateDefaultSubobject<USphereComponent>(TEXT("Trigger"));
    Trigger->InitSphereRadius(90.f);
    Trigger->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
    RootComponent = Trigger;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    Mesh->SetupAttachment(RootComponent);
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Mesh->SetRelativeScale3D(FVector(0.6f));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (Cube.Succeeded()) Mesh->SetStaticMesh(Cube.Object);

    Trigger->OnComponentBeginOverlap.AddDynamic(this, &AOptomoleKeyActor::OnOverlap);
}

void AOptomoleKeyActor::BeginPlay()
{
    Super::BeginPlay();
    if (UMaterialInstanceDynamic* MID = Mesh->CreateAndSetMaterialInstanceDynamic(0))
    {
        MID->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.95f, 0.75f, 0.15f)); // gold
    }
}

void AOptomoleKeyActor::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    Spin += DeltaSeconds * 90.f;
    Mesh->SetRelativeRotation(FRotator(0.f, Spin, 20.f));
}

void AOptomoleKeyActor::OnOverlap(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
    if (bCollected) return;
    if (OtherActor != UGameplayStatics::GetPlayerPawn(this, 0)) return;

    bCollected = true;
    if (AOptomoleGameMode* GM = GetWorld() ? GetWorld()->GetAuthGameMode<AOptomoleGameMode>() : nullptr)
    {
        GM->CollectKey(RoomIndex, Label);
    }
    Destroy();
}
