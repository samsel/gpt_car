"""Unit tests for the motor controller Flask application."""

from __future__ import annotations

from typing import Any, Dict

import pytest

import motor_controller


@pytest.fixture()
def client(gpio_state) -> Any:  # type: ignore[override]
    controller = motor_controller.MotorController(
        motor_controller.GPIO,
        motor_controller.PINS,
        sleep=lambda _: None,
    )
    motor_controller.controller = controller
    motor_controller.app.config["TESTING"] = True
    yield motor_controller.app.test_client()
    controller.cleanup()


def _outputs_by_pin(state) -> Dict[int, Any]:
    return dict(state.outputs)


def test_requires_json(client) -> None:
    response = client.post("/command", data="cmd=FORWARD")
    assert response.status_code == 400
    assert response.json == {
        "status": "error",
        "message": "JSON payload required",
    }


def test_unknown_command(client) -> None:
    response = client.post("/command", json={"cmd": "spin"})
    assert response.status_code == 400
    assert response.json["status"] == "error"


@pytest.mark.parametrize(
    "command,expected_pin",
    [
        ("FORWARD", motor_controller.PINS.forward),
        ("BACKWARD", motor_controller.PINS.backward),
    ],
)
def test_drive_commands_toggle_pins(command: str, expected_pin: int, client, gpio_state) -> None:
    response = client.post("/command", json={"cmd": command, "duration": 0.01})
    assert response.status_code == 200
    assert response.json["status"] == "ok"
    high_events = [
        entry for entry in gpio_state.log if entry[2] == motor_controller.GPIO.HIGH
    ]
    assert high_events
    assert high_events[0][1] == expected_pin
    # Final outputs should be LOW for every pin after stopping
    last_values = _outputs_by_pin(gpio_state)
    for pin in motor_controller.PINS.all_pins:
        assert last_values[pin] == motor_controller.GPIO.LOW


@pytest.mark.parametrize(
    "command,expected_pin",
    [
        ("LEFT", motor_controller.PINS.left),
        ("RIGHT", motor_controller.PINS.right),
    ],
)
def test_turn_commands_toggle_pins(command: str, expected_pin: int, client, gpio_state) -> None:
    response = client.post("/command", json={"cmd": command, "duration": 0.01})
    assert response.status_code == 200
    assert response.json["status"] == "ok"
    high_events = [
        entry for entry in gpio_state.log if entry[2] == motor_controller.GPIO.HIGH
    ]
    assert high_events
    assert high_events[0][1] == expected_pin


def test_stop_command_sets_all_pins_low(client, gpio_state) -> None:
    response = client.post("/command", json={"cmd": "STOP"})
    assert response.status_code == 200
    for pin in motor_controller.PINS.all_pins:
        assert gpio_state.outputs[pin] == motor_controller.GPIO.LOW


@pytest.mark.parametrize("invalid", ["abc", -1, 0, float("nan"), float("inf"), 9])
def test_invalid_duration_rejected(invalid: Any, client) -> None:
    response = client.post("/command", json={"cmd": "FORWARD", "duration": invalid})
    assert response.status_code == 400
    assert response.json["status"] == "error"


def test_cleanup_prevents_future_commands(client) -> None:
    motor_controller.controller.cleanup()
    response = client.post("/command", json={"cmd": "FORWARD"})
    assert response.status_code == 503
    assert response.json["status"] == "error"
