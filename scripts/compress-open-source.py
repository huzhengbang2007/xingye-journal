"""Create maximum-level lossless source archives and verify their contents."""
import hashlib
import json
import lzma
from pathlib import Path
import tarfile
import zipfile

root = Path(__file__).resolve().parents[1]
latest = json.loads((root / 'outputs/open-source/latest.json').read_text('utf-8'))
source, output = Path(latest['source']), Path(latest['output'])
assert source.is_relative_to(root / 'outputs/open-source') and source.is_dir()
files = [p for p in sorted(source.rglob('*')) if p.is_file() and '.git' not in p.relative_to(source).parts]
manifest = {}
for path in files:
    with path.open('rb') as stream:
        manifest['xingye-journal/' + path.relative_to(source).as_posix()] = hashlib.file_digest(stream, 'sha256').hexdigest()
tar_path = output / 'xingye-journal-source.tar.xz'
zip_path = output / 'xingye-journal-source.zip'
if tar_path.exists() or zip_path.exists():
    raise SystemExit('Refusing to overwrite existing archives')
with tarfile.open(tar_path, 'w:xz', preset=9 | lzma.PRESET_EXTREME) as archive:
    for path in files:
        archive.add(path, arcname='xingye-journal/' + path.relative_to(source).as_posix())
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        archive.write(path, arcname='xingye-journal/' + path.relative_to(source).as_posix())
with tarfile.open(tar_path, 'r:xz') as archive:
    seen = {}
    for item in archive:
        if item.isfile():
            with archive.extractfile(item) as stream:
                seen[item.name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert seen == manifest, 'XZ content verification failed'
with zipfile.ZipFile(zip_path) as archive:
    assert archive.testzip() is None, 'ZIP integrity verification failed'
    assert {name: hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist()} == manifest
checksums = []
for path in (tar_path, zip_path):
    with path.open('rb') as stream:
        checksums.append(f"{hashlib.file_digest(stream, 'sha256').hexdigest()}  {path.name}")
(output / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print(json.dumps(dict(verified=True, files=len(files), sourceBytes=sum(p.stat().st_size for p in files),
                     xzBytes=tar_path.stat().st_size, zipBytes=zip_path.stat().st_size)))
