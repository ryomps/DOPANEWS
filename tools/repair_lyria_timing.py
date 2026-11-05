"""Re-edit a saved Lyria battle from cached word timestamps. No network/API calls.

Run without --apply first to inspect the proposed plan. --apply keeps a backup.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unicodedata
import wave


def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).lower() if c.isalnum())


def align_lines(expected, words, anchor, upper):
    """Monotonic character alignment; timings always come from recognized audio words."""
    observed, times = '', []
    for word in words:
        start, end = word['start'], word['end']
        if start < anchor - .5 or end > upper or end < start or end - start > 5:
            continue
        text = normalize(word['word'])
        observed += text
        for index in range(len(text)):
            times.append((start + (end-start)*index/len(text), start + (end-start)*(index+1)/len(text)))
    chunks = [normalize(line) for line in expected]
    target = ''.join(chunks)
    # Longest common subsequence tolerates Japanese transcription variants and extra music tags.
    matrix = [[0]*(len(observed)+1) for _ in range(len(target)+1)]
    for i, char in enumerate(target, 1):
        for j, heard in enumerate(observed, 1):
            matrix[i][j] = matrix[i-1][j-1]+1 if char == heard else max(matrix[i-1][j], matrix[i][j-1])
    mapping, i, j = {}, len(target), len(observed)
    while i and j:
        if target[i-1] == observed[j-1]:
            mapping[i-1] = j-1
            i -= 1
            j -= 1
        elif matrix[i-1][j] >= matrix[i][j-1]:
            i -= 1
        else:
            j -= 1
    result, offset = [], 0
    for index, chunk in enumerate(chunks):
        matched = [mapping[k] for k in range(offset, offset+len(chunk)) if k in mapping]
        coverage = len(matched)/max(1, len(chunk))
        if coverage < .55 or len(matched) < 3:
            raise ValueError(f'Line {index+1} not reliably recognized: coverage={coverage:.2f}')
        start, end = times[matched[0]][0], times[matched[-1]][1]
        if index == 0:
            start = anchor  # User-confirmed onset stays fixed.
        if end <= start or (result and start < result[-1]['end'] - .1):
            raise ValueError(f'Invalid word timing for line {index+1}')
        if result and start < result[-1]['end']:
            result[-1]['end'] = start
        result.append({'id': index, 'start': round(start, 3), 'end': round(end, 3), 'coverage': round(coverage, 3)})
        offset += len(chunk)
    return result


def repair(root, record_id, ffmpeg, apply=False):
    if not re.fullmatch(r'[a-f0-9]{32}', record_id):
        raise ValueError('Invalid record ID')
    record_file = root/'.local/library'/f'{record_id}.json'
    record = json.loads(record_file.read_text(encoding='utf-8-sig'))
    battle = record['battleData']
    original = battle['lyria_edit']
    sources, transcripts = [], []
    for source in battle['lyria_sources']:
        if not re.fullmatch(r'[a-f0-9]{64}', source['id']):
            raise ValueError('Invalid source ID')
        base = root/'.local/lyria'/source['id']
        pcm = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(base.with_suffix('.mp3')),
                              '-ar', '44100', '-ac', '2', '-f', 's16le', 'pipe:1'], capture_output=True, check=True).stdout
        sources.append(pcm)
        transcripts.append(json.loads(base.with_suffix('.whisper.json').read_text(encoding='utf-8-sig')))
    cursor, cuts, output, timeline, corrected = 0., [], [], [], [[], []]
    for index, old in enumerate(original['cuts']):
        source = index % 2
        old_first = old['from'] + old['lines'][0]['start'] - old['start']
        duration = len(sources[source])/(44100*4)
        upper = duration
        if index < 2:
            following = original['cuts'][index+2]
            upper = min(following['from'] + following['lines'][0]['start'] - following['start'] - .5,
                        old['to'] + 8)
        verse = battle['verses'][index]
        display = verse['lyric'].splitlines()
        readings = verse['lyric_reading'].splitlines()
        aligned = align_lines(display, transcripts[source]['words'], old_first, upper)
        line_offset = len(corrected[source])
        corrected[source].extend(dict(id=line_offset+k, start=line['start'], end=line['end']) for k, line in enumerate(aligned))
        start = old['from']
        end = min(duration, aligned[-1]['end'] + .6)
        if end > upper and index < 2:
            raise ValueError('Verse overlaps the next vocal')
        first, last = round(start*44100), round(end*44100)
        pcm = bytearray(sources[source][first*4:last*4])
        # Preserve original sample rate/pitch. Fade only the 5ms at each outer edge.
        import struct
        count = len(pcm)//4
        fade = min(220, count//2)
        for ch in range(2):
            for k in range(fade):
                for frame in (k, count-1-k):
                    at = frame*4+ch*2
                    value = struct.unpack_from('<h', pcm, at)[0]
                    struct.pack_into('<h', pcm, at, round(value*k/fade))
        output.append(pcm)
        length = count/44100
        local_lines = [{'start': round(cursor+l['start']-start, 6), 'end': round(cursor+l['end']-start, 6)} for l in aligned]
        cut = {'index': index, 'source': source, 'from': start, 'to': end, 'start': cursor, 'end': cursor+length,
               'lines': local_lines, 'alignment_coverage': [l['coverage'] for l in aligned]}
        cuts.append(cut)
        verse['start_time_sec'], verse['end_time_sec'] = cursor, cursor+length
        verse['timed_lines'] = [dict(text=display[k], reading=readings[k], start_sec=l['start'], end_sec=l['end'],
                                     line_indices=[k], verse_index=index) for k, l in enumerate(local_lines)]
        timeline.extend(verse['timed_lines'])
        print(json.dumps({'verse': index+1, 'onset_preserved': old_first, 'old_end': old['to'], 'new_end': end,
                          'lines': aligned}, ensure_ascii=False))
        cursor += length
    battle['lyria_edit'] = {'cuts': cuts, 'duration': cursor, 'source': 'whisper-1-word-alignment', 'onsets_preserved': True}
    battle['part_segments'] = [dict(verseIndex=c['index'], speaker=battle['verses'][c['index']]['speaker'], start=c['start'], end=c['end']) for c in cuts]
    battle['mureka_timeline'] = timeline
    battle['mureka_sync'].update(duration_sec=cursor, timing_source='whisper-1-word-alignment')
    record['synthDuration'] = cursor
    if record.get('murekaTrack'):
        record['murekaTrack'].update(duration=round(cursor*1000), part_segments=battle['part_segments'])
    # Previous audio-review result refers to the old bytes; keep it only in the backup.
    record.get('reviews', {}).pop('audio', None)
    record['editedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps({'duration': cursor, 'apply': apply}))
    if not apply:
        return record
    backup = root/'.local/lyria-repairs'/f'{record_id}-{datetime.datetime.now().strftime("%Y%m%d-%H%M%S")}'
    backup.mkdir(parents=True, exist_ok=False)
    audio_file = root/'.local/library'/f'{record_id}.wav'
    shutil.copy2(record_file, backup/record_file.name)
    shutil.copy2(audio_file, backup/audio_file.name)
    for source in battle['lyria_sources']:
        cached = root/'.local/lyria'/f'{source["id"]}.alignment.json'
        shutil.copy2(cached, backup/cached.name)
    wav_temp = audio_file.with_suffix('.repair.wav')
    with wave.open(str(wav_temp), 'wb') as wav:
        wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(44100)
        for pcm in output:
            wav.writeframes(pcm)
    json_temp = record_file.with_suffix('.repair.json')
    json_temp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    wav_temp.replace(audio_file)
    json_temp.replace(record_file)
    for index, source in enumerate(battle['lyria_sources']):
        cached = root/'.local/lyria'/f'{source["id"]}.alignment.json'
        temporary = cached.with_suffix('.repair.json')
        temporary.write_text(json.dumps({'lines': corrected[index], 'model': 'whisper-1',
                                         'onsets_preserved': True}, indent=2), encoding='utf-8')
        temporary.replace(cached)
    print('Backup: '+str(backup))
    return record


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    repair(Path(__file__).resolve().parents[1], args.record, args.ffmpeg, args.apply)
