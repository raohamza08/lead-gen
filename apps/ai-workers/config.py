import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    api_base_url: str = os.getenv("API_BASE_URL", "http://localhost:4000/api/v1")
    internal_service_token: str = os.getenv("INTERNAL_SERVICE_TOKEN", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    google_genai_api_key: str = os.getenv("GOOGLE_GENAI_API_KEY", "")
    hunter_api_key: str = os.getenv("HUNTER_API_KEY", "")
    neverbounce_api_key: str = os.getenv("NEVERBOUNCE_API_KEY", "")
    builtwith_api_key: str = os.getenv("BUILTWITH_API_KEY", "")

    # Bounded search loop (Part C1) — prevents an unbounded retry against a
    # saturated/thin niche from burning API budget indefinitely.
    max_search_attempts: int = int(os.getenv("MAX_SEARCH_ATTEMPTS", "40"))
    max_runtime_seconds: int = int(os.getenv("MAX_RUNTIME_SECONDS", "1200"))

    # Off by default, and it must stay that way against any real database.
    # When the Claude CLI is unavailable the lead-finder can substitute
    # synthetic `[DEMO DATA]` companies so the downstream pipeline stays
    # exercisable — but those rows are indistinguishable from real leads once
    # inserted, and the spec's hard requirement is "only verified leads".
    # Enable it only for local pipeline demos against a throwaway DB.
    allow_demo_fallback: bool = os.getenv("ALLOW_DEMO_FALLBACK", "false").lower() in ("1", "true", "yes")

    # The CLI runs one headless Claude turn per call, and a lead-search turn
    # does real web searches — slow and quota-consuming. Cap how many run at
    # once so several concurrent extraction runs can't stampede it.
    claude_cli_max_concurrency: int = int(os.getenv("CLAUDE_CLI_MAX_CONCURRENCY", "2"))
    claude_cli_max_attempts: int = int(os.getenv("CLAUDE_CLI_MAX_ATTEMPTS", "3"))
    claude_cli_timeout_seconds: int = int(os.getenv("CLAUDE_CLI_TIMEOUT_SECONDS", "180"))


settings = Settings()
