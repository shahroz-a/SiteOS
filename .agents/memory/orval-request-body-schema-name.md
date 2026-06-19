---
name: Orval zod request-body schema naming
description: How orval names the generated zod schema for a POST/PATCH JSON request body.
---

# Orval zod request-body schema naming

When validating a request body server-side with the generated `@workspace/api-zod`
schema, the export is named after the **operation**, not after the OpenAPI
component schema you referenced.

For `POST /events/page-view` whose `requestBody` `$ref`s a component schema
`RecordPageViewRequest`, orval-zod emits the validator as `RecordPageViewBody`
(`<OperationId>Body`), NOT `RecordPageViewRequest`. Importing the component name
as a value gives TS2693 ("only refers to a type, but is being used as a value")
because that name only survives as a generated TS *type*, not a runtime zod value.

**Why:** orval derives zod value names from the operationId + payload role
(`Body`/`Params`/`QueryParams`/`Header`/`Response`), independent of the component
schema name in the spec.

**How to apply:** before importing a generated zod schema, grep
`lib/api-zod/src/generated/api.ts` for the actual `export const` name rather than
assuming it matches the OpenAPI component. Response validators follow the same
rule: `<OperationId>Response` (e.g. `GetCmsAnalyticsResponse`).
