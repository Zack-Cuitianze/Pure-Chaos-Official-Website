# Security Policy

**Project:** Pure Chaos — official website (static, client-side)
**Document version:** 1.0
**Last updated:** 2026-10-24

This policy explains which versions receive security fixes, how to report a
vulnerability, what is in scope, and the rules for good-faith security research.

## 1. Supported versions

This is a single-version static website. There are no long-term support branches
at the moment: fixes land on `main` and are deployed from there.

| Version | Supported |
| --- | --- |
| `main` (current) | ✅ actively maintained |
| Older tags, commits and forks | ❌ best effort only |

## 2. Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately:

1. **GitHub Security Advisories** (preferred) — repository → **Security** →
   **Advisories** → **Report a vulnerability**. This keeps the report private
   until a fix is published.
2. **Email** — `cuitianze0123@163.com` with subject `[SECURITY] Pure Chaos website`.

A useful report includes:

- the affected page, file or feature (URL or path);
- steps to reproduce;
- a proof of concept (screenshot, request, payload);
- the impact you believe it has;
- a suggested fix, if you have one;
- whether you want public credit.

## 3. What to expect

These are best-effort targets, not guarantees:

| Stage | Target |
| --- | --- |
| Acknowledgement of the report | within ~3 working days |
| Initial assessment | within ~7 working days |
| Fix or mitigation | as soon as practical, depending on severity |
| Credit | offered in the advisory or release notes if you wish |

We may ask for more information, and we may decline reports that are out of
scope. We will keep you informed while a valid report is being handled.

## 4. Scope

### In scope

- website pages, HTML, CSS and JavaScript in this repository;
- in-browser game code and client-side logic;
- cross-site scripting (XSS), HTML/script injection through any input;
- exposed secrets, tokens or credentials in the repository or its history;
- authentication / authorization problems in the project's own tooling or
  repository configuration;
- supply-chain issues introduced by included third-party code or assets;
- issues in the deployed site caused by this repository's code or settings.

### Out of scope

- third-party services and platforms (GitHub, Unsplash, font authors, hosting
  providers, browsers);
- denial-of-service, traffic flooding or resource exhaustion against the site;
- social engineering, phishing, physical access or malware;
- problems that only exist in modified copies or forks of this repository;
- outdated browsers with known, unfixed issues;
- generic scanner output or spam without a demonstrated, reproducible impact.

## 5. Safe harbour

We support good-faith security research. If you:

- act in good faith and within this policy;
- avoid privacy violations, data destruction and service disruption;
- give us reasonable time to fix the issue before public disclosure;
- do not exploit the issue beyond what is necessary to demonstrate it;

then we will not pursue legal action, and we will credit you if you want the
credit. If you are unsure whether something is allowed, ask first.

## 6. Security practices in this repository

- **Static site:** no server-side code, no database, no user accounts, no
  cookies or tracking on the site itself — the attack surface is small.
- **No runtime dependencies or package manager:** only local assets, three OFL
  fonts and one Unsplash photograph are used.
- **No credentials in the repository:** git authentication uses SSH or a
  credential helper (macOS Keychain); tokens must never be embedded in remote
  URLs, files or commits. The `LICENSE.md` also covers automated tools.
- **`.gitignore`** excludes macOS metadata and volatile Obsidian state files.
- **Pull-request review** for contributions, including AI-assisted ones; generated
  code is reviewed before it is merged.
- **Recommended repository settings:** enable GitHub **secret scanning** and
  **push protection**, and protect `main` with pull requests and review
  approvals.

## 7. Automated tools and AI agents

If you run an AI coding agent on this repository:

- never place tokens, passwords or keys in files, remote URLs, prompts or
  commit messages;
- do not commit `.env` files, credentials, personal data or private keys;
- review generated code before pushing, and do not bypass review or branch
  protection;
- report anything suspicious you notice in the repository.

## 8. Copyright

Copyright and licensing of the code, brand and third-party assets are described
in **`LICENSE.md`**. All legal rights reserved.

## 9. Updates

This policy may be updated from time to time; the latest version in this
repository applies. Changes are tracked in the repository history.
