# Nothing Phone Irodori worker

This directory contains the lightweight Gradio-compatible HTTP bridge used to
run Irodori-TTS inside Termux. It exposes only the API surface consumed by the
Go dictionary-audio server and does not install the Gradio UI on Android.

The worker requires an initialized Termux installation with Python, PyTorch,
Torchaudio, TorchCodec, FFmpeg, the Irodori-TTS source tree, DACVAE, and their
runtime Python dependencies. Copy `bridge.py` next to the `irodori_tts` package,
then start it from that directory:

```sh
HF_HUB_DISABLE_XET=1 TOKENIZERS_PARALLELISM=false python -u bridge.py
```

The default listener is `0.0.0.0:7864`. The health endpoint is `GET /healthz`.
The Go server should use `cpu/fp32` for both the model and codec and should cap
this worker to short text because a phone CPU is much slower than the desktop
workers.

For automatic restart while Termux is running, install `termux-services`, copy
`run` to `$PREFIX/var/service/irodori-android/run`, make it executable, and run
`sv-enable irodori-android`. Android still requires Termux to be allowed to run
in the background; a user force-stop intentionally stops all of its services.
