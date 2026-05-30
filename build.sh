#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  ZKAEDI VMAX BUILD v2.5 — Hardened Compilation"
echo "============================================================"

# Step 1: Pack HTML assets into C header
echo " -> Packing embedded assets..."
python3 utils/zcc_packer.py zkaedi-master-pipeline.html src/zkaedi_master_pipeline.h zkaedi_master_pipeline

# Step 2: Compile the hardened server (includes security module)
echo " -> Compiling zkaedi_vmax_server..."
gcc \
    src/zcc_server.c \
    src/zcc_utils.c \
    src/zcc_network.c \
    src/zcc_router.c \
    src/zcc_security.c \
    -I src/ \
    -lpthread \
    -o zkaedi_vmax_server

# Step 3: Sync assets
echo " -> Syncing pipeline assets..."
python3 utils/pipeline_sync.py

# Step 4: Generate integrity manifest for security watchdog
echo " -> Generating file integrity manifest..."
python3 -c "
import os, json, hashlib, time
manifest = {}
for d in ['src', 'config']:
    if not os.path.isdir(d): continue
    for f in os.listdir(d):
        fp = os.path.join(d, f)
        if os.path.isfile(fp) and f != 'auth.key':
            h = hashlib.sha256()
            with open(fp, 'rb') as fh:
                for chunk in iter(lambda: fh.read(8192), b''):
                    h.update(chunk)
            manifest[os.path.join(d, f)] = h.hexdigest()
with open('config/integrity_manifest.json', 'w') as f:
    json.dump({'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'files': manifest}, f, indent=2)
print(f'   Manifest: {len(manifest)} files hashed')
"

echo ""
echo "============================================================"
echo "  BUILD COMPLETE: zkaedi_vmax_server"
echo "  Security modules: zcc_security.c (linked)"
echo "  Integrity manifest: config/integrity_manifest.json"
echo "============================================================"
