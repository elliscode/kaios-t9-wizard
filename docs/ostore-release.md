# Releasing T9 Wizard to OStore (JScalated Store)

How to ship a new T9 Wizard version to OStore, the homebrew KaiOS 3 store run
from [Garbagebuild/JScalated-Store](https://github.com/Garbagebuild/JScalated-Store).
This is **separate from the KaiStore release**: never upload the OStore ZIP
to KaiStore, and never put `META-INF/` into `frontend-v3/`.

## Background

- OStore installs apps through the phone's own installer, `AppsManager.installPackage`,
  from the update URL listed in its catalogue. For T9 Wizard that's ours:
  `https://t9-wizard.elliscode.com/update.webmanifest`, served from
  [landing/update.webmanifest](../landing/update.webmanifest). KaiOS remembers
  that URL at install time and uses it for every later update check.
- The installer won't take a plain ZIP: it wants `META-INF/` signing files.
  OStore's packages carry **copied** signing files. `manifest.mf` and
  `zigbert.sf` are generated for the app's own files, and `zigbert.rsa` is
  one KaiStore signature block, signed 2025-01-21 for a different app, reused
  for every OStore package with its `messageDigest` field rewritten. The
  RSA signature is **not valid** for our files; it only works on phones whose
  installer checks the format but not the signature. OStore's own docs say so
  ([SOURCES-AND-UPDATES.md](https://github.com/Garbagebuild/JScalated-Store/blob/main/SOURCES-AND-UPDATES.md)).
- That's why the OStore ZIP must never go to KaiStore. The KaiStore upload is
  the plain ZIP from `kaios-release.sh`, and KaiStore signs it properly itself.

### Current state (Season 1, v3.1.10)

`landing/update.webmanifest` points at the package OStore prepared:
`https://github.com/Garbagebuild/JScalated-Store/releases/download/jscalated-apps-1/T9-Wizard-3.1.10.zip`
(118,006 bytes, SHA-256 `689b62c59137059080fb211d6864c0a1d5aad3425cb8896ba640a443048aad50`).
Its 33 app files are byte-identical to our own `v3.1.10` release ZIP; the
only additions are the three `META-INF/` files.

## Releasing a new version (e.g. Season 2)

From Season 2 on, we build the OStore ZIP ourselves and host it on **our own**
GitHub release, so nobody else controls the file behind our update URL.

### 1. Build the plain app ZIP

The same build as the KaiStore release:

```sh
cd frontend-v3
ls META-INF 2>/dev/null && echo "STOP: frontend-v3/META-INF exists -- remove it first"
sh kaios-release.sh          # -> frontend-v3/t9wizard-<timestamp>.zip
```

This plain ZIP is what goes to KaiStore. Before going on, check that
`manifest.webmanifest`'s `version` and `b2g_features.version` are the new
version, e.g. `3.2.9`.

### 2. Make the OStore copy outside the repo

Do all of this in a scratch folder **outside** `frontend-v3/` (e.g. `~/ostore-build/`),
so `kaios-release.sh` can never pick it up.

1. Get the reference `zigbert.rsa` from OStore's 3.1.10 package and check its hash:

   ```sh
   mkdir -p ~/ostore-build && cd ~/ostore-build
   curl -sSL -o ref.zip https://github.com/Garbagebuild/JScalated-Store/releases/download/jscalated-apps-1/T9-Wizard-3.1.10.zip
   unzip -p ref.zip META-INF/zigbert.rsa > ref-zigbert.rsa
   shasum -a 256 ref-zigbert.rsa
   # expect 719f368e60ec56a17328bb6cb6883a091fecb073f4b6905f44eb1697c0b70513
   ```

   If that asset is ever gone, take `META-INF/zigbert.rsa` from any current
   package on their `jscalated-apps-1` release. They all carry the same
   signature block. The script below only needs its `messageDigest` field to
   be findable.

2. Save the script below as `~/ostore-build/add_meta_inf.py` and run it on the
   plain ZIP:

   ```sh
   cp ~/git/kaios-t9-wizard/frontend-v3/t9wizard-<timestamp>.zip plain.zip
   python3 -I add_meta_inf.py plain.zip ref-zigbert.rsa t9-wizard-<version>-ostore.zip
   ```

   It does what OStore's tool does. It was checked against their 3.1.10
   package: run on our plain `v3.1.10` ZIP, it reproduces all three of their
   `META-INF/` files byte-for-byte.

   ```python
   #!/usr/bin/env python3
   """Adds OStore-style META-INF to a KaiOS app ZIP.

   usage: python3 -I add_meta_inf.py <app.zip> <reference-zigbert.rsa> <out.zip>
   """
   import base64
   import hashlib
   import shutil
   import sys
   import zipfile

   app_zip, ref_rsa_path, out_zip = sys.argv[1:4]
   CRLF = '\r\n'


   def b64sha1(data):
       return base64.b64encode(hashlib.sha1(data).digest()).decode()


   with zipfile.ZipFile(app_zip) as z:
       names = z.namelist()
       if any(n.startswith('META-INF/') for n in names):
           sys.exit('input already has META-INF/ -- start from the plain app ZIP')
       mf = 'Manifest-Version: 1.0' + CRLF + CRLF
       for n in names:
           # Folder entries get the SHA-1 of empty content, like the reference.
           data = b'' if n.endswith('/') else z.read(n)
           mf += 'Name: ' + n + CRLF + 'Digest-Algorithms: SHA1' + CRLF + 'SHA1-Digest: ' + b64sha1(data) + CRLF + CRLF
   mf = mf.encode()
   sf = ('Signature-Version: 1.0' + CRLF + 'SHA1-Digest-Manifest: ' + b64sha1(mf) + CRLF + CRLF).encode()

   rsa = open(ref_rsa_path, 'rb').read()
   # The reference block's messageDigest is the SHA-1 of the zigbert.sf it was
   # copied with; find it by its DER encoding (SET of one 20-byte OCTET STRING).
   old = None
   for i in range(len(rsa) - 22):
       if rsa[i] == 0x04 and rsa[i + 1] == 0x14 and rsa[i - 2:i] == b'\x31\x16':
           old = rsa[i + 2:i + 22]
           break
   if old is None or rsa.count(old) != 1:
       sys.exit('could not find a unique messageDigest in the reference zigbert.rsa')
   rsa = rsa.replace(old, hashlib.sha1(sf).digest())

   shutil.copyfile(app_zip, out_zip)
   with zipfile.ZipFile(out_zip, 'a', compression=zipfile.ZIP_DEFLATED) as z:
       z.writestr('META-INF/zigbert.rsa', rsa)
       z.writestr('META-INF/zigbert.sf', sf)
       z.writestr('META-INF/manifest.mf', mf)
   print('wrote', out_zip)
   ```

3. Check the result:

   ```sh
   unzip -l t9-wizard-<version>-ostore.zip | tail -5   # META-INF/zigbert.rsa, .sf, manifest.mf at the end
   unzip -tq t9-wizard-<version>-ostore.zip            # "No errors detected"
   stat -f %z t9-wizard-<version>-ostore.zip           # byte size, for step 4
   shasum -a 256 t9-wizard-<version>-ostore.zip        # for the OStore PR, if they want it
   ```

### 3. Publish the ZIP on our GitHub release

Upload `t9-wizard-<version>-ostore.zip` as an asset on a **new** release tag
(e.g. `v3.2.9`). Don't replace an existing asset at an old URL: phones and
caches may already hold those bytes. Check it downloads publicly, and
compare its size and SHA-256 with step 2.3:

```sh
curl -sSL -o check.zip https://github.com/elliscode/kaios-t9-wizard/releases/download/v<version>/t9-wizard-<version>-ostore.zip
stat -f %z check.zip; shasum -a 256 check.zip
```

### 4. Point the update manifest at it

Edit [landing/update.webmanifest](../landing/update.webmanifest):

- `version` and `b2g_features.version`: the new version, matching the ZIP's
  `manifest.webmanifest` exactly. Installed phones only update when this goes up.
- `package_path`: the exact release asset URL from step 3.
- `packaged_size` and `size`: the ZIP's byte length from step 2.3.
- The rest of `b2g_features` (`origin`, `permissions`, `developer`,
  `dependencies`) has to match the ZIP's `manifest.webmanifest`. Copy any
  changes over, e.g. a new ads SDK version.

Deploy `landing/` so `https://t9-wizard.elliscode.com/update.webmanifest`
serves the new file, then check it:

```sh
curl -sS https://t9-wizard.elliscode.com/update.webmanifest
```

### 5. Tell OStore

If their catalogue entry (`webapps.json` / `Apps-directory/T9-Wizard/`) shows
a version, comment on their repo or PR with the new version, asset URL, size
and SHA-256, so the listing matches. Phones that already installed T9 Wizard
from our update URL pick up the new version on their own.

### 6. Test on a phone

Their docs are clear that acceptance depends on the handset. If you can,
install or update through OStore on a real KaiOS 3 phone before announcing it.

## Don'ts

- Don't upload the `-ostore.zip` to KaiStore, and don't let `META-INF/` into
  `frontend-v3/`, because `kaios-release.sh` zips everything there.
- Don't change `id` (`t9-wizard`) or `b2g_features.origin` (`t9wizard`) in
  `frontend-v3/manifest.webmanifest`. KaiOS treats a different one as a
  different app, and existing installs stop getting updates.
- Don't reuse an old release asset URL for new bytes.
