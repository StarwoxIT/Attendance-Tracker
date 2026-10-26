#!/usr/bin/env python3
"""
Office Network Agent — Digital Office Attendance & Clocking System.

Runs inside the physical office network (NOT on Vercel). Periodically
determines the office's current public IP (which changes on Starlink) and
reports it to the attendance server over an authenticated, signed heartbeat.

Usage:
    python agent.py test      # one-shot diagnostic: IP detection + connectivity + auth
    python agent.py register  # one-time pairing using a registration token from the admin
    python agent.py run       # long-running heartbeat loop (what you'd run as a service)

Configuration is read from environment variables / a local .env file
(see .env.example). After a successful `register`, the issued agent signing
secret is stored in agent_state.json next to this script — keep that file
private (it is the equivalent of a webhook signing secret).
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import os
import socket
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

import requests
import urllib3.util.connection as urllib3_connection

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

STATE_FILE = Path(__file__).parent / "agent_state.json"
LOG_FILE = Path(__file__).parent / "agent.log"

# Each of these answers over IPv4 and IPv6 alike, reporting the address the
# request arrived from — so under force_ip_family() they report that family's IP.
IP_LOOKUP_SERVICES = [
    "https://api64.ipify.org",
    "https://icanhazip.com",
    "https://ifconfig.co/ip",
]

# Browsers on the office Wi-Fi reach the server over IPv4 or IPv6 (whichever
# connects first, per browser and per page load), and the server only learns an
# office address from a heartbeat that arrives over that same family. So every
# cycle heartbeats once per family; one the office doesn't have is just skipped.
IP_FAMILIES = {"IPv4": socket.AF_INET, "IPv6": socket.AF_INET6}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_FILE)],
)
log = logging.getLogger("network-agent")


class ConfigError(RuntimeError):
    pass


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def server_url() -> str:
    return require_env("SERVER_URL").rstrip("/")


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))
    try:
        os.chmod(STATE_FILE, 0o600)
    except OSError:
        pass  # best-effort on platforms without POSIX permissions (e.g. some Windows setups)


@contextmanager
def force_ip_family(family: int) -> Iterator[None]:
    """Makes `requests` (via urllib3) connect only over the given address family."""
    original = urllib3_connection.allowed_gai_family
    urllib3_connection.allowed_gai_family = lambda: family
    try:
        yield
    finally:
        urllib3_connection.allowed_gai_family = original


def detect_public_ip(timeout: float = 8.0) -> str:
    last_error: Optional[Exception] = None
    for url in IP_LOOKUP_SERVICES:
        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
            ip = resp.text.strip()
            if ip:
                return ip
        except requests.RequestException as exc:  # try the next provider
            last_error = exc
            log.warning("IP lookup via %s failed: %s", url, exc)
    raise RuntimeError(f"Could not determine public IP from any provider: {last_error}")


def register(office_id: str, agent_id: str, registration_token: str) -> str:
    """One-time bootstrap: exchanges the admin-issued registration token for a signing secret."""
    resp = requests.post(
        f"{server_url()}/api/network/register",
        json={"officeId": office_id, "agentId": agent_id, "registrationToken": registration_token},
        timeout=15,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Registration failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    secret = data["agentSigningSecret"]
    save_state({"officeId": office_id, "agentId": agent_id, "agentSigningSecret": secret})
    log.info("Registered successfully. Signing secret stored in %s", STATE_FILE)
    return secret


def sign_payload(secret: str, timestamp: str, payload: str) -> str:
    message = f"{timestamp}.{payload}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def send_heartbeat(office_id: str, agent_id: str, secret: str, reported_ip: str) -> None:
    payload = json.dumps({"officeId": office_id, "agentId": agent_id, "reportedIp": reported_ip}, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signature = sign_payload(secret, timestamp, payload)

    resp = requests.post(
        f"{server_url()}/api/network/heartbeat",
        json={
            "officeId": office_id,
            "agentId": agent_id,
            "reportedIp": reported_ip,
            "timestamp": timestamp,
            "signature": signature,
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Heartbeat rejected ({resp.status_code}): {resp.text}")
    log.info("Heartbeat OK — reported IP %s", reported_ip)


def ensure_registered() -> dict:
    state = load_state()
    if state.get("agentSigningSecret"):
        return state

    office_id = require_env("OFFICE_ID")
    agent_id = require_env("AGENT_ID")
    registration_token = os.environ.get("REGISTRATION_TOKEN")
    if not registration_token:
        raise ConfigError(
            "Agent is not registered yet and REGISTRATION_TOKEN is not set. "
            "Run `python agent.py register` with a token from the admin dashboard."
        )
    secret = register(office_id, agent_id, registration_token)
    return {"officeId": office_id, "agentId": agent_id, "agentSigningSecret": secret}


def cmd_register(args: argparse.Namespace) -> None:
    office_id = args.office_id or require_env("OFFICE_ID")
    agent_id = args.agent_id or require_env("AGENT_ID")
    token = args.token or require_env("REGISTRATION_TOKEN")
    register(office_id, agent_id, token)
    print("Registration complete.")


def cmd_test(_args: argparse.Namespace) -> None:
    print(f"Server:           {server_url()}")
    try:
        state = ensure_registered()
        print("Authentication:    Valid (registered)")
    except ConfigError as exc:
        print(f"Authentication:    Not registered — {exc}")
        sys.exit(1)

    succeeded = 0
    for name, family in IP_FAMILIES.items():
        try:
            with force_ip_family(family):
                ip = detect_public_ip()
                print(f"{name} public IP:     {ip}")
                send_heartbeat(state["officeId"], state["agentId"], state["agentSigningSecret"], ip)
            print(f"{name} heartbeat:     Successful")
            succeeded += 1
        except Exception as exc:  # noqa: BLE001
            print(f"{name}:               not available — {exc}")
    if succeeded == 0:
        print("Heartbeat:          FAILED over both IPv4 and IPv6")
        sys.exit(1)


def heartbeat_all_families(state: dict) -> int:
    """One heartbeat per IP family the office has. Returns how many succeeded."""
    succeeded = 0
    for name, family in IP_FAMILIES.items():
        try:
            with force_ip_family(family):
                ip = detect_public_ip()
                send_heartbeat(state["officeId"], state["agentId"], state["agentSigningSecret"], ip)
            succeeded += 1
        except Exception as exc:  # noqa: BLE001 — e.g. the office simply has no IPv6
            log.info("%s heartbeat skipped: %s", name, exc)
    return succeeded


def cmd_run(_args: argparse.Namespace) -> None:
    interval_minutes = float(os.environ.get("HEARTBEAT_INTERVAL", "10"))
    interval_seconds = max(30.0, interval_minutes * 60)
    log.info("Starting network agent. Heartbeat interval: %s minutes", interval_minutes)

    backoff_seconds = 10
    max_backoff_seconds = 300

    while True:
        try:
            state = ensure_registered()
            if heartbeat_all_families(state) == 0:
                raise RuntimeError("No heartbeat succeeded over IPv4 or IPv6")
            backoff_seconds = 10  # reset backoff after a success
            time.sleep(interval_seconds)
        except ConfigError as exc:
            log.error("Configuration error: %s — retrying in %ss", exc, backoff_seconds)
            time.sleep(backoff_seconds)
            backoff_seconds = min(max_backoff_seconds, backoff_seconds * 2)
        except Exception as exc:  # noqa: BLE001 — network outages, DNS failures, etc. must not crash the loop
            log.error("Heartbeat cycle failed: %s — retrying in %ss", exc, backoff_seconds)
            time.sleep(backoff_seconds)
            backoff_seconds = min(max_backoff_seconds, backoff_seconds * 2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Office Network Agent")
    sub = parser.add_subparsers(dest="command", required=True)

    p_register = sub.add_parser("register", help="One-time pairing with the attendance server")
    p_register.add_argument("--office-id")
    p_register.add_argument("--agent-id")
    p_register.add_argument("--token")
    p_register.set_defaults(func=cmd_register)

    p_test = sub.add_parser("test", help="Run IP detection + connectivity + auth diagnostics")
    p_test.set_defaults(func=cmd_test)

    p_run = sub.add_parser("run", help="Start the long-running heartbeat loop")
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
