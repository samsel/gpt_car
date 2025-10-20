"""Flask application for controlling a toy car via Raspberry Pi GPIO pins."""

from __future__ import annotations

import math
import signal
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Tuple

from flask import Flask, jsonify, request

import RPi.GPIO as GPIO


DEFAULT_DRIVE_DURATION = 2.0
DEFAULT_TURN_DURATION = 1.0
MAX_DURATION = 5.0


@dataclass(frozen=True)
class MotorPins:
    """Pin layout for the drive and steering motors."""

    forward: int
    backward: int
    left: int
    right: int

    @property
    def all_pins(self) -> Tuple[int, int, int, int]:
        return self.forward, self.backward, self.left, self.right


class MotorControllerError(Exception):
    """Exception raised when a command cannot be executed."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class MotorController:
    """Encapsulates GPIO operations for the toy car."""

    def __init__(
        self,
        gpio_module: Any,
        pins: MotorPins,
        *,
        sleep: Callable[[float], None] = time.sleep,
        drive_duration: float = DEFAULT_DRIVE_DURATION,
        turn_duration: float = DEFAULT_TURN_DURATION,
        max_duration: float = MAX_DURATION,
    ) -> None:
        self._gpio = gpio_module
        self._pins = pins
        self._sleep = sleep
        self._drive_duration = drive_duration
        self._turn_duration = turn_duration
        self._max_duration = max_duration
        self._lock = threading.Lock()
        self._cleaned = False

        self._gpio.setwarnings(False)
        self._gpio.setmode(self._gpio.BCM)
        for pin in pins.all_pins:
            self._gpio.setup(pin, self._gpio.OUT)
            self._gpio.output(pin, self._gpio.LOW)

    def cleanup(self) -> None:
        """Stop all motors and release GPIO resources."""

        with self._lock:
            if self._cleaned:
                return
            self._stop_locked()
            self._gpio.cleanup()
            self._cleaned = True

    def stop(self) -> Dict[str, Any]:
        """Stop every motor immediately."""

        with self._lock:
            self._ensure_active()
            self._stop_locked()
        return {"message": "Motors stopped"}

    def execute(self, command: str, *, duration: Any | None = None) -> Dict[str, Any]:
        """Execute a command if possible."""

        normalized = command.strip().upper()
        if not normalized:
            raise MotorControllerError("Command is required")

        if normalized == "STOP":
            return self.stop()

        if normalized in {"FORWARD", "BACKWARD"}:
            pins = self._select_drive_pins(normalized)
            actual_duration = self._run_with_duration(
                pins,
                duration,
                self._drive_duration,
            )
            return {
                "message": f"Moving {normalized.lower()}",
                "duration": actual_duration,
            }

        if normalized in {"LEFT", "RIGHT"}:
            pins = self._select_turn_pins(normalized)
            actual_duration = self._run_with_duration(
                pins,
                duration,
                self._turn_duration,
            )
            return {
                "message": f"Turning {normalized.lower()}",
                "duration": actual_duration,
            }

        raise MotorControllerError("Unknown command")

    def _ensure_active(self) -> None:
        if self._cleaned:
            raise MotorControllerError("Controller is shut down", status_code=503)

    def _select_drive_pins(self, command: str) -> Tuple[int, int]:
        if command == "FORWARD":
            return self._pins.forward, self._pins.backward
        return self._pins.backward, self._pins.forward

    def _select_turn_pins(self, command: str) -> Tuple[int, int]:
        if command == "LEFT":
            return self._pins.left, self._pins.right
        return self._pins.right, self._pins.left

    def _run_with_duration(
        self,
        pins: Tuple[int, int],
        requested_duration: Any,
        default_duration: float,
    ) -> float:
        duration = self._normalize_duration(requested_duration, default_duration)
        with self._lock:
            self._ensure_active()
            forward_pin, backward_pin = pins
            self._gpio.output(forward_pin, self._gpio.HIGH)
            self._gpio.output(backward_pin, self._gpio.LOW)
            self._sleep(duration)
            self._stop_locked()
        return duration

    def _stop_locked(self) -> None:
        for pin in self._pins.all_pins:
            self._gpio.output(pin, self._gpio.LOW)

    def _normalize_duration(self, requested: Any, default: float) -> float:
        if requested is None:
            return default
        try:
            value = float(requested)
        except (TypeError, ValueError):
            raise MotorControllerError("Duration must be a number") from None
        if not math.isfinite(value):
            raise MotorControllerError("Duration must be finite")
        if value <= 0:
            raise MotorControllerError("Duration must be positive")
        if value > self._max_duration:
            raise MotorControllerError(
                f"Duration must be <= {self._max_duration} seconds"
            )
        return value


app = Flask(__name__)

PINS = MotorPins(forward=17, backward=27, left=22, right=23)
controller = MotorController(GPIO, PINS)


@app.post("/command")
def command() -> Any:
    if not request.is_json:
        return jsonify({"status": "error", "message": "JSON payload required"}), 400

    data = request.get_json(silent=True) or {}
    cmd = data.get("cmd", "")
    duration = data.get("duration")

    try:
        result = controller.execute(cmd, duration=duration)
    except MotorControllerError as exc:
        return jsonify({"status": "error", "message": str(exc)}), exc.status_code

    payload = {"status": "ok", **result}
    return jsonify(payload)


def cleanup_and_exit(signum: int | None = None, frame: Any | None = None) -> None:
    """Signal handler that cleans up GPIO and terminates the process."""

    if signum is not None:
        print(f"Received signal {signum}, shutting down...")
    controller.cleanup()
    sys.exit(0)


def register_signal_handlers() -> None:
    signal.signal(signal.SIGINT, cleanup_and_exit)
    signal.signal(signal.SIGTERM, cleanup_and_exit)


if __name__ == "__main__":
    print("Motor control server starting on port 5000...")
    register_signal_handlers()
    try:
        app.run(host="0.0.0.0", port=5000, use_reloader=False)
    finally:
        controller.cleanup()
