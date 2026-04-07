---
title: Authentication Feature
description: Add login, session management, and access control to a web app
placeholders:
  - project_name
  - framework
  - auth_strategy
  - test_command
---
# Add Authentication to {{project_name}}

## Problem Statement

{{project_name}} has no authentication layer. Users can access all routes without logging in. We need to add login, session management, and route protection using {{auth_strategy}} on {{framework}}.

## Acceptance Criteria

- [ ] Users can register with email + password
- [ ] Users can log in and receive a session token
- [ ] Protected routes return 401 for unauthenticated requests
- [ ] Logout invalidates the session
- [ ] Passwords are hashed (bcrypt or equivalent) — never stored plaintext
- [ ] All auth endpoints have input validation and rate limiting

## Constraints

### Must Do
- Use {{auth_strategy}} for session/token management
- Hash passwords before storage
- Return consistent error shapes from all auth endpoints

### Cannot Do
- Store plaintext passwords
- Skip input validation on any auth endpoint

### Should Prefer
- Reuse existing middleware patterns in the codebase
- Keep auth logic in a dedicated module (not scattered across routes)

### Should Escalate
- If the database schema needs migration — pause and confirm before running

## Decomposition

### 1. User model and password hashing
Input: database schema, chosen hashing library
Output: User model with `createUser()`, `verifyPassword()` functions
Success criteria: unit tests pass for create + verify; passwords never logged

### 2. Registration and login endpoints
Input: User model from subtask 1
Output: POST /auth/register and POST /auth/login with validation
Success criteria: returns token on success, 400 on validation error, 401 on bad credentials

### 3. Session middleware
Input: {{auth_strategy}} library, login endpoint from subtask 2
Output: middleware that validates token and attaches user to request
Success criteria: protected route returns 401 without token, 200 with valid token

### 4. Logout and session invalidation
Input: session middleware from subtask 3
Output: POST /auth/logout that invalidates token
Success criteria: token rejected after logout

### 5. Integration tests
Input: all auth endpoints from subtasks 1-4
Output: end-to-end test suite covering register → login → access → logout
Success criteria: {{test_command}} passes with ≥90% coverage on auth module

## Evaluation Design

### Test: happy path register → login → access → logout
Input: fresh database, valid credentials
Expected: 201 register, 200 login with token, 200 on protected route, 200 logout, 401 after logout

### Test: invalid credentials
Input: wrong password
Expected: 401 with no information leakage (no "user not found" vs "wrong password" distinction)

### Test: missing token
Input: protected route call with no Authorization header
Expected: 401

evalCommand: {{test_command}}
