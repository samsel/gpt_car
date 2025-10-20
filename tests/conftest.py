"""Shared fixtures and compatibility stubs for tests."""

from __future__ import annotations

import pathlib
import sys
import types
from typing import Any, Dict, Optional

import pytest


# Ensure the project root is importable.
ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# --------------------------------------------------------------------------------------
# GPIO stub
# --------------------------------------------------------------------------------------


class _GPIOState:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.mode = None
        self.warnings_disabled = False
        self.setup_calls: Dict[int, Any] = {}
        self.outputs: Dict[int, Any] = {}
        self.cleaned = False
        self.log: list[tuple[str, int, Any]] = []


_state = _GPIOState()


def _setwarnings(flag: bool) -> None:
    _state.warnings_disabled = not flag


def _setmode(mode: Any) -> None:
    _state.mode = mode


def _setup(pin: int, mode: Any) -> None:
    _state.setup_calls[pin] = mode


def _output(pin: int, value: Any) -> None:
    _state.outputs[pin] = value
    _state.log.append(("output", pin, value))


def _cleanup() -> None:
    _state.cleaned = True


fake_gpio = types.ModuleType("RPi.GPIO")
fake_gpio.BCM = 11
fake_gpio.OUT = 0
fake_gpio.HIGH = 1
fake_gpio.LOW = 0
fake_gpio.setwarnings = _setwarnings
fake_gpio.setmode = _setmode
fake_gpio.setup = _setup
fake_gpio.output = _output
fake_gpio.cleanup = _cleanup


_rpi_module = types.ModuleType("RPi")
_rpi_module.GPIO = fake_gpio
sys.modules.setdefault("RPi", _rpi_module)
sys.modules.setdefault("RPi.GPIO", fake_gpio)


@pytest.fixture(autouse=True)
def _install_gpio_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    """Install the GPIO stub before each test and reset its state."""

    _state.reset()
    monkeypatch.setitem(sys.modules, "RPi", _rpi_module)
    monkeypatch.setitem(sys.modules, "RPi.GPIO", fake_gpio)


@pytest.fixture()
def gpio_state() -> _GPIOState:
    return _state


# --------------------------------------------------------------------------------------
# Minimal Flask stub sufficient for unit tests
# --------------------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload: Any, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    @property
    def json(self) -> Any:
        return self._payload


class _FakeRequest:
    def __init__(self) -> None:
        self.is_json = False
        self._json_data: Optional[Any] = None
        self._raw_data: Optional[Any] = None

    def _set(self, json_data: Optional[Any], raw_data: Optional[Any]) -> None:
        self.is_json = json_data is not None
        self._json_data = json_data
        self._raw_data = raw_data

    def _clear(self) -> None:
        self.is_json = False
        self._json_data = None
        self._raw_data = None

    def get_json(self, silent: bool = False) -> Any:
        if self.is_json:
            return self._json_data
        if silent:
            return None
        raise ValueError("Request does not contain JSON data")


_request = _FakeRequest()


class _FakeFlask:
    def __init__(self, import_name: str) -> None:
        self.import_name = import_name
        self.config: Dict[str, Any] = {}
        self._routes: Dict[tuple[str, str], Any] = {}

    def post(self, route: str) -> Any:
        return self._register("POST", route)

    def route(self, route: str, methods: Optional[list[str]] = None) -> Any:
        methods = methods or ["GET"]
        decorators = [self._register(method.upper(), route) for method in methods]

        def decorator(func: Any) -> Any:
            for register in decorators:
                register(func)
            return func

        return decorator

    def _register(self, method: str, route: str) -> Any:
        def decorator(func: Any) -> Any:
            self._routes[(method, route)] = func
            return func

        return decorator

    def test_client(self) -> Any:
        flask_app = self

        class _Client:
            def post(self, route: str, json: Any = None, data: Any = None) -> _FakeResponse:
                handler = flask_app._routes.get(("POST", route))
                if handler is None:
                    raise ValueError(f"No POST handler registered for {route}")
                _request._set(json, data)
                result = handler()
                response = _coerce_response(result)
                _request._clear()
                return response

        return _Client()

    def run(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover - not used in tests
        raise RuntimeError("Running the development server is not supported in tests")


def _coerce_response(result: Any) -> _FakeResponse:
    if isinstance(result, tuple):
        response = _coerce_response(result[0])
        if len(result) > 1:
            response.status_code = result[1]
        return response
    if isinstance(result, _FakeResponse):
        return result
    return _FakeResponse(result)


def _jsonify(payload: Any) -> _FakeResponse:
    return _FakeResponse(payload)


fake_flask = types.ModuleType("flask")
fake_flask.Flask = _FakeFlask
fake_flask.jsonify = _jsonify
fake_flask.request = _request
sys.modules.setdefault("flask", fake_flask)
