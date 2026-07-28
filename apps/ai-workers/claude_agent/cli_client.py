"""
Shells out to the local Claude Code CLI so lead-finding runs on the user's
existing paid Claude Code subscription (OAuth session login) instead of
requiring a separately-billed ANTHROPIC_API_KEY. Headless invocation:
`claude -p --output-format json --allowed-tools "WebSearch,WebFetch"
--permission-mode dontAsk` with the prompt piped in on stdin — restricted to
read-only web tools, never file/Bash access, since this runs unattended from a
background worker.
"""
import asyncio
import json
import logging
import shutil
import subprocess

from config import settings

logger = logging.getLogger("claude_agent.cli_client")

_CLI_PATH = shutil.which("claude")

# A lead-search turn does real web searches: slow, and it consumes subscription
# quota. Several extraction runs can be in flight at once (one per niche
# filter, plus any manual "run now"), so gate every invocation through one
# process-wide semaphore instead of letting each run spawn CLI processes freely.
_semaphore = asyncio.Semaphore(max(1, settings.claude_cli_max_concurrency))


class ClaudeCliUnavailable(Exception):
    """Raised whenever the CLI can't be used — caller decides whether to degrade or abort."""


def _run_sync(prompt: str, timeout: int) -> subprocess.CompletedProcess:
    # The prompt goes in on stdin, NOT as an argv element — see query()'s docstring.
    return subprocess.run(
        [
            _CLI_PATH,
            "-p",
            "--output-format", "json",
            "--allowed-tools", "WebSearch,WebFetch",
            "--permission-mode", "dontAsk",
        ],
        input=prompt.encode("utf-8"),
        capture_output=True,
        timeout=timeout,
    )


async def query(prompt: str, timeout: int | None = None) -> dict:
    """Runs one headless `claude -p` turn and returns the parsed result envelope.

    Retries transient failures with exponential backoff. In practice a long
    web-search turn intermittently exits 1 with *both* streams empty after a
    run of successful calls — consistent with subscription rate limiting rather
    than anything wrong with the invocation, since short prompts succeed
    sequentially and concurrently at the same moment. Retrying with backoff is
    the treatment; the raised error carries both streams so a genuinely new
    failure mode is diagnosable rather than another silent empty string.

    Two Windows-specific hazards shape how this is invoked:

    1. **The prompt is piped on stdin, never passed as an argv element.** On
       Windows `shutil.which("claude")` resolves to `claude.CMD`, an npm batch
       shim, so CreateProcess runs it through `cmd.exe` — and cmd.exe's parser
       stops at the first newline in the command line. Our search prompts are
       multi-line, so passing one as `-p <prompt>` silently truncated the
       command and **dropped every flag after it**: no `--output-format json`
       (so stdout came back as raw prose instead of the JSON envelope) and no
       `--allowed-tools`/`--permission-mode` (so the model's WebSearch calls
       were denied and it returned an apology). Piping on stdin keeps every
       argv element newline-free, so cmd.exe passes them through intact.
    2. **Synchronous subprocess.run() dispatched to a worker thread**, rather
       than asyncio.create_subprocess_exec — on Windows, uvicorn's default
       event loop is a SelectorEventLoop, which raises NotImplementedError for
       any subprocess creation (ProactorEventLoop is required, but isn't what
       uvicorn installs). Thread-executor + blocking subprocess sidesteps the
       loop's subprocess-transport support entirely, and behaves identically
       cross-platform.
    """
    if not _CLI_PATH:
        raise ClaudeCliUnavailable("`claude` CLI not found on PATH")

    effective_timeout = timeout or settings.claude_cli_timeout_seconds
    attempts = max(1, settings.claude_cli_max_attempts)
    last_error: ClaudeCliUnavailable | None = None

    for attempt in range(1, attempts + 1):
        try:
            async with _semaphore:
                return await _attempt(prompt, effective_timeout)
        except ClaudeCliUnavailable as err:
            last_error = err
            if attempt == attempts:
                break
            # 2s, 4s, 8s … — enough to ride out a short rate-limit window
            # without stalling an extraction run for minutes.
            backoff = 2 ** attempt
            logger.warning(
                "claude CLI attempt %d/%d failed (%s) — retrying in %ds",
                attempt, attempts, err, backoff,
            )
            await asyncio.sleep(backoff)

    raise ClaudeCliUnavailable(f"claude CLI failed after {attempts} attempt(s): {last_error}")


async def _attempt(prompt: str, timeout: int) -> dict:
    """One invocation. Every failure path raises ClaudeCliUnavailable so the
    retry loop above can treat them uniformly."""
    try:
        result = await asyncio.to_thread(_run_sync, prompt, timeout)
    except subprocess.TimeoutExpired:
        raise ClaudeCliUnavailable(f"timed out after {timeout}s")
    except OSError as err:
        raise ClaudeCliUnavailable(f"could not start the CLI process: {err}")

    stdout = result.stdout.decode(errors="replace")
    stderr_tail = result.stderr.decode(errors="replace")[:500]

    if result.returncode != 0:
        # Both streams, not just stderr — the observed rate-limit-shaped failure
        # exits non-zero with stderr empty, so stderr alone reads as no
        # information at all.
        raise ClaudeCliUnavailable(
            f"exited {result.returncode} "
            f"(stdout: {stdout[:200]!r}, stderr: {stderr_tail!r})"
        )

    # Exit 0 with nothing on stdout means the CLI never actually ran our turn
    # (a mangled command line, a login/session problem). Call it out explicitly
    # rather than letting it surface as a confusing JSON parse error on "".
    if not stdout.strip():
        raise ClaudeCliUnavailable(f"exited 0 but produced no stdout (stderr: {stderr_tail!r})")

    try:
        envelope = json.loads(stdout)
    except json.JSONDecodeError as err:
        raise ClaudeCliUnavailable(
            f"produced non-JSON output: {err} "
            f"(stdout: {stdout[:200]!r}, stderr: {stderr_tail!r})"
        )

    if envelope.get("is_error"):
        raise ClaudeCliUnavailable(f"reported an error: {envelope.get('result')}")
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
