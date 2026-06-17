# Security Policy

## Supported Versions

Only the latest minor release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 2.x (latest minor) | ✅ |
| < 2.0 | ❌ |

## Reporting a Vulnerability

Please report vulnerabilities **privately** — do not open a public issue.

- Preferred: open a [GitHub security advisory](https://github.com/oculus-pllx/Flux-public/security/advisories/new)
- The report should include a description, reproduction steps, and affected version.

You will get an acknowledgement within a week. Fixes ship in the next release with
credit unless you prefer otherwise.

## Threat Model

Flux is a **LAN-trusted tool**. Understand what that means before exposing it:

- It stores **SSH and NUT credentials for your machines in its local SQLite
  database** (`flux.db`). Anyone with read access to that file, or admin access
  to the app, effectively holds those credentials. Protect the host and back up
  the database accordingly.
- It performs **privileged remote actions**: shutting machines down over SSH and
  installing packages (NUT client/server, the Flux agent) as root.
- SSH host keys are **pinned on first use** (TOFU). A changed host key blocks
  the connection until an admin resets the pin.
- The web UI authenticates with JWTs; role separation is admin / operator /
  viewer.

### Deployment recommendations

- Run Flux on a trusted network segment; do not expose it directly to the
  internet.
- Put an HTTPS reverse proxy (Caddy, nginx, Traefik) in front of it — the app
  itself serves plain HTTP.
- Use **dedicated SSH identities** for Flux with the narrowest workable
  privileges, rather than sharing your personal root credentials.
- Keep `JWT_SECRET` and `UPDATER_TOKEN` secret; rotate them if a host is
  compromised.
