# Release Action

Deploy a release candidate to a target Salesforce environment via SFP Server.

## Usage

```yaml
- uses: flxbl-io/release@v1
  with:
    sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
    sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
    environment: "staging"
    release-candidate: "main-12345"
    domain: "core"
```

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

## Outputs

| Output | Description |
|--------|-------------|
| `deployment-status` | Status of the deployment (`success`/`failed`) |

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
      - uses: flxbl-io/release@v1
        with:
          sfp-server-url: ${{ secrets.SFP_SERVER_URL }}
          sfp-server-token: ${{ secrets.SFP_SERVER_TOKEN }}
          environment: staging
          release-candidate: ${{ inputs.release-candidate }}
          domain: ${{ inputs.domain }}
```

## How It Works

1. **Authenticates to DevHub** - Required for unlocked package installations
2. **Authenticates to target environment** - Using SFP Server credentials
3. **Deploys release candidate** - Fetches and installs packages from the release candidate

## Related Actions

- [flxbl-io/build](https://github.com/flxbl-io/build) - Build packages and create release candidates
- [flxbl-io/lock-environment](https://github.com/flxbl-io/lock-environment) - Lock environment before deployment
- [flxbl-io/unlock-environment](https://github.com/flxbl-io/unlock-environment) - Unlock environment after deployment

## License

Proprietary - see [LICENSE](LICENSE)
