from typing import Literal

from pydantic_ai.profiles.google import google_model_profile

Thinking = Literal["default", "low", "medium", "high", "xhigh", "max"]

# https://developers.openai.com/api/docs/models/gpt-6-luna
OPENAI_THINKING_LEVELS: dict[str, tuple[Thinking, ...]] = {
    "gpt-6-luna": ("low", "medium", "high", "xhigh", "max"),
}


def thinking_levels(provider: str, model: str) -> list[Thinking]:
    """Expose only documented model levels; never guess support from a family name."""
    levels: list[Thinking] = ["default"]
    if provider == "openai":
        return levels + list(OPENAI_THINKING_LEVELS.get(model, ()))
    if provider != "google":
        return levels
    profile = google_model_profile(model.removeprefix("models/"))
    supported = profile.get("google_thinking_levels") if profile else None
    if supported:
        for level in ("low", "medium", "high"):
            if level.upper() in supported:
                levels.append(level)
    return levels


def validate_thinking(provider: str, model: str, thinking: Thinking) -> None:
    if thinking not in thinking_levels(provider, model):
        raise ValueError("This thinking level is not supported by the selected provider/model.")
