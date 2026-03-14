#!/usr/bin/env python3
"""Local Whisper transcription script for Chat-With-May."""
import sys
import json
import whisper
import warnings

# Suppress FP16 warning on CPU
warnings.filterwarnings("ignore", message="FP16 is not supported on CPU; using FP32 instead")

MODEL_SIZE = "base"  # 可改為 small/medium/large
_model = None

def get_model(model_size="base"):
    global _model
    if _model is None:
        _model = whisper.load_model(model_size)
    return _model

def transcribe(audio_path, model_size="base", language="zh"):
    model = get_model(model_size)
    result = model.transcribe(audio_path, language=language)
    return result["text"]

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_file> [language] [model_size]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "zh"
    model_size = sys.argv[3] if len(sys.argv) > 3 else "base"

    try:
        text = transcribe(audio_path, model_size, language)
        print(json.dumps({"text": text}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
