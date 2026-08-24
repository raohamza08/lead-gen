"""
Drafts or repurposes a social media post from a short brief (Part: Social
Media Management — AI content generation). One agent backs two editable
prompts (social_content_generate.txt / social_content_repurpose.txt),
selected at runtime by `mode` in the input — same "one runner, several named
prompts" shape already used for the email sequence steps.

Output is always a draft the operator edits before anything is scheduled —
this agent never decides to publish anything, it only produces text.
"""
from __future__ import annotations

import json
import logging

from claude_agent import cli_client
from shared.prompts import load_prompt

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.social_content")


class SocialContentAgent(Agent):
    name = "social_content"
    responsibility = "Drafts or repurposes a social media caption from a brief, never inventing a claim the operator didn't state."
    requires = ("social_content_input",)
    provides = ("social_content_result",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        input_data = ctx.get("social_content_input")
        org_context = ctx.get("org_context")
        mode = input_data.get("mode", "generate")
        prompt_name = "social_content_repurpose" if mode == "repurpose" else "social_content_generate"

        input_json = json.dumps(
            {k: v for k, v in input_data.items() if k != "mode"},
            default=str,
        )[:6000]

        prompt = f"{load_prompt(prompt_name, org_context)}\n\nINPUT\n{input_json}"

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"social_content_result": {}},
                error=str(err),
                notes=["content not generated — Claude CLI unavailable"],
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data or "content" not in data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"social_content_result": {}},
                notes=["generation returned unparseable output"],
            )

        return AgentResult(status=AgentStatus.OK, data={"social_content_result": data})
