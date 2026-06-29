## Kalidokit Handtracking Outline

This is a very rough outline and will need serious rewrites/refactors if you wish to use it. It may just be worth setting it up from scratch.

However despite everything it works, and you can use it to get an idea of how this software functions.

There are however a few things to note about this code.

# The poltergeist

First - I don't know why, and frankly at this point I'm scared to find out but for some god forsaken reason this code has reset to a "default project" and just wiped the code I was using, twice. Maybe my computer is haunted, although more likely I was just doing something dumb when I did this. Just consider this a fair warning from me to keep a backup of this thing somewhere just in case so you don't have to try your best to stitch this thing back together like I've had to.

Anyways, my deranged superstitions aside, here's how to actually operate this code. This was all run on windows 10 LTSC, so I can't speak for any other OS.

# Actually running this

You get a hand kinematics folder, put it somewhere. Then, open that location up with powershell or whatever other terminal you use.
Install these things: npm install @mediapipe/hands @mediapipe/drawing_utils @mediapipe/camera_utils kalidokit
These are old, they are probably not secure, so use at your own risk. Have fun.
Once you do that, run "npm run dev" - if you're like me and using powershell you'll probably get a fit of red text about running scripts being disabled on the system. Naturally, the solution to this is to ignore it and hope it won't be a problem by running "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass". Then you should be able to run "npm run dev" and have it actually work.
