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
#   ./test-with-act.sh <project-path> environment=<name> release-candidate=<name> domain=<name> [options]
#
# Options:
#   sfp-server-url=<url>        Override SFP Server URL (default: auto-detect)
#   sfp-server-token=<token>    Override SFP Server token (default: dev token)
#   repository=<owner/repo>     Repository identifier (default: derived from project path)

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
RELEASE_CANDIDATE=""
DOMAIN=""
REPOSITORY="$(basename $(dirname $PROJECT_PATH))/$(basename $PROJECT_PATH)"

# Parse arguments (override .env / auto-detected values)
for arg in "$@"; do
  key="${arg%%=*}"
  val="${arg#*=}"
  case "$key" in
    sfp-server-url) SFP_SERVER_URL="$val" ;;
    sfp-server-token) SFP_SERVER_TOKEN="$val" ;;
    environment) ENVIRONMENT="$val" ;;
    release-candidate) RELEASE_CANDIDATE="$val" ;;
    domain) DOMAIN="$val" ;;
    repository) REPOSITORY="$val" ;;
  esac
done

[[ -z "$ENVIRONMENT" ]] && { echo "Error: environment required"; exit 1; }
[[ -z "$RELEASE_CANDIDATE" ]] && { echo "Error: release-candidate required"; exit 1; }
[[ -z "$DOMAIN" ]] && { echo "Error: domain required"; exit 1; }

# Run detection (uses values from .env or args if set)
detect_sfp_stack || exit 1

# Setup
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR $PROJECT_PATH/.github/actions/release" EXIT

mkdir -p "$PROJECT_PATH/.github/actions"
cp -r "$SCRIPT_DIR" "$PROJECT_PATH/.github/actions/release"

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
      - uses: ./.github/actions/release
        with:
          sfp-server-url: \${{ secrets.SFP_SERVER_URL }}
          sfp-server-token: \${{ secrets.SFP_SERVER_TOKEN }}
          environment: "$ENVIRONMENT"
          release-candidate: "$RELEASE_CANDIDATE"
          domain: "$DOMAIN"
          repository: "$REPOSITORY"
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
echo "  Release Candidate: $RELEASE_CANDIDATE"
echo "  Domain: $DOMAIN"
echo ""
act push -W "$TEMP_DIR/test.yml" --secret-file "$TEMP_DIR/.secrets" --pull=false
