# A test client for tests/libdecor-smoke.js: a plain SDL3 window, through
# ctypes, so it needs neither headers nor a build step. On Wayland under
# GNOME, libdecor draws its decorations. Exits with 77 without SDL3.
# Usage: python3 sdl-window.py <seconds> [title]
import ctypes
import sys
import time

try:
    sdl = ctypes.CDLL('libSDL3.so.0')
except OSError:
    sys.exit(77)
sdl.SDL_Init.argtypes = [ctypes.c_uint32]
sdl.SDL_Init.restype = ctypes.c_bool
sdl.SDL_GetError.restype = ctypes.c_char_p
sdl.SDL_CreateWindow.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_uint64]
sdl.SDL_CreateWindow.restype = ctypes.c_void_p
sdl.SDL_CreateRenderer.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
sdl.SDL_CreateRenderer.restype = ctypes.c_void_p
sdl.SDL_SetRenderDrawColor.argtypes = [ctypes.c_void_p] + [ctypes.c_uint8] * 4
sdl.SDL_RenderClear.argtypes = [ctypes.c_void_p]
sdl.SDL_RenderPresent.argtypes = [ctypes.c_void_p]
sdl.SDL_PollEvent.argtypes = [ctypes.c_void_p]
sdl.SDL_PollEvent.restype = ctypes.c_bool

SDL_INIT_VIDEO = 0x20
SDL_WINDOW_RESIZABLE = 0x20

if not sdl.SDL_Init(SDL_INIT_VIDEO):
    sys.exit(f'SDL_Init: {sdl.SDL_GetError().decode()}')
title = (sys.argv[2] if len(sys.argv) > 2 else 'rwc-sdl').encode()
window = sdl.SDL_CreateWindow(title, 400, 300, SDL_WINDOW_RESIZABLE)
renderer = sdl.SDL_CreateRenderer(window, None)
if not window or not renderer:
    sys.exit(f'SDL: {sdl.SDL_GetError().decode()}')
event = ctypes.create_string_buffer(256)
end = time.monotonic() + float(sys.argv[1])
while time.monotonic() < end:
    while sdl.SDL_PollEvent(event):
        pass
    sdl.SDL_SetRenderDrawColor(renderer, 40, 120, 200, 255)
    sdl.SDL_RenderClear(renderer)
    sdl.SDL_RenderPresent(renderer)
    time.sleep(0.016)
