import sys
import os
import json
import argparse
from faster_whisper import WhisperModel

# African linguistic markers for Luganda, Swahili, and Code-switching detection
SWAHILI_MARKERS = {
    'habari', 'asante', 'ndiyo', 'hapana', 'sawa', 'kwanini', 'nini', 'jambo', 
    'karibu', 'mambo', 'rafiki', 'kazi', 'pole', 'haraka', 'leo', 'kesho',
    'sana', 'kidogo', 'tutaonana', 'safari', 'maisha', 'mungu', 'serikali'
}

LUGANDA_MARKERS = {
    'bannange', 'ssebo', 'nnyabo', 'kiki', 'kale', 'ensonga', 'katonda', 'olunaku',
    'omukwano', 'mwebale', 'gwe', 'nze', 'ffe', 'abantu', 'ensi', 'ebintu',
    'olaba', 'wangi', 'gyendi', 'twebale', 'mpozzi', 'naye', 'era'
}

def format_timestamp_vtt(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"

def format_timestamp_srt(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def analyze_african_context(full_text: str):
    words = [w.lower().strip(".,!?:;\"'()[]{}") for w in full_text.split()]
    sw_count = sum(1 for w in words if w in SWAHILI_MARKERS)
    lu_count = sum(1 for w in words if w in LUGANDA_MARKERS)
    
    dialects = []
    if sw_count >= 2:
        dialects.append('Swahili')
    if lu_count >= 2:
        dialects.append('Luganda')
        
    code_switching = False
    if (sw_count > 0 or lu_count > 0) and any(w in {'the', 'and', 'that', 'with', 'you', 'know', 'because', 'like'} for w in words):
        code_switching = True
        
    return {
        'swahili_count': sw_count,
        'luganda_count': lu_count,
        'detected_african_dialects': dialects,
        'is_code_switching': code_switching
    }

def main():
    parser = argparse.ArgumentParser(description="Transcribe audio/video with faster-whisper")
    parser.add_argument("--input", required=True, help="Path to input audio or video file")
    parser.add_argument("--output", required=True, help="Path to output JSON")
    parser.add_argument("--model", default="base", help="Model size: tiny, base, small (default: base)")
    parser.add_argument("--language", default=None, help="Language code or auto-detect")
    
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: input file {args.input} does not exist", file=sys.stderr)
        sys.exit(1)

    print(f"Loading faster-whisper model '{args.model}' (CPU, int8)...", file=sys.stderr)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    print(f"Transcribing {args.input} with word timestamps...", file=sys.stderr)
    segments_gen, info = model.transcribe(
        args.input,
        language=args.language if args.language and args.language != "auto" else None,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=250)
    )

    segments_list = []
    all_text = []
    srt_entries = []
    vtt_entries = ["WEBVTT\n"]
    entry_index = 1

    for s in segments_gen:
        text = s.text.strip()
        all_text.append(text)
        
        words = []
        if s.words:
            for w in s.words:
                words.append({
                    "word": w.word,
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3)
                })

        seg_data = {
            "id": s.id,
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": text,
            "avg_logprob": round(s.avg_logprob, 3),
            "no_speech_prob": round(s.no_speech_prob, 3),
            "words": words
        }
        segments_list.append(seg_data)

        # Build SRT
        srt_entries.append(f"{entry_index}\n{format_timestamp_srt(s.start)} --> {format_timestamp_srt(s.end)}\n{text}\n")
        # Build VTT
        vtt_entries.append(f"{entry_index}\n{format_timestamp_vtt(s.start)} --> {format_timestamp_vtt(s.end)}\n{text}\n")
        entry_index += 1

    full_transcript = " ".join(all_text)
    african_analysis = analyze_african_context(full_transcript)

    result = {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 2),
        "transcript": full_transcript,
        "segment_count": len(segments_list),
        "segments": segments_list,
        "srt": "\n".join(srt_entries),
        "vtt": "\n".join(vtt_entries),
        "african_context": african_analysis
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Transcription complete! Saved to {args.output}", file=sys.stderr)

if __name__ == "__main__":
    main()
