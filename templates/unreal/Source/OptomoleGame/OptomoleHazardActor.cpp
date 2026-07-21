#include "OptomoleHazardActor.h"
#include "OptomoleGameMode.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "Kismet/GameplayStatics.h"

AOptomoleHazardActor::AOptomoleHazardActor()
{
    Trigger = CreateDefaultSubobject<USphereComponent>(TEXT("Trigger"));
    Trigger->InitSphereRadius(110.f);
    Trigger->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
    RootComponent = Trigger;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    Mesh->SetupAttachment(RootComponent);
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Mesh->SetRelativeScale3D(FVector(1.1f));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    if (Sphere.Succeeded()) Mesh->SetStaticMesh(Sphere.Object);

    Trigger->OnComponentBeginOverlap.AddDynamic(this, &AOptomoleHazardActor::OnOverlap);
}

void AOptomoleHazardActor::BeginPlay()
{
    Super::BeginPlay();
    if (UMaterialInstanceDynamic* MID = Mesh->CreateAndSetMaterialInstanceDynamic(0))
    {
        MID->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.9f, 0.2f, 0.2f));
    }
}

void AOptomoleHazardActor::OnOverlap(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
    if (OtherActor != UGameplayStatics::GetPlayerPawn(this, 0)) return;

    const double Now = GetWorld()->GetTimeSeconds();
    if (Now - LastHitTime < 1.0) return; // cooldown
    LastHitTime = Now;

    if (AOptomoleGameMode* GM = GetWorld()->GetAuthGameMode<AOptomoleGameMode>())
    {
        GM->HitHazard(Label);
    }
}
