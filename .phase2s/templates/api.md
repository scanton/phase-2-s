---
title: REST API Endpoint
description: Add a new REST API resource with CRUD operations, validation, and tests
placeholders:
  - resource_name
  - project_name
  - test_command
---
# Add {{resource_name}} API to {{project_name}}

## Problem Statement

{{project_name}} needs a {{resource_name}} resource with full CRUD operations exposed via REST API. Currently no {{resource_name}} endpoints exist. Add create, read, update, delete with input validation and error handling.

## Acceptance Criteria

- [ ] GET /{{resource_name}}s returns paginated list
- [ ] GET /{{resource_name}}s/:id returns single resource or 404
- [ ] POST /{{resource_name}}s creates resource with validation; returns 201
- [ ] PUT /{{resource_name}}s/:id updates resource; returns 200 or 404
- [ ] DELETE /{{resource_name}}s/:id deletes resource; returns 204 or 404
- [ ] Invalid input returns 400 with field-level error messages
- [ ] All endpoints tested

## Constraint Architecture

**Must Do:** Validate all inputs before touching the database; Return consistent error shapes across all endpoints; Use existing database/ORM patterns in the codebase
**Cannot Do:** Skip validation on any write endpoint; Return 500 for validation errors
**Should Prefer:** Reuse existing middleware (auth, error handler, logging); Keep route handlers thin — logic in a service layer
**Should Escalate:** Schema changes that require database migration

## Decomposition

### Sub-task 1: Data model and repository
- **Input:** schema requirements for {{resource_name}}
- **Output:** model definition, repository with CRUD methods
- **Success criteria:** unit tests for each repository method

### Sub-task 2: Service layer
- **Input:** repository from Sub-task 1
- **Output:** service with business logic, input validation
- **Success criteria:** validation rejects bad inputs, service tests pass

### Sub-task 3: Route handlers
- **Input:** service from Sub-task 2
- **Output:** routes for all 5 CRUD operations
- **Success criteria:** routes call service, return correct HTTP status codes

### Sub-task 4: Integration tests
- **Input:** routes from Sub-task 3
- **Output:** end-to-end tests for all endpoints including error cases
- **Success criteria:** {{test_command}} passes, all edge cases covered

## Evaluation Design

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| CRUD happy path | valid create payload | 201 create, 200 read, 200 update, 204 delete |
| Validation errors | missing required fields | 400 with field names in error body |
| Not found | GET /{{resource_name}}s/nonexistent-id | 404 |

## Eval Command

{{test_command}}
