## Kalidokit Handtracking Outline

This is my stitched together implementation of VTubing software made to render out hand kinematics. 95%+ of the work was done by this repository: https://github.com/yeemachine/kalidokit

This is a very rough outline and will need serious rewrites/refactors if you wish to use it. It may just be worth setting it up from scratch.

It's the result of chatGPT prompts, fixing the dozen errors that produces, and throwing it back into prompts only to repeat the process until something vaguely resembling functioning code came out.

However despite everything it somehow manages to work, and you can use it to get an idea of how this software functions.

There are however a few things to note about this code.

# The poltergeist

First - I don't know why, and frankly at this point I don't want to know why but for some god forsaken reason this code has reset to a "default project" and just wiped the code I was using, twice (both the main.ts and index.html). Maybe my computer is haunted, although more likely I was just doing something dumb when I did this. Just consider this a fair warning from me to keep a backup of this thing somewhere just in case so you don't have to try your best to stitch this thing back together like I've had to. Preferably make that backup immutable in case whatever spirits I've angered in writing this mess come for you next.

Anyways, my deranged superstitions aside, here's how to actually operate this code. This was all run on windows 10 LTSC, so I can't speak for any functionality on any other OS.

# Actually running this thing

You get a hand kinematics folder, put it somewhere. Then, open that location up with powershell or whatever other terminal you use.
Install these things: npm install @mediapipe/hands @mediapipe/drawing_utils @mediapipe/camera_utils kalidokit
These are old, they are probably not secure, so use at your own risk. Have fun.
Once you do that, run "npm run dev" - if you're like me and using powershell you'll probably get a fit of red text about running scripts being disabled on the system. Naturally, the solution to this is to ignore it and hope it won't be a problem by running "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass". Then you should be able to run "npm run dev" and have it actually work.
Once it does that, you'll see an IP, ie: http://localhost:5173/
Throw that into a search bar and you can run a local webserver. Make sure you have some sort of webcam access or this won't work.
Give access to the webcam. It may take a moment to load.
Once you've done that you'll see cool outlines on up to 2 hands in the webcam displayed to you. I haven't tested what would happen with additional hands in frame as I only have two, but I imagine that would break or confuse the program so maybe don't do that.
Press r to start recording, r again to stop recording, and d to download. The output will be a JSON source file and something like: "hand_kinematics_2026-06-29T22_15_11.570Z"
It's configured at the moment to take a recording every ~33.33ms (30hz). This can be changed by changing these lovely HARDCODED lines:
const TARGET_SAMPLE_RATE_HZ = 30; // <-- change to 10, 30, 60, 120, etc.
const SAMPLE_INTERVAL_MS = 1000 / TARGET_SAMPLE_RATE_HZ;

Provided nothing supernatural happened (ie the poltergeist) you should now know the very basics of how to run this. Good luck.
