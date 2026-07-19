#!/usr/bin/env python3
"""Small Gradio-compatible Irodori worker for Termux on Android.

The Go server only needs the named-call POST, its SSE result, and the returned
audio URL.  Keeping this bridge independent from Gradio avoids installing the
full web UI dependency tree on the phone.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import torch
from huggingface_hub import hf_hub_download

from irodori_tts.inference_runtime import (
    InferenceRuntime,
    RuntimeKey,
    SamplingRequest,
    save_wav,
)


HOST = os.environ.get("IRODORI_ANDROID_HOST", "0.0.0.0")
PORT = int(os.environ.get("IRODORI_ANDROID_PORT", "7864"))
CHECKPOINT_REPO = os.environ.get(
    "IRODORI_ANDROID_CHECKPOINT", "Aratako/Irodori-TTS-500M-v3"
)
OUTPUT_DIR = Path(os.environ.get("IRODORI_ANDROID_OUTPUT_DIR", "./outputs"))
MAX_BODY_BYTES = 1024 * 1024
MAX_OUTPUT_FILES = 16


def _optional_float(value: Any) -> float | None:
    text = str(value or "").strip()
    return None if text == "" else float(text)


def _optional_int(value: Any) -> int | None:
    text = str(value or "").strip()
    return None if text == "" else int(text)


def _require(parameters: list[Any], index: int, name: str) -> Any:
    if index >= len(parameters):
        raise ValueError(f"missing generation parameter: {name}")
    return parameters[index]


@dataclass
class EventResult:
    audio_path: Path | None = None
    error: str = ""
    log: str = ""
    timing: str = ""


class PhoneWorker:
    def __init__(self) -> None:
        thread_count = max(1, int(os.environ.get("IRODORI_ANDROID_THREADS", "8")))
        torch.set_num_threads(thread_count)
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            pass

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[android-worker] downloading {CHECKPOINT_REPO}", flush=True)
        checkpoint = hf_hub_download(
            repo_id=CHECKPOINT_REPO,
            filename="model.safetensors",
        )
        started = time.perf_counter()
        self.runtime = InferenceRuntime.from_key(
            RuntimeKey(
                checkpoint=checkpoint,
                model_device="cpu",
                model_precision="fp32",
                codec_device="cpu",
                codec_precision="fp32",
            )
        )
        self.runtime_lock = threading.Lock()
        self.events: dict[str, EventResult] = {}
        self.events_lock = threading.Lock()
        self.started_at = time.time()
        self.active = False
        self.completed = 0
        self.failed = 0
        self.total_seconds = 0.0
        print(
            f"[android-worker] runtime ready in {time.perf_counter() - started:.2f}s "
            f"on {thread_count} CPU threads",
            flush=True,
        )

    def generate(self, parameters: list[Any]) -> EventResult:
        if len(parameters) != 30:
            raise ValueError(f"expected 30 generation parameters, got {len(parameters)}")
        model_device = str(_require(parameters, 1, "model_device"))
        model_precision = str(_require(parameters, 2, "model_precision"))
        codec_device = str(_require(parameters, 3, "codec_device"))
        codec_precision = str(_require(parameters, 4, "codec_precision"))
        if (model_device, model_precision, codec_device, codec_precision) != (
            "cpu",
            "fp32",
            "cpu",
            "fp32",
        ):
            raise ValueError("Android worker only supports cpu/fp32 for model and codec")
        if parameters[6] is not None or parameters[7] is not None or str(parameters[8]).strip():
            raise ValueError("Android worker currently supports no-reference generation only")

        text = str(_require(parameters, 5, "text")).strip()
        if not text:
            raise ValueError("text is required")
        logs: list[str] = []
        started = time.perf_counter()
        with self.runtime_lock:
            self.active = True
            try:
                result = self.runtime.synthesize(
                    SamplingRequest(
                        text=text,
                        no_ref=True,
                        num_steps=int(parameters[9]),
                        num_candidates=int(parameters[10]),
                        seed=_optional_int(parameters[11]),
                        seconds=_optional_float(parameters[12]),
                        duration_scale=float(parameters[13]),
                        t_schedule_mode=str(parameters[14]),
                        sway_coeff=float(parameters[15]),
                        cfg_guidance_mode=str(parameters[16]),
                        cfg_scale_text=float(parameters[17]),
                        cfg_scale_speaker=float(parameters[18]),
                        cfg_scale=_optional_float(parameters[19]),
                        cfg_min_t=float(parameters[20]),
                        cfg_max_t=float(parameters[21]),
                        context_kv_cache=bool(parameters[22]),
                        truncation_factor=_optional_float(parameters[23]),
                        rescale_k=_optional_float(parameters[24]),
                        rescale_sigma=_optional_float(parameters[25]),
                        speaker_kv_scale=_optional_float(parameters[26]),
                        speaker_kv_min_t=_optional_float(parameters[27]),
                        speaker_kv_max_layers=_optional_int(parameters[28]),
                        lora_adapter=str(parameters[29]).strip() or None,
                        decode_mode="sequential",
                        trim_tail=True,
                    ),
                    log_fn=lambda line: logs.append(line),
                )
                output_path = save_wav(
                    OUTPUT_DIR / f"{secrets.token_hex(16)}.wav",
                    result.audio.float(),
                    result.sample_rate,
                )
                elapsed = time.perf_counter() - started
                self.completed += 1
                self.total_seconds += elapsed
                timings = "\n".join(
                    f"{name}: {seconds:.3f}s" for name, seconds in result.stage_timings
                )
                self._prune_outputs()
                return EventResult(
                    audio_path=output_path,
                    log="\n".join(logs),
                    timing=f"total: {elapsed:.3f}s\n{timings}",
                )
            except Exception:
                self.failed += 1
                raise
            finally:
                self.active = False

    def _prune_outputs(self) -> None:
        files = sorted(
            OUTPUT_DIR.glob("*.wav"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for path in files[MAX_OUTPUT_FILES:]:
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def status(self) -> dict[str, Any]:
        average = self.total_seconds / self.completed if self.completed else 0.0
        return {
            "ready": True,
            "device": "cpu",
            "precision": "fp32",
            "active": self.active,
            "completed": self.completed,
            "failed": self.failed,
            "average_seconds": average,
            "uptime_seconds": max(0, int(time.time() - self.started_at)),
        }


WORKER: PhoneWorker


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "NekogoAndroidIrodori/1"

    def do_POST(self) -> None:
        if self.path != "/gradio_api/call/_run_generation":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("invalid request body length")
            payload = json.loads(self.rfile.read(length))
            parameters = payload.get("data")
            if not isinstance(parameters, list):
                raise ValueError("request data must be an array")
            event_id = secrets.token_hex(16)
            try:
                result = WORKER.generate(parameters)
            except Exception as exc:
                result = EventResult(error=f"{type(exc).__name__}: {exc}")
                print(f"[android-worker] generation failed: {result.error}", flush=True)
            with WORKER.events_lock:
                WORKER.events[event_id] = result
                while len(WORKER.events) > 64:
                    oldest_event_id = next(iter(WORKER.events))
                    WORKER.events.pop(oldest_event_id, None)
            self._write_json(HTTPStatus.OK, {"event_id": event_id})
        except Exception as exc:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/healthz"}:
            self._write_json(HTTPStatus.OK, WORKER.status())
            return
        prefix = "/gradio_api/call/_run_generation/"
        if parsed.path.startswith(prefix):
            event_id = parsed.path[len(prefix) :]
            with WORKER.events_lock:
                result = WORKER.events.get(event_id)
            if result is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if result.error:
                data = json.dumps(result.error, ensure_ascii=False)
                self.wfile.write(f"event: error\ndata: {data}\n\n".encode())
                return
            host = self.headers.get("Host", f"127.0.0.1:{PORT}")
            if any(character in host for character in "\r\n/\\"):
                host = f"127.0.0.1:{PORT}"
            audio_url = f"http://{host}/files/{result.audio_path.name}"
            outputs = [
                {"value": {"url": audio_url}},
                result.log,
                result.timing,
            ]
            data = json.dumps(outputs, ensure_ascii=False)
            self.wfile.write(f"event: complete\ndata: {data}\n\n".encode())
            return
        file_prefix = "/files/"
        if parsed.path.startswith(file_prefix):
            name = unquote(parsed.path[len(file_prefix) :])
            if Path(name).name != name or not name.endswith(".wav"):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            path = OUTPUT_DIR / name
            if not path.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with path.open("rb") as audio_file:
                while chunk := audio_file.read(64 * 1024):
                    self.wfile.write(chunk)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _write_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message: str, *args: Any) -> None:
        print(f"[android-worker] {self.address_string()} {message % args}", flush=True)


def main() -> None:
    global WORKER
    WORKER = PhoneWorker()
    server = ThreadingHTTPServer((HOST, PORT), RequestHandler)
    print(f"[android-worker] listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
