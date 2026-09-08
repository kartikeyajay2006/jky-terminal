# Capture — Design Spec

**Date:** 2026-09-09
**Implements:** a camera beside the notification bell that turns whatever is on
screen into a PNG, saved to disk or put on the clipboard.
**Supersedes nothing.** Extends `2026-08-26-jky-terminal-v0.1-design.md`, whose
§4 security properties this feature has to hold to rather than bend.

---

## 1. Purpose

One button, in reach from every section, that answers "I want to show someone
this." A terminal that just printed something worth keeping, a game with a
score on it, a mail list, a tool's output — all of it is a picture waiting to
be taken, and today the only way to take it is to leave the app.

Two destinations, because they serve different intentions. **Save** is for
keeping: a file on disk with a name that sorts. **Copy** is for sending: the
image on the clipboard, ready to paste into a chat, an issue, a document. A
person who copies does not want a file left behind, so copying writes nothing
to disk.

## 2. What is being built, and what is not

### In scope

- A camera control beside the bell, reachable from every section.
- A choice between Save and Copy, presented after the shot is taken.
- Save writes `jky-terminal-YYYY-MM-DD-HHMMSS.png` to the OS downloads
  directory and says where it went.
- Copy puts the PNG on the system clipboard and writes nothing.
- The whole app window is the frame: rail, status bar, tabs, content. It reads
  as a picture of JKY Terminal rather than a crop of one panel.

### Explicitly not in scope

- Region select, drag-to-crop, annotation, arrows, blur. A screenshot tool is
  a different product; this is a camera.
- Capturing anything outside the app's own window. The app has no business
  photographing the rest of a person's screen, and asking for that permission
  would be a cost paid by everyone for a feature nobody asked for.
- Video or GIF.
- A gallery of past captures.

## 3. The capture constraint

The obvious approach is to ask the operating system for a picture of the
window. It was measured and rejected, and the measurements are here so nobody
has to repeat them.

### 3.1 Tauri has no cross-platform webview capture

There is no Tauri API for "give me a picture of this webview". The upstream
discussion asking for exactly this (tauri-apps/tauri#13029) is open and
unanswered. The three platform webviews each have their own snapshot call —
`webkit_web_view_get_snapshot`, `WKWebView takeSnapshotWithConfiguration:`,
`ICoreWebView2::CapturePreview` — so a native route means three hand-written
FFI paths, in three languages' object models, to be maintained forever.

### 3.2 Screen capture is not portable in practice

`xcap`, the crate behind the community screenshot plugins, documents window
capture as fully working on X11, macOS and Windows, and *not fully supported in
some special scenarios* on Wayland. Wayland is not a special scenario; it is
the default on current Fedora, Ubuntu and SteamOS. A capture button that works
for some Linux users and silently fails for others is worse than none, and the
portal route that does work there costs a permission prompt for every capture.

### 3.3 Measured: the window can photograph itself

Run against WebKitGTK 2.52.5, the oldest engine of the three this app ships on
and the one with the weakest `foreignObject` history:

| question | measured |
|---|---|
| Does `foreignObject` → `<canvas>` draw? | yes — 4,400 non-blank pixels |
| Is the canvas tainted afterwards? | no — `getImageData` and `toDataURL` both return |
| Do the games use `<canvas>`? | no — every game is DOM |
| Does the terminal's WebGL canvas read back? | **blank**, and without throwing |

The last row is the whole problem, and it has a one-word fix. `WebglAddon`
takes a `preserveDrawingBuffer` flag it passes straight to `getContext`, and
the app constructs it with no argument — so WebGL is free to discard each frame
the moment it is drawn, and a read afterwards finds nothing. Constructed as
`new WebglAddon(true)`, the buffer survives and the terminal photographs.

That is the entire native-versus-web question decided by measurement: one
boolean, and the window can take its own picture on every platform with the
same code.

### 3.4 Why this is the right trade

`preserveDrawingBuffer: true` costs memory and a little fill rate, because the
frame is kept rather than dropped. That is the price of a terminal that can be
photographed, it is paid once at construction, and it is identical on all three
platforms — which is the property being bought.

## 4. The technique

A capture is assembled, not grabbed:

1. Clone the app root and inline the computed styles it depends on, because a
   serialized tree carries no stylesheet with it.
2. Serialize the clone into an SVG `foreignObject` at the window's own pixel
   size and draw it to a canvas. This renders every part of the app that is
   DOM, which is all of it but one element.
3. Composite each live `<canvas>` on top, at the position and size it occupies
   on screen. `foreignObject` serializes a canvas as an empty element — its
   pixels do not travel with the markup — so the terminal has to be drawn
   separately or it arrives blank.
4. Export as a PNG blob.

Step 3 is the reason this is a module and not a one-liner, and the reason it is
tested against a DOM containing a canvas rather than only against markup.

## 5. IPC surface

Two commands, added to the pinned list in `tests/security.rs` so that adding
them is a review rather than an accident:

| command | takes | returns |
|---|---|---|
| `capture_save` | PNG bytes | the path written |
| `capture_copy` | PNG bytes | nothing |

Neither takes a destination. The window says *what* to keep; Rust decides
*where* it goes, which is what keeps the renderer's lack of filesystem
capability true — `the_renderer_is_granted_no_filesystem_shell_or_network_capability`
must keep passing untouched. Neither returns bytes, a path the window chose, or
anything shaped like a secret.

Both append an audit event, as every other capability does. A capture is a
thing that left the app, and the log should say so.

## 6. UI

A camera beside the bell, same size and affordance. Pressing it takes the shot
first and *then* offers Save and Copy, so the picture is of the app as it was
before a popover opened over it.

The popover is two buttons and an escape. It is keyboard reachable, labelled,
and closes on Escape and on outside click, matching the app's other popovers.
Colours are tokens; a literal hex here would fail the lint that exists to stop
exactly that.

## 7. Testing

- The capture module: unit tests over a DOM with and without a canvas,
  asserting a canvas is composited rather than dropped.
- Filename and destination: pure functions, tested directly, including that two
  captures in the same second do not collide.
- Parity: the web mock gains `capture` so browser preview and every existing
  parity test stay honest.
- Security: the pinned command list gains two entries with the reasoning above,
  and every other security test is expected to pass unchanged.
- The real app: take an actual capture with a terminal open, and look at the
  PNG.
