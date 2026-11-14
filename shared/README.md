# shared

**Owner:** Ronan

Contracts and fake data that every part of the project builds against. If it crosses a boundary between two folders, its shape is defined here first.

Files that will probably live here:

- `state.md`: fields of the relay's single state object
- `waypoints.md`: fields of the waypoint file
- `fake/`: fake state and layer files so apps can be built before the engine and relay are ready
