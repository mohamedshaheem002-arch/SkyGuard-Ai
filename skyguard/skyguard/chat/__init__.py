"""SkyGuard Chat package: Groq AI integration with read-only tools."""
from .service import GroqChatService, CHAT_SERVICE
from .tools import (
    ChatContextRegistry,
    GROQ_TOOLS,
    TOOL_MAP,
    execute_tool_call,
    get_network_summary,
    get_station_health,
    get_station_timeseries,
    get_active_alerts,
    inspect_upload,
    explain_shap_features,
)
from .prompts import SKYGUARD_SYSTEM_PROMPT

__all__ = [
    "GroqChatService",
    "CHAT_SERVICE",
    "ChatContextRegistry",
    "GROQ_TOOLS",
    "TOOL_MAP",
    "execute_tool_call",
    "get_network_summary",
    "get_station_health",
    "get_station_timeseries",
    "get_active_alerts",
    "inspect_upload",
    "explain_shap_features",
    "SKYGUARD_SYSTEM_PROMPT",
]
