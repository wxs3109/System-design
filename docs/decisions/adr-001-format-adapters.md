# ADR-001: Server-only OpenAPI and DBML adapters

- Status: accepted
- Date: 2026-08-30
- Origin: completed P2.3 dependency spike

## Context

P2.3 needed reliable OpenAPI 3.1, JSON Schema 2020-12, and DBML import/export without making third-party parser objects part of `ProjectFile`, increasing the browser bundle unnecessarily, or coupling the simulation Worker to document-format libraries.

The selection considered format correctness, round-trip fidelity, browser and Worker compatibility, maintenance, licensing, bundle cost, accessibility, and the usefulness of a general schema-driven form engine for the product's domain-specific editors.

## Decision

P2.3 uses mature parsers behind the server-only `@system-design/formats` adapter package. Library objects never become `ProjectFile` state, and neither dependency enters the simulation Worker bundle. The browser sends pasted text or normalized contracts to Node.js route handlers and receives validated domain objects or downloadable text.

| Concern | Selection | Result | Boundary |
| --- | --- | --- | --- |
| OpenAPI 3.1 | `@scalar/openapi-parser` 0.28.16 | selected; validates 3.1 documents and generated output | Node.js route, MIT |
| DBML | `@dbml/core` 10.1.1 | selected; parses and exports DBML, but its ~20 MB module is unsuitable for the browser bundle | Node.js route, Apache-2.0 |
| JSON Schema 2020-12 | native structured JSON editor plus P2.2 Zod domain validation | selected; schema documents retain booleans, arrays, unions, and references without translating them into a smaller form schema | browser editor; normalized `JsonSchemaDocument` |
| General form engine | RJSF 6.8.0 / JSON Forms | deferred | neither replaces the domain-specific table, index, interaction, and workload controls; adding one would increase bundle size without improving round-trip fidelity | reevaluate only when plugin-defined editor schemas become current work |

## Supported lossless subsets

OpenAPI import accepts 3.1 JSON with component JSON Schemas and JSON request/response bodies that reference those components. Inline body schemas are rejected with an actionable error instead of being silently duplicated. Simulator-only payload estimates, handler cost, SLOs, schema IDs, and versions use explicit `x-*` fields on export.

DBML import covers tables, supported scalar types, primary/unique/secondary indexes, and binary foreign keys. The adapter rejects unsupported column types and tables without primary keys. Cardinality, row size, stable IDs, index kind, and included columns have no standard DBML representation; exports preserve them in adapter-owned notes, while third-party DBML imports require explicit capacity defaults.

## Verification gates

- Both adapters parse through the selected library before mapping.
- Generated OpenAPI is validated by Scalar. Generated DBML is parsed by `@dbml/core`.
- Adapter tests cover round-trip fidelity and explicit rejection of lossy inputs.
- Route handlers set `runtime = 'nodejs'`; Web and simulation packages do not import either parser.
- Package versions are pinned so a parser upgrade requires an adapter test run.

## Consequences

- Format libraries remain replaceable behind a thin adapter boundary.
- Browser and simulation bundles do not absorb the DBML parser's size or Node.js assumptions.
- `ProjectFile` remains a normalized, versioned domain model rather than a container for parser-specific objects.
- Unsupported or lossy input is rejected explicitly instead of being approximated silently.
- A general form engine remains future work and is not justified until external editor schemas become an active requirement.
