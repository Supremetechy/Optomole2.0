#include "OptomoleHUD.h"
#include "OptomoleGameMode.h"
#include "Engine/Canvas.h"
#include "CanvasItem.h"
#include "Engine/Font.h"
#include "Engine/Engine.h"

void AOptomoleHUD::DrawHUD()
{
    Super::DrawHUD();

    AOptomoleGameMode* GM = GetWorld() ? GetWorld()->GetAuthGameMode<AOptomoleGameMode>() : nullptr;
    if (!GM || !Canvas) return;

    UFont* Font = GEngine ? GEngine->GetLargeFont() : nullptr;
    const float X = 40.f;
    float Y = 40.f;
    auto Line = [&](const FString& Text, const FLinearColor& Color, float Scale)
    {
        FCanvasTextItem Item(FVector2D(X, Y), FText::FromString(Text), Font, Color);
        Item.Scale = FVector2D(Scale, Scale);
        Canvas->DrawItem(Item);
        Y += 26.f * Scale;
    };

    Line(GM->GetTitle(), FLinearColor(0.4f, 0.9f, 1.0f), 1.3f);
    Line(FString::Printf(TEXT("%s  -  Action Adventure: Key & Lock"), *GM->GetGenreTitle()), FLinearColor::White, 0.9f);
    Y += 8.f;

    if (GM->IsWon())
    {
        Line(TEXT("ALL ROOMS CLEARED - Inbox Zero!"), FLinearColor(0.3f, 1.0f, 0.4f), 1.4f);
    }
    else if (GM->IsFailed())
    {
        Line(TEXT("FOCUS DEPLETED - Run failed. Restart to try again."), FLinearColor(1.0f, 0.35f, 0.35f), 1.2f);
    }
    else
    {
        Line(FString::Printf(TEXT("Room %d / %d"), GM->GetCurrentRoom() + 1, GM->GetRoomCount()), FLinearColor::White, 1.1f);
        Line(FString::Printf(TEXT("Keys  %d / %d"), GM->GetKeysThisRoom(), GM->GetRequiredKeysThisRoom()), FLinearColor(0.85f, 0.7f, 0.15f), 1.1f);
        Line(FString::Printf(TEXT("Focus %d"), GM->GetFocus()), FLinearColor(0.4f, 0.9f, 1.0f), 1.1f);
        Line(FString::Printf(TEXT("XP    %d"), GM->GetXp()), FLinearColor::White, 1.0f);
        Y += 6.f;
        Line(TEXT("WASD to move. Collect the keys, avoid red hazards, reach the gate."), FLinearColor(0.7f, 0.75f, 0.8f), 0.8f);
    }
}
