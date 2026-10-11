# Import steps into Apple Health with Shortcuts

The app's **Export JSON** produces:

```json
{ "source": "km-to-steps", "samples": [ { "date": "2026-10-04T12:00:00.000Z", "steps": 13158, "unit": "count" } ] }
```

Build the shortcut (Shortcuts app → + New Shortcut):

1. **Get File** (or "Receive input from Share Sheet", types: Files) – choose the exported `steps.json`.
2. **Get Dictionary from Input**.
3. **Get Dictionary Value** → key `samples`.
4. **Repeat with Each** item:
   1. **Get Dictionary Value** → `steps` (from Repeat Item) → **Set Variable** `n`.
   2. **Get Dictionary Value** → `date` (from Repeat Item) → **Get Dates from Input** → **Set Variable** `d`.
   3. **Log Health Sample**: Type *Steps*, Value `n`, Start Date `d`, End Date `d`.
5. Allow Shortcuts to write Steps when prompted.

Tip: re-importing the same file duplicates samples; clear the app's log after importing.
