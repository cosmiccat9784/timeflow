# Tests

Automated suite: `test_all.mjs` (Node 18+, no game needed).

```sh
node --test Tests/test_all.mjs
```

Only dependency-free modules are imported (`config`, `line_manager`,
`network_manager`, `route_planner`, `station_manager`,
`persistence_manager` with a mocked `world`). Game-API modules
(`main`, `transport_controller`, `fare_manager`, `interface_manager`,
`chat_commands`, `custom_command`) are exercised in-game per
`Documentation/COMPATIBILITY.md`.

Coverage: line naming/identity, flood-fill merge rules, texture sequences
(N = 1–10, row + column orientations), registration/rename validation,
place/merge, break/split/anchor-migration, support-line recalculation,
direct + transfer routing, no-route rejection, determinism, line ordering,
adjacency, save/load round-trip.
