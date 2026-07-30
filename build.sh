#!/usr/bin/env bash
#
# Builds PandaDEX_<version>.mds.zip with dapp.conf as the LITERAL FIRST entry.
# (MDS install silently fails if dapp.conf is not first — per the utxoWallet/staticMLS feedback.)
# Every build keeps its own versioned artifact — never overwrite a released version.
#
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(grep -Eo '"version"[[:space:]]*:[[:space:]]*"[^"]+"' dapp.conf | grep -Eo '[0-9][0-9A-Za-z.\-]*' | head -1)"
[ -z "${VERSION}" ] && { echo "Could not extract version from dapp.conf" >&2; exit 1; }

# Version-drift guard: index.html must carry `var PANDADEX_VERSION = "<dapp.conf version>"`.
HTML_VERSION="$(grep -Eo 'PANDADEX_VERSION[[:space:]]*=[[:space:]]*"[^"]+"' index.html | grep -Eo '[0-9][0-9A-Za-z.\-]*' | head -1)"
if [ "${HTML_VERSION}" != "${VERSION}" ]; then
  echo "Version drift: dapp.conf='${VERSION}' but index.html PANDADEX_VERSION='${HTML_VERSION}'. Update BOTH." >&2
  exit 1
fi

OUT="PandaDEX_${VERSION}.mds.zip"
[ -e "${OUT}" ] && { echo "ERROR: ${OUT} already exists — bump the version (never overwrite a release)." >&2; exit 1; }

# Step 1: dapp.conf MUST be the first entry.
zip -q "${OUT}" dapp.conf
# Step 2: everything else the dapp ships.
zip -q "${OUT}" index.html style.css mds.js decimal.js covenant.js book.js sweep.js txn.js tape.js service.js favicon.png

echo "Archive contents (dapp.conf must be first):"
echo "-------------------------------------------"
unzip -l "${OUT}"
echo "-------------------------------------------"
echo "Built ${OUT}"
