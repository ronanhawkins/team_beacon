# shared

**Owner:** Ronan

Contracts and fake data that every part of the project builds against. If it crosses a boundary between two folders, its shape is defined here first.

Read `conventions.md` first. Units and angle directions are the easiest things to get wrong.

Files:

- `conventions.md`: units, angle directions, the skyline layout, the position frame, and how contracts may change
- `state.md`: fields of the relay's single state object
- `events.md`: messages devices send to the relay, and what the relay sends back
- `waypoints.md`: fields of the waypoint file
- `layers.md`: the map layer images and their metadata file
- `client.js`: ES module the apps import to talk to the relay (connect, hello, reconnect, `onState`, `send`)
- `fake/`: fake files so apps can be built before the engine and relay are ready. Regenerate with the scripts in `tools/`, never by hand, and run `python3 tools/check_fakes.py` after.
  - `fake/waypoints.json`: 6-point main route from an open plain to a shelter beside a butte, with a reroute from every main index (`tools/make_fake_waypoints.py`)
  - `fake/state.json`: state at main waypoint 0, nominal (`tools/make_fake_waypoints.py`)
  - `fake/state-storm.json`: state just after a storm at main waypoint 3, on `reroutes["3"][0]` (`tools/make_fake_waypoints.py`)
  - `fake/layers/`: `meta.json` plus one 256x256 PNG per layer for the same plain and butte (`tools/make_fake_layers.py`, needs Pillow)
