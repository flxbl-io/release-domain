# Release Domain

Deploy a release candidate to a target Salesforce environment via SFP Server with automatic environment locking.

## Usage

```yaml
- uses: flxbl-io/release-domain@v1
  with:
    sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
    sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
    environment: "staging"
    release-candidate: "main-12345"
    domain: "core"
```

## Features

- **Automatic Environment Locking** - Locks the environment before deployment and automatically unlocks on completion (success or failure)
- **Package Exclusions** - Exclude specific packages from deployment without modifying the release candidate
- **Version Overrides** - Override package versions for hotfixes or rollbacks
- **Dry-Run Mode** - Test the deployment configuration without making changes

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `sfp-server-url` | **Yes** | - | SFP Server URL |
| `sfp-server-token` | **Yes** | - | SFP Server authentication token |
| `environment` | **Yes** | - | Target environment name to deploy to |
| `release-candidate` | **Yes** | - | Name of the release candidate to deploy |
| `domain` | **Yes** | - | Domain (release config name) of the release candidate |
| `repository` | No | `${{ github.repository }}` | Repository identifier (owner/repo) |
| `devhub-alias` | No | `devhub` | Alias for the DevHub org |
| `wait-time` | No | `120` | Wait time in minutes for package installation |
| `tag` | No | - | Tag the release for identification in metrics |
| `exclude-packages` | No | - | Comma-separated list of packages to exclude (e.g., `pkg-a,pkg-b`) |
| `override-packages` | No | - | Comma-separated package version overrides (e.g., `pkg-a=1.2.3,pkg-b=2.0.0`) |
| `lock` | No | `true` | Lock environment before release (auto-unlock on completion) |
| `lock-timeout` | No | `15` | Minutes to wait for lock acquisition (0 = wait indefinitely) |
| `lock-duration` | No | `120` | Duration in minutes to hold the lock |
| `dry-run` | No | `false` | Dry-run mode (no lock, no deploy) |

## Outputs

| Output | Description |
|--------|-------------|
| `deployment-status` | Status of the deployment (`success`/`failed`/`dry-run`) |
| `ticket-id` | Lock ticket ID (if locking was enabled) |

## Example Workflow

```yaml
name: Deploy to Staging

on:
  workflow_dispatch:
    inputs:
      release-candidate:
        description: 'Release candidate name'
        required: true
      domain:
        description: 'Domain to deploy'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    container: ghcr.io/flxbl-io/sfops:latest
    steps:
      - uses: flxbl-io/release-domain@v1
        with:
          sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
          sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
          environment: staging
          release-candidate: ${{ inputs.release-candidate }}
          domain: ${{ inputs.domain }}
```

## Advanced Usage

### Package Exclusions and Overrides

Exclude specific packages or override their versions without modifying the release candidate on the server:

```yaml
- uses: flxbl-io/release-domain@v1
  with:
    sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
    sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
    environment: staging
    release-candidate: ${{ inputs.release-candidate }}
    domain: core
    # Exclude packages that shouldn't be deployed to this environment
    exclude-packages: "experimental-feature,debug-tools"
    # Override specific package versions (e.g., for hotfixes)
    override-packages: "core-utils=1.5.2,auth-module=2.0.1"
```

### Disable Auto-Lock

For scenarios where locking is managed separately:

```yaml
- uses: flxbl-io/release-domain@v1
  with:
    sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
    sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
    environment: staging
    release-candidate: main-12345
    domain: core
    lock: false  # Disable auto-locking
```

### Dry-Run Mode

Test the configuration without making any changes:

```yaml
- uses: flxbl-io/release-domain@v1
  with:
    sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
    sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
    environment: staging
    release-candidate: main-12345
    domain: core
    dry-run: true
```

## How It Works

1. **Locks Environment** - Acquires an exclusive lock on the target environment (if `lock: true`)
2. **Authenticates to DevHub** - Required for unlocked package installations
3. **Authenticates to Target Environment** - Using SFP Server credentials
4. **Prepares Release Definition** - If exclusions/overrides specified, fetches and modifies the release definition
5. **Deploys Release Candidate** - Fetches and installs packages from the release candidate
6. **Auto-Unlocks** - Releases the environment lock on completion (success or failure)

## Related Actions

- [flxbl-io/build-domain](https://github.com/flxbl-io/build-domain) - Build packages and create release candidates
- [flxbl-io/auth-environment-with-lock](https://github.com/flxbl-io/auth-environment-with-lock) - Lock environment for custom workflows
- [flxbl-io/unlock-environment](https://github.com/flxbl-io/unlock-environment) - Unlock environment manually

## License

Proprietary - see [LICENSE](LICENSE)
