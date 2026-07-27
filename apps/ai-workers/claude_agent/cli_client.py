"""
Shells out to the local Claude Code CLI so lead-finding runs on the user's
existing paid Claude Code subscription (OAuth session login) instead of
requiring a separately-billed ANTHROPIC_API_KEY. Headless invocation:
`claude -p <prompt> --output-format json --allowed-tools "WebSearch,WebFetch"
--permission-mode dontAsk` — restricted to read-only web tools, never file/Bash
access, since this runs unattended from a background worker.
"""
import asyncio
import json
import logging
import shutil
import subprocess

logger = logging.getLogger("claude_agent.cli_client")

_CLI_PATH = shutil.which("claude")


class ClaudeCliUnavailable(Exception):
    """Raised whenever the CLI can't be used — caller should fall back to demo/heuristic mode."""


def _run_sync(prompt: str, timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            _CLI_PATH,
            "-p", prompt,
            "--output-format", "json",
            "--allowed-tools", "WebSearch,WebFetch",
            "--permission-mode", "dontAsk",
        ],
        capture_output=True,
        timeout=timeout,
    )


async def query(prompt: str, timeout: int = 120) -> dict:
    """Runs one headless `claude -p` turn and returns the parsed result envelope.

    Uses a synchronous subprocess.run() dispatched to a worker thread rather
    than asyncio.create_subprocess_exec — on Windows, uvicorn's default event
    loop is a SelectorEventLoop, which raises NotImplementedError for any
    subprocess creation (ProactorEventLoop is required for that, but isn't
    what uvicorn installs). Thread-executor + blocking subprocess sidesteps
    the loop's subprocess-transport support entirely, and works the same way
    cross-platform.
    """
    if not _CLI_PATH:
        raise ClaudeCliUnavailable("`claude` CLI not found on PATH")

    try:
        result = await asyncio.to_thread(_run_sync, prompt, timeout)
    except subprocess.TimeoutExpired:
        raise ClaudeCliUnavailable(f"claude CLI timed out after {timeout}s")

    if result.returncode != 0:
        raise ClaudeCliUnavailable(
            f"claude CLI exited {result.returncode}: {result.stderr.decode(errors='replace')[:500]}"
        )

    try:
        envelope = json.loads(result.stdout.decode(errors="replace"))
    except json.JSONDecodeError as err:
        stderr_tail = result.stderr.decode(errors="replace")[:500]
        raise ClaudeCliUnavailable(
            f"claude CLI produced non-JSON output: {err} (stderr: {stderr_tail!r})"
        )

    if envelope.get("is_error"):
        raise ClaudeCliUnavailable(f"claude CLI reported an error: {envelope.get('result')}")
    return envelope


def extract_json(result_text: str) -> dict | None:
    """The CLI's `result` field is the model's final text. We prompt for pure
    JSON, but models sometimes wrap it in prose or markdown fences, so fall
    back to extracting the outermost {...} block before giving up."""
    if not result_text:
        return None
    try:
        return json.loads(result_text)
    except json.JSONDecodeError:
        pass
    start = result_text.find("{")
    end = result_text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(result_text[start : end + 1])
    except json.JSONDecodeError:
        return None
