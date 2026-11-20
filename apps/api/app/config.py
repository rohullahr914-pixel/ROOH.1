from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    whatsapp_owner_token: str | None = None
    whatsapp_bridge_secret: str | None = None
    whatsapp_bridge_port: int = 3010
    openai_api_key: str | None = None
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    v0_api_key: str | None = None
    youtube_api_key: str | None = None
    sketchfab_api_token: str | None = None
    twelvedata_api_key: str | None = None
    wikipedia_user_agent: str = "RooH/1.0 (https://www.mediawiki.org/wiki/API:Etiquette)"
    openai_text_model: str = "gpt-4.1-mini"
    openai_realtime_model: str = "gpt-realtime"
    openai_realtime_voice: str = "marin"
    allowed_origins: str = "http://localhost:3000"
    # Prefer the repository-level environment file when the API is launched
    # from apps/api; a stale local file must not override current credentials.
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
