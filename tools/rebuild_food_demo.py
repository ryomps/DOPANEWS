"""Rebuild the split-source demo locally after changing its edit manifest.
Usage: python tools/rebuild_food_demo.py --sources <folder> --ffmpeg <executable>
No generation APIs or uploads. Existing source files are read-only.
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path


def rebuild(sources, ffmpeg, demo="food"):
    root = Path(__file__).resolve().parents[1]
    stem = 'food-boundary' if demo == 'food' else 'voice-no-yukue'
    manifest_path = root / 'media/demos' / (stem + '-edit.json')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    js_path = root / 'js/fixed-demo.js'
    text = js_path.read_text(encoding='utf-8')
    marker = 'window.DOPANEWS.FOOD_DEMO = ' if demo == 'food' else 'D.FIXED_DEMO = '
    prefix, encoded = text.split(marker, 1)
    record, consumed = json.JSONDecoder().raw_decode(encoded)
    suffix = encoded[consumed:]
    rate, channels, sample_bytes = 44100, 2, 2
    decoded = {}
    for edit in manifest['edits']:
        name = edit['source']
        if name not in decoded:
            source = sources / name
            result = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(source), '-map', '0:a:0',
                '-f', 's16le', '-ac', str(channels), '-ar', str(rate), 'pipe:1'],
                capture_output=True, check=True)
            decoded[name] = result.stdout
    pcm_parts = []
    segments = []
    position = 0
    for index, edit in enumerate(manifest['edits']):
        start, end = edit['source_start'], edit['source_end']
        first, last = round(start * rate), round(end * rate)
        if not 0 <= first < last <= len(decoded[edit['source']]) // (channels * sample_bytes):
            raise ValueError('Invalid source bounds: ' + edit['source'])
        clip = bytearray(decoded[edit['source']][first * channels * sample_bytes:last * channels * sample_bytes])
        # Short fades prevent sample discontinuities without changing timing or pitch.
        samples = memoryview(clip).cast('h')
        fade = round(manifest.get('fade_seconds', .005) * rate)
        for i in range(fade):
            gain = i / max(1, fade - 1)
            for channel in range(channels):
                a, b = i * channels + channel, (last-first-1-i) * channels + channel
                samples[a] = round(samples[a] * gain)
                samples[b] = round(samples[b] * gain)
        pcm_parts.append(clip)
        duration = (last-first) / rate
        verse = record['battleData']['verses'][index]
        # Keep per-line offsets while moving the entire verse to its new output position.
        previous = verse['start_time_sec']
        previous_offset = verse.get('lyric_display_offset_sec', 0)
        display_offset = edit.get('lyric_display_offset_sec', 0)
        shift = display_offset - previous_offset
        for line in verse['timed_lines']:
            line['start_sec'] = round(position + line['start_sec'] - previous + shift, 3)
            line['end_sec'] = round(position + line['end_sec'] - previous + shift, 3)
        verse['lyric_display_offset_sec'] = display_offset
        verse['start_time_sec'] = round(position, 3)
        verse['end_time_sec'] = round(position + duration, 3)
        segments.append({'start': verse['start_time_sec'], 'end': verse['end_time_sec']})
        edit['output_start'], edit['output_end'] = verse['start_time_sec'], verse['end_time_sec']
        position += duration
    output = root / 'media/demos' / (stem + '.mp3')
    # Encode to a separate file so a failed encode leaves the current demo intact.
    with tempfile.TemporaryDirectory(prefix='dopanews-edit-') as temp:
        candidate = Path(temp) / 'demo.mp3'
        subprocess.run([str(ffmpeg), '-v', 'error', '-y', '-f', 's16le', '-ar', str(rate), '-ac', str(channels),
            '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '192k', str(candidate)],
            input=b''.join(pcm_parts), capture_output=True, check=True)
        output.write_bytes(candidate.read_bytes())
    record['synthDuration'] = round(position, 3)
    record['battleData']['part_segments'] = segments
    js_path.write_text(prefix + marker + json.dumps(record, ensure_ascii=False, indent=2) + suffix, encoding='utf-8')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Rebuilt demo:', round(position, 3), 'seconds')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--demo', choices=['food', 'voice'], default='food')
    args = parser.parse_args()
    rebuild(args.sources, args.ffmpeg, args.demo)
