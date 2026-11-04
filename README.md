<div align="center">
  <h1>Rounded Window Corners Ultimate</h1>
  <p><i>Soft, rounded corners for every window on GNOME Shell 51</i></p>
</div>
<br>

Hi there! 👋 This is a personal fork of
[Rounded Window Corners Reborn](https://github.com/flexagoon/rounded-window-corners)
by flexagoon, which lovingly continues the original
[rounded-window-corners](https://github.com/yilozt/rounded-window-corners)
by yilozt. Both did the hard work, this fork just builds on top of it.

## What this fork is about

- **GNOME Shell 51 on Wayland only.** One target, done well, instead of
  many versions done halfway.
- **Plain JavaScript, no build step.** Clone it, pack it, done.
- **Stable and light.** No effects on fullscreen windows and games, and the
  best fixes from other forks collected in one place.
- **Eventually no settings at all.** Every window should simply look like a
  native libadwaita window, without any fiddling.

The extension is not on extensions.gnome.org (yet).

## Made with AI 🤖

Full transparency: the code in this fork is written with the help of an AI
coding assistant. A human decides what gets built, reviews the changes and
tests them on a real desktop before they land. If you spot something odd,
please open an issue, that helps a lot!

## Installation

1. Install the dependencies:
    - make
    - gettext
    - `gnome-extensions` (comes with GNOME Shell)

2. Build and install the extension:

    ```bash
    git clone https://github.com/coffeebowl/rounded-window-corners-ultimate
    cd rounded-window-corners-ultimate
    make install
    ```

3. Log out and back in, then enable it:

    ```bash
    gnome-extensions enable rounded-window-corners-ultimate@coffeebowl
    ```

Coming from Rounded Window Corners Reborn? Disable it first and log out
once. GJS keeps registered classes around until the session ends, so the two
would get in each other's way.

## Development

Everything lives in `extension/` as plain GJS ES modules. These `make`
targets are all you need:

```bash
make pack     # Pack the extension into a zip file
make install  # Pack and install the extension
make pot      # Update the translation template and .po files
make clean    # Delete the zip file
```

## Thanks ❤️

- [flexagoon/rounded-window-corners](https://github.com/flexagoon/rounded-window-corners)
  for Rounded Window Corners Reborn, the base of this fork.
- [yilozt/rounded-window-corners](https://github.com/yilozt/rounded-window-corners)
  for the original extension that started it all.

## License

GPL-3.0-or-later, see [`LICENSE`](LICENSE).
