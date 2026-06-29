# Contributing

Thanks for considering a contribution to app-assistant.

This project is a small Android UI automation helper for the neo app. The JavaScript version (`neo-auto-learn.js`) is the primary maintained version, while the Python version is experimental.

## Before You Start

- Use this project responsibly and follow the rules of any app or service you automate.
- Do not submit credentials, account data, device identifiers, screenshots with private information, or logs containing personal data.
- Prefer small, focused pull requests. One behavior fix per PR is easier to test and review.

## Development Setup

### JavaScript Version

1. Install AutoX.js on an Android device.
2. Enable accessibility permission and floating window permission.
3. Import `neo-auto-learn.js` into AutoX.js.
4. Test changes on real screens when possible.

Useful references:

- AutoX.js project: https://github.com/autox-community/AutoX
- AutoX.js releases: https://github.com/autox-community/AutoX/releases

### Python Version

```bash
pip install -r requirements.txt
python -m uiautomator2 init
python neo-auto-learn.py --debug
```

## What To Include In A PR

- A short description of the issue and the change.
- The device resolution and Android version used for testing, if the change touches coordinates or UI detection.
- Before/after behavior for bug fixes.
- New or updated screenshots in `examples/` only when they help explain a UI state.

## Coding Guidelines

- Keep changes conservative and local to the behavior being fixed.
- Prefer text/resource-id detection before coordinate fallbacks.
- When coordinates are necessary, use ratios and document the reference screen.
- Avoid generic clicks on back, close, bottom buttons, or unknown controls.
- Keep delays as short as possible while still reliable.
- Do not add dependencies unless they clearly reduce complexity.

## Testing Checklist

For JavaScript changes, manually verify at least the affected part of the flow:

- `neo-01`: level selection
- `neo-02`: Unit selection
- `neo-03`: topic selection
- `neo-04`: Step 1 Preview
- `neo-05`: GO
- `neo-06`: continue/play overlay
- `neo-07`: answer selection
- `neo-08`: result/restart behavior

For Python changes, run:

```bash
python neo-auto-learn.py --debug
```

## Reporting Issues

When opening an issue, include:

- Which script version you used: JS or Python.
- Device model, Android version, screen resolution.
- AutoX.js version, if using JS.
- Current screen or matching screenshot name, such as `neo-01`.
- Relevant log lines.
- What you expected to happen and what actually happened.

Please remove personal information from screenshots and logs before posting.

