# Orbit Pad

A spatial drum pad in the browser. A figure stands in the middle of a 3D scene, surrounded by 17 square pads: overhead, on the upper diagonals, all around at ear level, and on the lower diagonals. Each pad is a sound source in 3D space (Web Audio HRTF), so with headphones every hit comes from that pad's direction.

## Features

- **17 fixed sound sources** around the listener's head, played by clicking or with the keyboard (`A S D F G H J K` at ear level, `Q W E R` above, `Z X C V` below, `T` overhead).
- **Real sampled drum machines**: Roland TR-808, LinnDrum LM-2, MFB-512 and Casio RZ-1, streamed from [danigb/samples](https://github.com/danigb/samples).
- **Distance per pad**: from right at your ear to far away. Close sounds are louder and drier; far ones are quieter, duller and more reverberant.
- **16-step sequencer** with accents, swing, live recording, mute/solo, and preset patterns that move around your head.
- **Your own sounds** (the "Your sounds" tab). Files stay in your browser (IndexedDB) and are never uploaded.
  - Put any file, or a selected part of it, on a pad.
  - Chop a beat into slices at its hits and spread them across 4, 8, 16 or 17 pads.
  - Spread a full song around you: from one spot, left/right channels on two pads, four frequency bands on four pads, or orbiting your head (8D). Each part follows its pad's distance slider.
- **Export WAV**: a binaural stereo bounce that keeps the 3D effect on any headphones. It is song-length when a song is set to start with the sequencer.

## Run it

It's plain HTML and ES modules with no build step. Any static file server works:

```sh
./run.sh            # serves on http://localhost:8820 (or the next free port) and opens it
```

The 3D effect is made for headphones. On speakers you'll still hear left and right, but front, back and height are much weaker.

## Tech

three.js (scene and bloom), the Web Audio API (`PannerNode` HRTF, convolution room, `OfflineAudioContext` for export), and IndexedDB for imported audio.
