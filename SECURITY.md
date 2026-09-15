# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose user data, execute code, abuse a local connector, or compromise the hosted application.

Report it privately to `eduardoafonso1089@gmail.com` with the affected component, reproduction steps, likely impact, and any suggested mitigation.

You should receive an acknowledgement within seven days. After a fix is available, the project may publish a concise advisory and credit the reporter, unless anonymity is requested.

## Supported version

Until stable releases begin, security fixes are applied to the latest revision of the default branch only.

## Local connectors

The SAM and COG helpers listen on loopback by default. Their browser access is limited to `https://poligome.com`, `https://www.poligome.com`, and local development origins. A self-hosted instance can set `POLIGOME_ALLOWED_ORIGIN_REGEX` to an anchored regular expression matching its own trusted origins.

Do not expose connector ports to a public network. Do not configure a permissive origin such as `.*` on a machine that handles sensitive data.

