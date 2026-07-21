#include "OptomolePlayerPawn.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/FloatingPawnMovement.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

AOptomolePlayerPawn::AOptomolePlayerPawn()
{
    PrimaryActorTick.bCanEverTick = false;

    Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
    Collision->InitSphereRadius(60.f);
    Collision->SetCollisionProfileName(TEXT("Pawn"));
    Collision->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
    RootComponent = Collision;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    Mesh->SetupAttachment(RootComponent);
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Mesh->SetRelativeScale3D(FVector(1.0f));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    if (Sphere.Succeeded()) Mesh->SetStaticMesh(Sphere.Object);

    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
    SpringArm->SetupAttachment(RootComponent);
    SpringArm->TargetArmLength = 1500.f;
    SpringArm->SetRelativeRotation(FRotator(-60.f, 0.f, 0.f));
    SpringArm->bDoCollisionTest = false;
    SpringArm->bInheritPitch = false;
    SpringArm->bInheritYaw = false;
    SpringArm->bInheritRoll = false;

    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(SpringArm, USpringArmComponent::SocketName);

    Movement = CreateDefaultSubobject<UFloatingPawnMovement>(TEXT("Movement"));
    Movement->UpdatedComponent = RootComponent;
    Movement->MaxSpeed = 900.f;
    Movement->Acceleration = 4000.f;
    Movement->Deceleration = 6000.f;

    AutoPossessPlayer = EAutoReceiveInput::Disabled; // GameMode possesses us.
}

void AOptomolePlayerPawn::BeginPlay()
{
    Super::BeginPlay();
    if (UMaterialInstanceDynamic* MID = Mesh->CreateAndSetMaterialInstanceDynamic(0))
    {
        MID->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.2f, 0.8f, 0.95f));
    }
}

void AOptomolePlayerPawn::SetupPlayerInputComponent(UInputComponent* InputComponent)
{
    Super::SetupPlayerInputComponent(InputComponent);
    InputComponent->BindAxis(TEXT("MoveForward"), this, &AOptomolePlayerPawn::MoveForward);
    InputComponent->BindAxis(TEXT("MoveRight"), this, &AOptomolePlayerPawn::MoveRight);
}

void AOptomolePlayerPawn::MoveForward(float Value)
{
    if (Value != 0.f) AddMovementInput(FVector(1.f, 0.f, 0.f), Value); // world +X
}

void AOptomolePlayerPawn::MoveRight(float Value)
{
    if (Value != 0.f) AddMovementInput(FVector(0.f, 1.f, 0.f), Value); // world +Y
}
