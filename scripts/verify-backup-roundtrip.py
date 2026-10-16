#!/usr/bin/env python3
"""Compare two synthetic acceptance ZIPs, including photo bytes; never print records."""
import hashlib
import json
import sys
import zipfile


def read(path):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'ZIP CRC mismatch'
        manifest = json.loads(archive.read('manifest.json'))
        photos = {name[7:]: hashlib.sha256(archive.read(name)).hexdigest()
                  for name in archive.namelist() if name.startswith('photos/')}
    tables = manifest['tables']
    for table in ('meals', 'items'):
        for row in tables[table]:
            if row['photo'] is not None:
                row['photo'] = photos[row['photo']]
    for row in tables['drafts']:
        for name, digest in photos.items():
            row['payload'] = row['payload'].replace(name, digest)
    for rows in tables.values():
        rows.sort(key=lambda row: json.dumps(row, sort_keys=True))
    return tables, sorted(photos.values())


before, before_photos = read(sys.argv[1])
after, after_photos = read(sys.argv[2])
assert before_photos == after_photos, 'Photo SHA-256 mismatch'
# Restore deliberately disables OS schedules without changing the chosen time.
original = next((r for r in before['settings'] if r['key'] == 'reminder'), None)
restored = next(r for r in after['settings'] if r['key'] == 'reminder')
expected_time = json.loads(original['value'])['time'] if original else '21:30'
assert json.loads(restored['value']) == {'enabled': False, 'time': expected_time, 'notificationId': None}
if original:
    original['value'] = restored['value']
else:
    before['settings'].append(restored)
    before['settings'].sort(key=lambda row: json.dumps(row, sort_keys=True))
for table in before:
    assert before[table] == after[table], 'Record mismatch in ' + table
print(json.dumps({'status': 'PASS', 'tables': len(before), 'rows': sum(map(len, before.values())), 'photos': len(before_photos)}, ensure_ascii=False))
