# LDI Declared Origin: Duplicated C# Windows

## Problem

A user duplicates a C# window (for example two windows on **C# Threads + C++
Threads** in the C# Thread Control Experiment). Every such window gets the
`managed` LDI role. Today the backend treats this as ambiguous everywhere:

- `ldi_pair` returns `None` when a solution has more than one managed window
  (pinned by the test "Never guess between managed origins").
- `ldi_selections` therefore refuses every Blue: *"LDI needs one selected C#
  Debug Power slot and a selected CMake Library Build Power slot"*.
- Until the 26 Oct fix, the call-site preview refused too. That silently removed
  every ghost Blue and the yellow needs-window ring.

The preview is now per-window, so ghosts and the ring come back. Clicking a
ghost still fails when a native partner is open, because pairing has no origin.

Refusing to guess is correct. But the user *has* declared an origin: they
clicked the gutter in one specific window. Craidd should obey that.

## Direction

**The window where the user sets a Blue becomes the declared LDI origin for its
solution.** Craidd never infers an origin from window order, focus or config
name. It only records one from an explicit user act.

1. **Registry state.** Add `ldi_origin: HashMap<solution, window_label>` to the
   linked-window registry. It is set when a Blue is set from a managed window,
   and cleared when that window closes or leaves the managed role.
2. **`ldi_pair` resolution order:**
   - exactly one managed window → that window (unchanged);
   - several managed windows and a declared origin that is still managed → the
     declared origin;
   - otherwise → `None` (unchanged; the test still holds for the undeclared
     case).
3. **Setting a Blue** from managed window X while another managed window Y is
   the declared origin and **owns Blues**: refuse with a named choice rather than
   moving silently: *"CS{Y} owns this solution's Native Blues. Move LDI origin
   to CS{X}?"* Moving the origin discards Y's Blue intents, with that
   consequence stated. If Y owns no Blues, X takes the origin without a prompt.
4. **Gold Linked Debug** launched from a non-origin managed window runs as an
   ordinary linked debug for that window. The origin's members are unchanged.
   The toolbar names the origin (*"LDI origin: CS{Y}"*) so this is not a
   surprise.
5. **Every `ldi_pair` caller** (snapshot members, reveal, Gold Debug phases,
   restart review, partner checks, `ldi_debug_group_active`) inherits the
   declared origin through `ldi_pair`. No caller picks an origin itself.

## Out of scope

- Several simultaneous LDI origins in one solution (two managed reproductions
  at once). Covered later by `design-native-shared-consumers.md`.
- Changing the needs-window hover wording.

## Acceptance

- Two C# windows plus no native window: both show yellow-ringed ghosts. Clicking
  one opens or reuses **Native Libraries · C# LDI** and sets a Blue owned by the
  clicked window.
- Gold Linked Debug from that window arms the Blue. The other C# window stays
  outside the LDI group.
- Setting a Blue from the second C# window asks to move the origin. Declining
  keeps everything unchanged.
- Closing the origin window clears the declaration. With two or more managed
  windows left, pairing is `None` again until the user declares an origin.
- Existing single-origin tests stay green. New tests cover declared-origin
  resolution and clearing.

---

*Last updated: 26 Oct 2026. Author: ShinkuKira21.*
*This document is a design.*
