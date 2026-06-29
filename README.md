# app-assistant

An Android UI automation helper for the neo app. This project was built through vibe coding with trea + GLM, CC + DeepSeek, and Codex.

Two versions are available: the **Python version (experimental)**, which runs from a computer over USB/WiFi, and the **JavaScript version (in use)**, which runs directly on Android through AutoJS/AutoX. The primary maintained script is `neo-auto-learn.js`.

---

## Features

The scripts automate common neo app (`com.nexgen.nsa`) interactions and aim to reduce repetitive tapping:

- Detect and close popups and break reminders.
- Find and enter the learning module.
- Play lesson content and proceed to the next step.
- Handle exercise pages for choice, true/false, speaking, and fill-in-the-blank tasks. Some answer choices may still require manual judgment for accuracy.
- Continue to the next round from result pages.
- Use small randomized delays to mimic a more natural interaction rhythm.

---

## Project Layout

```text
app-assistant/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── requirements.txt       # Python dependencies
├── examples/              # Reference screenshots for neo pages
├── neo-auto-learn.py      # Python version, run from a computer
└── neo-auto-learn.js      # JavaScript version, run on Android with AutoJS/AutoX
```

---

## Python Version (Experimental)

### Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt   # uiautomator2>=3.0.0

# 2. Connect the phone over USB and enable USB debugging
# 3. Allow debugging authorization on the phone
# 4. Install the uiautomator2 agent on the phone for the first run
python -m uiautomator2 init
```

### Run

```bash
# USB connection (auto-detected)
python neo-auto-learn.py

# WiFi connection (specify device IP)
python neo-auto-learn.py 192.168.1.100

# Debug mode: print the current UI tree for troubleshooting
python neo-auto-learn.py --debug
```

### Stop

Press `Ctrl+C`. The script prints the runtime and loop count before exiting.

---

## JavaScript Version (In Use)

### Setup

1. Install **AutoJS/AutoX** or a compatible automation framework on the phone.
   - AutoX.js GitHub: https://github.com/autox-community/AutoX
   - AutoX.js APK releases: https://github.com/autox-community/AutoX/releases
2. Enable accessibility permission.
3. Allow floating window permission. The script uses it for the stop button.
4. Import `neo-auto-learn.js` into AutoJS/AutoX and run it.

### Features

- Shows a small floating panel with runtime status and loop count.
- Supports stopping at any time through the floating stop button.
- Retries launching the target package when the foreground package does not match.
- Can continue from any known page state instead of requiring a fresh app start.

### Current JavaScript Flow

The script uses a state-machine style page detector:

1. `neo-01` level page: randomly choose one of `C1 Bridge`, `C1`, `B2+`, or `B2`.
2. `neo-02` Unit list page: randomly choose Unit 1-4 and tap the card center.
3. `neo-03` topic list page: randomly choose one of the first four subjects.
4. `neo-04` Step dialog: choose `Step 1 Preview`.
5. `neo-05` Preview page: tap `GO`.
6. `neo-06` continue/exit overlay: tap only the middle continue/play button and avoid bottom replay/Home controls.
7. `neo-07` exercise page: randomly select `True/False`, visible string choices, or image choices.
8. `neo-08` result page: restart or return to the level page for the next round.

### JavaScript Answer Rules

- `True/False`: randomly select one option.
- String choices: randomly tap one visible answer card.
- Image choices: randomly tap one visible image option.
- Standard single/multiple choice: randomly tap a visible option and try to submit.
- Fill-in-the-blank:
  - Consecutive underscores count as one blank, for example `___` is one blank.
  - `_ word _` is two blanks.
  - If there are multiple blanks, the script clicks the first matching options in order during the same handling cycle.
  - Fill-in-the-blank clicks are single clicks with spacing between options to avoid accidental double-click recognition.

### JavaScript Mis-tap Prevention

- Unknown `MainActivity` states do not trigger random bottom-button taps, which helps avoid the left replay button.
- Generic fallback logic does not tap `X`, close, or back controls.
- Top-left `X/close` controls are treated as page exit buttons, not popup close buttons.
- Home is handled only on result/completion pages.
- Continue handling only taps explicit continue text or a middle-screen play button, not arbitrary bottom candidates.

---

## Configuration

Python version `CONFIG`:

| Name | Default | Description |
|------|---------|-------------|
| `APP_PACKAGE` | `com.nexgen.nsa` | Target app package name |
| `APP_NAME` | `neo` | App name |
| `LOOP_INTERVAL` | 2 seconds | Base loop interval |
| `RANDOM_DELAY_MIN` | 0.8 seconds | Minimum random delay |
| `RANDOM_DELAY_MAX` | 2.5 seconds | Maximum random delay |
| `MAX_RETRY` | 3 | Retry count |

JavaScript version `CONFIG`:

| Name | Default | Description |
|------|---------|-------------|
| `APP_PACKAGE` | `com.nexgen.nsa` | Target app package name |
| `APP_NAME` | `neo` | App name |
| `TARGET_POINTS` | `6000` | Placeholder target score |
| `LOOP_INTERVAL` | `2000` | Reserved config; current loop mainly uses page waits and short random delays |
| `SWIPE_DURATION` | `500` | Swipe duration |
| `MAX_RETRY` | `3` | Reserved config |
| `RANDOM_DELAY_MIN` | `5` | Minimum delay per loop, in milliseconds |
| `RANDOM_DELAY_MAX` | `35` | Maximum delay per loop, in milliseconds |

---

## Runtime Logic

```text
Launch neo -> main loop -> close popups -> detect current page
                                |
             +------------------+------------------+
             |                  |                  |
           Home              Lesson             Exercise / Result
        enter module      play / next          answer / continue
             |                                      |
             +--------------------------------------+
                         keep looping
```

Page detection signals:

- **Home**: localized home/learning text or resource IDs containing `home`/`main`.
- **Lesson page**: localized play/next-lesson text or resource IDs containing `video`/`player`.
- **Exercise page**: RadioButton/CheckBox controls or localized choice/answer/submit text.
- **Result page**: localized completion/score/correct-result text.

Additional JavaScript detectors:

- **Level page**: `ProMenuActivity/Menu` or visible level choices without Unit/topic markers.
- **Unit list page**: `Unit 1-4` or `Certification Test`.
- **Topic page**: `Mastery Test`, `Dictations`, `Focus Exercises`, or known topic text.
- **Step dialog**: `BottomSheet` or `Select Step + Step 1`.
- **Result page**: score text or a `neo-08` style page with a large top score.

---

## Notes

- The script currently selects answers randomly. It is intended to reduce tapping, not to guarantee correct answers.
- Smart answering could be added later with semantic analysis or LLM support.
- Keep the phone screen awake and unlocked.
- Some Huawei/Xiaomi devices may require disabling strict app-install modes or enabling background popup permissions.
- AutoJS `click()` coordinates and system `input tap` coordinates can differ. The JavaScript version tries to avoid mixing coordinate systems on critical controls. AutoX.js is recommended.
- If the neo UI or screen ratio changes, use screenshots to confirm button positions and then adjust the corresponding ratio coordinates in `neo-auto-learn.js`.

---

## Open Source

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. For security or privacy-sensitive reports, see [SECURITY.md](SECURITY.md).
