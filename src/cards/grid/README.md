# Card-grid UI boundary

This directory owns the reusable card-grid surface. It renders physical rows,
delegates keyboard and pointer interactions, and reads card layout CSS variables.
It does not own item pagination, flat-grid data construction, preview requests,
or two-hop section composition.

```text
layout/       CSS-driven card geometry
interaction/ physical-cell bindings and delegated navigation
surface/     reusable Svelte rendering surface
```

Feature-specific assembly, including the flat logical-grid adapter, belongs in
`cards/grid/runtime/flat-grid`. Two-hop uses the parallel
`two-hop/ui/virtual-grid` structure. Shared virtualization
mechanisms are consumed through `cards/virtualization/public`.
