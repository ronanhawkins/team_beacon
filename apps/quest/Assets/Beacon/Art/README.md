# NASA Murray Buttes panorama

`MurrayButtes-PIA20840.jpg` is the original JPEG from NASA/JPL:
https://www.jpl.nasa.gov/images/pia20840-rovers-panorama-taken-amid-murray-buttes-on-mars/

Download: https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA20840.jpg

Credit: **NASA/JPL-Caltech/MSSS**. Mastcam, Curiosity, sol 1451 (4 September 2016). North is at both image edges; south is in the centre. NASA describes the published colours as approximately white-balanced. The downloaded pixels are unaltered.

The app uses this historical photograph only as VR reference scenery, not as the current waypoint's terrain, a navigable mesh or a source of live sky measurements. The partial panorama is displayed cylindrically with approximate vertical framing; uncaptured outer regions and the top/bottom feather into the procedural background. A tiny coverage lookup records the captured vertical extent at each bearing; this avoids mistaking dark rock shadows for missing pixels. Its original capture viewpoint and skyline do not match every route point. The calculated skyline remains a separate faint contour. Sun/Earth direction and visibility still come from the mission data.

Unity limits the runtime texture to 4096 pixels wide and ASTC 6×6 on Android. AR continues to show the room with a transparent warm tint; the panorama is not painted over the room's floor. No moving particles are rendered.
