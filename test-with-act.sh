#!/usr/bin/env bash
# Test runner using nektos/act (requires Docker)
# Runs the actual action.yml in a container, simulating GitHub Actions
#
# Prerequisites:
#   - Docker running
#   - act installed: brew install act
#   - Local sfp-pro compose stack running (auto-detected per workspace)
#
# Usage:
#   ./test-with-act.sh <project-path> environment=<name> release-candidates=<domain:name> [options]
#
# Options:
#   sfp-server-url=<url>        Override SFP Server URL (default: auto-detect)
#   sfp-server-token=<token>    Override SFP Server token (default: dev token)
#   repository=<owner/repo>     Repository identifier (default: derived from project path)
#   exclude-packages=<list>     Comma-separated packages to exclude
#   override-packages=<list>    Comma-separated version overrides (pkg=version)
#   dry-run=<true|false>        Run in dry-run mode (default: false)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="${1:-.}"
shift || true

cd "$PROJECT_PATH"
PROJECT_PATH="$(pwd)"

# Check prerequisites
command -v act &>/dev/null || { echo "Error: act not installed. Run: brew install act"; exit 1; }

# Source shared detection script first (loads .env and auto-detects stack)
FLXBL_ACTIONS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$FLXBL_ACTIONS_ROOT/scripts/detect-sfp-stack.sh"

# Defaults (after sourcing, so .env values are available)
ENVIRONMENT=""
RELEASE_CANDIDATES=""
REPOSITORY="$(basename $(dirname $PROJECT_PATH))/$(basename $PROJECT_PATH)"
EXCLUDE_PACKAGES=""
OVERRIDE_PACKAGES=""
DRY_RUN="false"

# Parse arguments (override .env / auto-detected values)
for arg in "$@"; do
  key="${arg%%=*}"
  val="${arg#*=}"
  case "$key" in
    sfp-server-url) SFP_SERVER_URL="$val" ;;
    sfp-server-token) SFP_SERVER_TOKEN="$val" ;;
    environment) ENVIRONMENT="$val" ;;
    release-candidates) RELEASE_CANDIDATES="$val" ;;
    repository) REPOSITORY="$val" ;;
    exclude-packages) EXCLUDE_PACKAGES="$val" ;;
    override-packages) OVERRIDE_PACKAGES="$val" ;;
    dry-run) DRY_RUN="$val" ;;
  esac
done

[[ -z "$ENVIRONMENT" ]] && { echo "Error: environment required"; exit 1; }
[[ -z "$RELEASE_CANDIDATES" ]] && { echo "Error: release-candidates required (format: domain:name or domain1:name1,domain2:name2)"; exit 1; }

# Run detection (uses values from .env or args if set)
detect_sfp_stack || exit 1

# Setup
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR $PROJECT_PATH/.github/actions/release-domains" EXIT

mkdir -p "$PROJECT_PATH/.github/actions"
cp -r "$SCRIPT_DIR" "$PROJECT_PATH/.github/actions/release-domains"

# Build optional inputs
OPTIONAL_INPUTS=""
if [[ -n "$EXCLUDE_PACKAGES" ]]; then
  OPTIONAL_INPUTS="${OPTIONAL_INPUTS}
          exclude-packages: \"$EXCLUDE_PACKAGES\""
fi
if [[ -n "$OVERRIDE_PACKAGES" ]]; then
  OPTIONAL_INPUTS="${OPTIONAL_INPUTS}
          override-packages: \"$OVERRIDE_PACKAGES\""
fi

# Create workflow using local image
cat > "$TEMP_DIR/test.yml" << EOF
name: Test
on: [push]
jobs:
  release:
    runs-on: ubuntu-latest
    container: $CLI_IMAGE
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/release-domains
        with:
          sfp-server-url: \${{ secrets.SFP_SERVER_URL }}
          sfp-server-token: \${{ secrets.SFP_SERVER_TOKEN }}
          environment: "$ENVIRONMENT"
          release-candidates: "$RELEASE_CANDIDATES"
          repository: "$REPOSITORY"
          dry-run: "$DRY_RUN"
          lock: "false"$OPTIONAL_INPUTS
EOF

cat > "$TEMP_DIR/.secrets" << EOF
SFP_SERVER_URL=$SFP_SERVER_URL
SFP_SERVER_TOKEN=$SFP_SERVER_TOKEN
EOF

echo ""
echo "Running with act (Docker)..."
echo "  Image: $CLI_IMAGE"
echo "  Server: $SFP_SERVER_URL"
echo "  Environment: $ENVIRONMENT"
echo "  Release Candidates: $RELEASE_CANDIDATES"
echo "  Dry Run: $DRY_RUN"
if [[ -n "$EXCLUDE_PACKAGES" ]]; then
  echo "  Exclude: $EXCLUDE_PACKAGES"
fi
if [[ -n "$OVERRIDE_PACKAGES" ]]; then
  echo "  Override: $OVERRIDE_PACKAGES"
fi
echo ""
act push -W "$TEMP_DIR/test.yml" --secret-file "$TEMP_DIR/.secrets" --pull=false
