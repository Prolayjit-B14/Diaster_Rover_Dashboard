"""
RescueBOT — WebSocket Connection Manager
Manages all active WebSocket connections and broadcasts detection payloads.
"""
import asyncio
import json
from typing import Any
from fastapi import WebSocket


class ConnectionManager:
    """
    Manages a pool of active WebSocket connections.
    Supports broadcast of JSON payloads to all connected clients.
    """

    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.append(websocket)
        print(f"[WS] Client connected. Total: {len(self._connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self._connections:
            self._connections.remove(websocket)
        print(f"[WS] Client disconnected. Total: {len(self._connections)}")

    async def broadcast(self, data: dict):
        """Sends a JSON payload to all connected clients."""
        if not self._connections:
            return

        message = json.dumps(data)
        dead = []

        for ws in self._connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


# Global singleton — imported by main.py and api/routes.py
ws_manager = ConnectionManager()
