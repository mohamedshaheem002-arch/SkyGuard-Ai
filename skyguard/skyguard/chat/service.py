"""Groq AI Chatbot Service for SkyGuard AI.

Orchestrates tool calling, system prompts, token budget management,
and SSE streaming using the official Groq Python SDK.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncGenerator, Dict, List, Optional

from .prompts import SKYGUARD_SYSTEM_PROMPT
from .tools import GROQ_TOOLS, execute_tool_call

logger = logging.getLogger("skyguard.chat")

# Groq Model & Token Budget Configuration
DEFAULT_MODEL = "qwen/qwen3.8-27b"
FALLBACK_MODEL = "openai/gpt-oss-120b"
MAX_OUTPUT_TOKENS = 750             # Safely bounded below on-demand rate limits (700-800 tokens)
DEFAULT_MAX_TOOL_ITERATIONS = 2    # Prevent tool execution loops


class GroqChatService:
    def __init__(self):
        self.api_key: Optional[str] = os.environ.get("GROQ_API_KEY", "").strip() or None
        self.model: str = os.environ.get("GROQ_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        self._client = None

    def _get_client(self):
        """Lazy initialization of the Groq client with runtime .env reload check."""
        current_key = os.environ.get("GROQ_API_KEY", "").strip() or None
        if not current_key:
            raise ValueError(
                "GROQ_API_KEY environment variable is not configured on the server. "
                "Please set GROQ_API_KEY in your server environment to enable SkyGuard Copilot."
            )
        if self._client is None or self.api_key != current_key:
            try:
                from groq import Groq
                self.api_key = current_key
                self._client = Groq(api_key=self.api_key, timeout=25.0)
            except Exception as e:
                raise RuntimeError(f"Failed to initialize Groq client: {e}")
        return self._client

    def get_status(self) -> Dict[str, Any]:
        """Check status of Groq service and model configuration."""
        key = os.environ.get("GROQ_API_KEY", "").strip()
        model = os.environ.get("GROQ_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        return {
            "configured": bool(key),
            "service": "Groq AI Cloud",
            "model": model,
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "tools_count": len(GROQ_TOOLS),
            "status": "ready" if bool(key) else "missing_api_key",
        }

    def _build_system_message(self, context: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
        """Construct a compact system prompt augmented with active client UI context."""
        ctx_prompt = SKYGUARD_SYSTEM_PROMPT
        if context:
            ctx_items = []
            if context.get("active_tab"):
                ctx_items.append(f"Tab: {context['active_tab']}")
            if context.get("selected_station_id"):
                ctx_items.append(f"Station: {context['selected_station_id']}")
            if context.get("selected_timestamp"):
                ctx_items.append(f"Timestamp: {context['selected_timestamp']}")
            if context.get("upload_id"):
                ctx_items.append(f"Upload: {context['upload_id']}")
            if ctx_items:
                ctx_prompt += "\nActive Screen Context: " + ", ".join(ctx_items)

        return {"role": "system", "content": ctx_prompt}

    def _prepare_conversation(
        self,
        messages: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Prepare compact message history bounded to last 4 turns to conserve token budget."""
        conversation: List[Dict[str, Any]] = [self._build_system_message(context)]
        recent_messages = messages[-4:] if len(messages) > 4 else messages
        for m in recent_messages:
            conversation.append({
                "role": m.get("role", "user"),
                "content": m.get("content", ""),
            })
        return conversation

    def chat(
        self,
        messages: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
        max_tool_iterations: int = DEFAULT_MAX_TOOL_ITERATIONS,
    ) -> Dict[str, Any]:
        """Non-streaming chat execution with bounded tool calling and token limit."""
        try:
            client = self._get_client()
        except ValueError as e:
            return {
                "role": "assistant",
                "content": f"⚠️ **Groq API Key Not Configured**\n\n{str(e)}",
                "tools_used": [],
                "model": self.model,
            }

        conversation = self._prepare_conversation(messages, context)
        tools_used: List[Dict[str, Any]] = []
        executed_tool_signatures = set()

        try:
            for _ in range(max_tool_iterations):
                response = client.chat.completions.create(
                    model=self.model,
                    messages=conversation,
                    tools=GROQ_TOOLS,
                    tool_choice="auto",
                    temperature=0.2,
                    max_tokens=MAX_OUTPUT_TOKENS,
                )

                response_message = response.choices[0].message
                tool_calls = getattr(response_message, "tool_calls", None)

                if not tool_calls:
                    return {
                        "role": "assistant",
                        "content": response_message.content or "",
                        "tools_used": tools_used,
                        "model": self.model,
                    }

                conversation.append(response_message)

                has_new_tool = False
                for tool_call in tool_calls:
                    fn_name = tool_call.function.name
                    try:
                        fn_args = json.loads(tool_call.function.arguments)
                    except Exception:
                        fn_args = {}

                    if context and context.get("upload_id") and "upload_id" not in fn_args:
                        fn_args["upload_id"] = context["upload_id"]

                    sig = f"{fn_name}:{json.dumps(fn_args, sort_keys=True)}"
                    if sig in executed_tool_signatures:
                        # Prevent duplicate identical tool queries
                        continue

                    executed_tool_signatures.add(sig)
                    has_new_tool = True
                    tool_result = execute_tool_call(fn_name, fn_args)
                    tools_used.append({"tool": fn_name, "arguments": fn_args})

                    conversation.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": fn_name,
                        "content": json.dumps(tool_result, default=str),
                    })

                if not has_new_tool:
                    break

            # Final generation pass after tools resolved
            final_res = client.chat.completions.create(
                model=self.model,
                messages=conversation,
                temperature=0.2,
                max_tokens=MAX_OUTPUT_TOKENS,
            )
            return {
                "role": "assistant",
                "content": final_res.choices[0].message.content or "",
                "tools_used": tools_used,
                "model": self.model,
            }

        except Exception as e:
            logger.error(f"Groq Chat API error: {e}", exc_info=True)
            return {
                "role": "assistant",
                "content": f"⚠️ **Groq AI Service Notice**: {str(e)}",
                "tools_used": tools_used,
                "model": self.model,
            }

    async def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
        max_tool_iterations: int = DEFAULT_MAX_TOOL_ITERATIONS,
    ) -> AsyncGenerator[str, None]:
        """Streaming chat execution with bounded tool calling and token limit."""
        try:
            client = self._get_client()
        except ValueError as e:
            err_msg = json.dumps({"error": str(e), "chunk": f"⚠️ **Groq API Key Not Configured**\n\n{str(e)}"})
            yield f"data: {err_msg}\n\n"
            yield "data: [DONE]\n\n"
            return

        conversation = self._prepare_conversation(messages, context)
        executed_tool_signatures = set()

        try:
            # Step 1: Resolve tool calls with compact budget
            for _ in range(max_tool_iterations):
                response = client.chat.completions.create(
                    model=self.model,
                    messages=conversation,
                    tools=GROQ_TOOLS,
                    tool_choice="auto",
                    temperature=0.2,
                    max_tokens=MAX_OUTPUT_TOKENS,
                )

                response_message = response.choices[0].message
                tool_calls = getattr(response_message, "tool_calls", None)

                if not tool_calls:
                    break

                conversation.append(response_message)

                has_new_tool = False
                for tool_call in tool_calls:
                    fn_name = tool_call.function.name
                    try:
                        fn_args = json.loads(tool_call.function.arguments)
                    except Exception:
                        fn_args = {}

                    if context and context.get("upload_id") and "upload_id" not in fn_args:
                        fn_args["upload_id"] = context["upload_id"]

                    sig = f"{fn_name}:{json.dumps(fn_args, sort_keys=True)}"
                    if sig in executed_tool_signatures:
                        continue

                    executed_tool_signatures.add(sig)
                    has_new_tool = True

                    # Emit SSE event indicating tool activity
                    yield f"data: {json.dumps({'event': 'tool_call', 'tool': fn_name, 'args': fn_args})}\n\n"

                    tool_result = execute_tool_call(fn_name, fn_args)

                    conversation.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": fn_name,
                        "content": json.dumps(tool_result, default=str),
                    })

                if not has_new_tool:
                    break

            # Step 2: Stream final text answer token by token
            stream_response = client.chat.completions.create(
                model=self.model,
                messages=conversation,
                temperature=0.2,
                max_tokens=MAX_OUTPUT_TOKENS,
                stream=True,
            )

            for chunk in stream_response:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'chunk': token})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Groq Chat Stream error: {e}", exc_info=True)
            err_text = f"\n\n⚠️ **Groq AI Service Notice**: {str(e)}"
            yield f"data: {json.dumps({'error': str(e), 'chunk': err_text})}\n\n"
            yield "data: [DONE]\n\n"


# Singleton instance
CHAT_SERVICE = GroqChatService()
