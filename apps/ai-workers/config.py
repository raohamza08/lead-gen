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


settings = Settings()
