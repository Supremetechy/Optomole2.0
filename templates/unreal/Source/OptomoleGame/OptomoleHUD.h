#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "OptomoleHUD.generated.h"

// Minimal canvas HUD: title, current room, keys collected / required, focus,
// and the win/lose banner. Reads live state from the game mode each frame.
UCLASS()
class OPTOMOLEGAME_API AOptomoleHUD : public AHUD
{
    GENERATED_BODY()

public:
    virtual void DrawHUD() override;
};
