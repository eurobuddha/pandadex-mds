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

# The version pill is only the first paint (updateChrome rewrites it), but drift there still ships
# a wrong number to anyone who looks before the service connects.
PILL_VERSION="$(grep -Eo 'id="versionPill"[^>]*>v[0-9][0-9A-Za-z.\-]*' index.html | grep -Eo '[0-9][0-9A-Za-z.\-]*$' | head -1)"
if [ -n "${PILL_VERSION}" ] && [ "${PILL_VERSION}" != "${VERSION}" ]; then
  echo "Version drift: dapp.conf='${VERSION}' but the versionPill in index.html says '${PILL_VERSION}'." >&2
  exit 1
fi

# A broken build must never become a release.
echo "Running tests..."
node test.js

SHIP="index.html style.css fonts.css parity.css inter_var.ttf jetbrains_mono_var.ttf mds.js decimal.js covenant.js signlock.js book.js pool.js composite.js txn.js tape.js maker.js price.js verifier.js pending.js stats.js split.js history.js export.js explorer.js service.js favicon.png"

# Completeness guard. The ship list is hand-maintained, and it has been wrong in both directions:
# sweep.js was shipped long after its last caller went, and pool.js/composite.js were dropped from
# it while still being loaded. Every script the page or the service actually loads must be in the
# zip, and every .js in the zip must be loaded by one of them.
DEPS="$(
  grep -Eo 'src="[^"]+\.js"' index.html | sed -E 's/src="([^"]+)"/\1/'
  grep -Eo 'MDS\.load\("[^"]+\.js"\)' service.js | sed -E 's/MDS\.load\("([^"]+)"\)/\1/'
  echo "service.js"
)"
for dep in $(echo "${DEPS}" | sort -u); do
  case " ${SHIP} " in
    *" ${dep} "*) ;;
    *) echo "ERROR: ${dep} is loaded at runtime but is not in the ship list." >&2; exit 1 ;;
  esac
done
for shipped in ${SHIP}; do
  case "${shipped}" in
    *.js)
      [ "${shipped}" = "service.js" ] && continue
      case "$(echo "${DEPS}" | sort -u | tr '\n' ' ')" in
        *"${shipped}"*) ;;
        *) echo "ERROR: ${shipped} is shipped but nothing loads it — delete it or wire it up." >&2; exit 1 ;;
      esac
      ;;
  esac
done

OUT="PandaDEX_${VERSION}.mds.zip"
[ -e "${OUT}" ] && { echo "ERROR: ${OUT} already exists — bump the version (never overwrite a release)." >&2; exit 1; }

# Step 1: dapp.conf MUST be the first entry.
zip -q "${OUT}" dapp.conf
# Step 2: everything else the dapp ships.
zip -q "${OUT}" ${SHIP}

echo "Archive contents (dapp.conf must be first):"
echo "-------------------------------------------"
unzip -l "${OUT}"
echo "-------------------------------------------"
echo "Built ${OUT}"
