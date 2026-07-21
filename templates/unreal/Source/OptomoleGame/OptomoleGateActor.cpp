#include "OptomoleGateActor.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

AOptomoleGateActor::AOptomoleGateActor()
{
    PrimaryActorTick.bCanEverTick = true;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    // Sized to fill the gap in the room's front wall (~360 wide, ~300 tall).
    Mesh->SetRelativeScale3D(FVector(0.4f, 3.6f, 3.f));
    Mesh->SetCollisionProfileName(TEXT("BlockAllDynamic"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (Cube.Succeeded()) Mesh->SetStaticMesh(Cube.Object);
    RootComponent = Mesh;
}

void AOptomoleGateActor::BeginPlay()
{
    Super::BeginPlay();
    ClosedZ = GetActorLocation().Z;
    OpenZ = ClosedZ - 260.f;

    if (UMaterialInstanceDynamic* MID = Mesh->CreateAndSetMaterialInstanceDynamic(0))
    {
        MID->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.85f, 0.7f, 0.15f));
    }
}

void AOptomoleGateActor::Open()
{
    if (bOpen) return;
    bOpen = true;
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void AOptomoleGateActor::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!bOpen) return;
    // Slide down into the floor over ~0.5s, then stop ticking.
    const FVector Loc = GetActorLocation();
    if (Loc.Z > OpenZ + 1.f)
    {
        SetActorLocation(FVector(Loc.X, Loc.Y, FMath::FInterpTo(Loc.Z, OpenZ, DeltaSeconds, 6.f)));
    }
}
