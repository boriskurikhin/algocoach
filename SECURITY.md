# Security policy

## Supported version

Security fixes currently target the latest source version.

## Report a vulnerability

Do not include a real OpenAI key, learner transcript, or exported learner
profile in a public report. Provide a minimal reproduction with synthetic data.

Until a private reporting address is established, open a public issue only for
non-sensitive hardening suggestions. For a credential exposure or exploitable
data leak, contact the repository owner privately.

## Threat model

The extension protects credentials and learner data from the active webpage by
keeping them in trusted extension contexts. It validates all messages, model
outputs, and visualization payloads and requests only temporary page access.

It does not protect data from:

- a person or malware with access to the Chrome profile;
- a compromised browser or operating system;
- the OpenAI API after the user intentionally starts a request;
- a malicious build distributed outside the trusted release process.

Persistent API keys are not encrypted with a bundled application secret;
bundled secrets provide no meaningful protection. Users should apply project
spending limits, monitor OpenAI usage, and rotate a key if exposure is
suspected.
