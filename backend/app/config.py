from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # No working default. An unset SECRET_KEY should stop the server, not
    # quietly sign tokens with a value that is published in the repo.
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 10080  # 7 days

    # AI providers — Groq primary, Gemini fallback. Both optional: with
    # neither key set the app still runs, on deterministic analytics and the
    # rule-based difficulty engine.
    groq_api_key: str = ""
    gemini_api_key: str = ""
    # llama-3.1-8b-instant was retired by Groq; gpt-oss-120b is current.
    groq_model: str = "openai/gpt-oss-120b"
    gemini_model: str = "gemini-2.5-flash"

    database_url: str = "sqlite:///./sahaay.db"

    frontend_origins: str = "http://localhost:5173,http://localhost:4173"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def ai_configured(self) -> bool:
        return bool(self.groq_api_key or self.gemini_api_key)

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
