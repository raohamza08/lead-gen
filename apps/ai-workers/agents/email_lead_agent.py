"""
Judges whether an inbound email's sender is someone the org could realistically
pitch its services, solution, or product to (Part: Smart Email Classification /
Lead Room). Standalone rather than chained into the lead-acquisition pipeline
— it runs against mail arriving in the Email Hub, not a discovered company.

Flags for human confirmation only — see EmailHubSyncWorker.persistMessage and
InboundEmailMessage.suggestedCategory. Nothing downstream ever auto-creates a
lead from this agent's output; a person still clicks Add to Lead.
"""
from __future__ import annotations

import json
import logging

from claude_agent import cli_client
from shared.prompts import load_prompt

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.email_lead")


class EmailLeadClassifierAgent(Agent):
    name = "email_lead_classifier"
    responsibility = "Judges whether an inbound email's sender is a viable prospect to pitch, for a human to confirm — never auto-creates a lead."
    requires = ("email_input",)
    provides = ("email_lead_result",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        email = ctx.get("email_input")
        org_context = ctx.get("org_context")

        input_json = json.dumps(
            {
                "fromName": email.get("fromName") or "(no name given)",
                "fromEmail": email["fromEmail"],
                "subject": email["subject"],
                # Classification only needs enough to judge intent, not the
                # full body — keeps the call cheap and avoids leaking an
                # entire (possibly long) thread into the prompt.
                "bodyExcerpt": email["bodyText"][:2000],
            },
            default=str,
        )

        prompt = f"{load_prompt('email_lead_classifier', org_context)}\n\nEMAIL\n{input_json}"

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"email_lead_result": {}},
                error=str(err),
                notes=["classification not generated — Claude CLI unavailable"],
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data or "isCandidate" not in data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"email_lead_result": {}},
                notes=["classification returned unparseable output"],
            )

        return AgentResult(status=AgentStatus.OK, data={"email_lead_result": data})
