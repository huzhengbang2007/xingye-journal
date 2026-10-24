"""Losslessly archive retired releases, verifying every file before permitting cleanup."""
import hashlib
import json
import lzma
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
versions = ('2.2.0', '2.3.0', '2.4.0', '2.4.1', '2.5.0')
sources = [root / 'releases' / v for v in versions if (root / 'releases' / v).is_dir()]
archive_dir = root / 'archives'
archive_dir.mkdir(exist_ok=True)
target = archive_dir / 'legacy-releases-2.2-to-2.5.tar.xz'
report = archive_dir / 'legacy-releases-2.2-to-2.5.json'
if target.exists() or report.exists():
    raise SystemExit('Archive already exists; refusing to overwrite.')
manifest = {}
total = 0
for source in sources:
    for path in sorted(source.rglob('*')):
        if path.is_symlink():
            raise SystemExit(f'Symlink requires manual review: {path}')
        if path.is_file():
            name = path.relative_to(root).as_posix()
            manifest[name] = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
            total += path.stat().st_size
if not manifest:
    raise SystemExit('No retired releases to archive.')
print(f'Archiving {len(manifest)} files ({total} bytes) using LZMA2 extreme...', flush=True)
with tarfile.open(target, 'w:xz', preset=9 | lzma.PRESET_EXTREME) as archive:
    for source in sources:
        archive.add(source, arcname=source.relative_to(root).as_posix())
seen = {}
with tarfile.open(target, 'r:xz') as archive:
    for item in archive:
        if item.isfile():
            with archive.extractfile(item) as stream:
                seen[item.name] = hashlib.file_digest(stream, 'sha256').hexdigest()
if seen != manifest:
    raise SystemExit('Archive verification failed; retain all originals.')
for name, digest in manifest.items():
    with (root / name).open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
            raise SystemExit('Source changed during archiving; retain originals.')
result = dict(verified=True, sourceBytes=total, archiveBytes=target.stat().st_size,
              archiveSha256=hashlib.file_digest(target.open('rb'), 'sha256').hexdigest(),
              roots=[str(p) for p in sources], files=manifest)
report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: v for k, v in result.items() if k != 'files'}), flush=True)
