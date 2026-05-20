#!/usr/bin/env python3
"""
munit_sniffer.py
================
Monitors outbound TCP connections made by a Maven/MUnit JVM process
and all its children. No admin rights. No raw sockets. No JVM agents.
Uses psutil to poll the Windows TCP connection table.

Usage (called by MunitAudit.ps1 per project):
    python munit_sniffer.py --pid <maven_pid> --project <name> --out <log_dir>

The script exits automatically when the watched PID exits.
"""

import argparse
import json
import os
import socket
import time
from datetime import datetime
from pathlib import Path

import psutil

# ── Well-known port → connector mapping ──────────────────────────────────────
# These are the default ports for every connector in your enterprise stack.
# A connection to these ports during MUnit = real outbound call = mock leak.
PORT_MAP = {
    80:    "HTTP",
    443:   "HTTPS",
    8080:  "HTTP",
    8443:  "HTTPS",
    8081:  "HTTP-MULE",
    1433:  "DATABASE-SQLSERVER",
    1521:  "DATABASE-ORACLE",
    3306:  "DATABASE-MYSQL",
    5432:  "DATABASE-POSTGRES",
    1527:  "DATABASE-DERBY",
    61616: "ACTIVEMQ",
    61617: "ACTIVEMQ-SSL",
    5671:  "AMQP-SSL",
    5672:  "AMQP",
    9092:  "KAFKA",
    22:    "SFTP-SSH",
    21:    "FTP",
    25:    "SMTP",
    465:   "SMTP-SSL",
    587:   "SMTP-TLS",
    993:   "IMAP-SSL",
    143:   "IMAP",
    3299:  "SAP-JCO",
    3300:  "SAP-JCO",
    3301:  "SAP-JCO",
    33xx:  "SAP-JCO",
    4800:  "SNOWFLAKE",
    443:   "SALESFORCE-WSC",   # Salesforce goes over 443
}

# Ports to IGNORE — these are internal Mule runtime ports, not real outbound
IGNORE_PORTS = {
    9000, 9001, 9002, 9003, 9004, 9005,  # Mule HTTP listener ports
    5701, 5702, 5703,                      # Hazelcast clustering
    4445, 4446,                            # JBoss remoting
    9091,                                  # Byteman listener (if any)
}

# IPs to IGNORE — loopback and local only
IGNORE_IPS = {
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "localhost",
}


def resolve_hostname(ip: str) -> str:
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return ip


def get_all_child_pids(parent_pid: int) -> set[int]:
    """Returns the parent PID plus all descendant PIDs."""
    pids = {parent_pid}
    try:
        parent = psutil.Process(parent_pid)
        for child in parent.children(recursive=True):
            pids.add(child.pid)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
    return pids


def get_connections_for_pids(pids: set[int]) -> list[dict]:
    """Returns all ESTABLISHED outbound TCP connections for the given PIDs."""
    connections = []
    for pid in pids:
        try:
            proc = psutil.Process(pid)
            for conn in proc.net_connections(kind="tcp"):
                if conn.status == "ESTABLISHED" and conn.raddr:
                    remote_ip   = conn.raddr.ip
                    remote_port = conn.raddr.port
                    if remote_ip in IGNORE_IPS:
                        continue
                    if remote_port in IGNORE_PORTS:
                        continue
                    # Skip connections to dynamic/mule ports in the range
                    # that are Mule-internal (ephemeral outbound > 49152 that
                    # connect back to localhost — these are internal)
                    if remote_port > 49152 and remote_ip in IGNORE_IPS:
                        continue
                    connections.append({
                        "pid":         pid,
                        "local_port":  conn.laddr.port,
                        "remote_ip":   remote_ip,
                        "remote_port": remote_port,
                        "hostname":    resolve_hostname(remote_ip),
                    })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return connections


def classify_connection(conn: dict) -> str:
    """Maps a connection to a connector name based on port and hostname."""
    port     = conn["remote_port"]
    hostname = conn["hostname"].lower()

    # Hostname-based classification takes priority
    if "salesforce" in hostname or "force.com" in hostname:
        return "SALESFORCE"
    if "snowflake" in hostname or "snowflakecomputing" in hostname:
        return "SNOWFLAKE"
    if "amazonaws" in hostname or "activemq" in hostname:
        return "ACTIVEMQ-CLOUD"
    if "servicebus" in hostname or "azure" in hostname:
        return "AZURE-SERVICEBUS"
    if "sap" in hostname:
        return "SAP"
    if "smtp" in hostname or "mail" in hostname:
        return "EMAIL-SMTP"

    # Port-based classification
    return PORT_MAP.get(port, f"UNKNOWN-PORT-{port}")


def watch(maven_pid: int, project_name: str, out_dir: Path, poll_interval: float = 0.5):
    """
    Main watch loop. Polls connections every poll_interval seconds.
    Exits when the maven PID is gone.
    Writes a JSON report to out_dir/project_name_leaks.json.
    """
    print(f"[sniffer] Watching PID {maven_pid} for project: {project_name}")
    print(f"[sniffer] Output: {out_dir}")

    seen_connections: set[tuple] = set()
    leaks: list[dict] = []
    start_time = datetime.now()

    while True:
        # Check if maven process is still alive
        if not psutil.pid_exists(maven_pid):
            print(f"[sniffer] PID {maven_pid} exited. Wrapping up.")
            break

        # Get all JVM child processes (Surefire forks child JVMs)
        all_pids = get_all_child_pids(maven_pid)

        # Poll connections
        for conn in get_connections_for_pids(all_pids):
            key = (conn["remote_ip"], conn["remote_port"])
            if key not in seen_connections:
                seen_connections.add(key)
                connector   = classify_connection(conn)
                timestamp   = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                leak_entry  = {
                    "project":    project_name,
                    "timestamp":  timestamp,
                    "connector":  connector,
                    "remote_ip":  conn["remote_ip"],
                    "remote_port": conn["remote_port"],
                    "hostname":   conn["hostname"],
                    "pid":        conn["pid"],
                }
                leaks.append(leak_entry)
                print(
                    f"[sniffer][LEAK] {timestamp} "
                    f"CONNECTOR={connector} "
                    f"-> {conn['hostname']}:{conn['remote_port']} "
                    f"(PID {conn['pid']})"
                )

        time.sleep(poll_interval)

    # Write JSON report
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "project":    project_name,
        "start_time": start_time.isoformat(),
        "end_time":   datetime.now().isoformat(),
        "leak_count": len(leaks),
        "leaks":      leaks,
    }
    out_file = out_dir / f"{project_name}_leaks.json"
    out_file.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"[sniffer] Report written: {out_file}")
    print(f"[sniffer] Total leaks detected: {len(leaks)}")


def main():
    parser = argparse.ArgumentParser(description="MUnit outbound connection sniffer")
    parser.add_argument("--pid",     required=True, type=int,  help="PID of the mvn process")
    parser.add_argument("--project", required=True, type=str,  help="Project name")
    parser.add_argument("--out",     required=True, type=str,  help="Output directory for JSON report")
    parser.add_argument("--interval",default=0.5,  type=float, help="Poll interval in seconds (default 0.5)")
    args = parser.parse_args()

    watch(
        maven_pid    = args.pid,
        project_name = args.project,
        out_dir      = Path(args.out),
        poll_interval= args.interval,
    )


if __name__ == "__main__":
    main()
