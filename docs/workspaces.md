# Workspaces and Role-Based Approval

This document describes the workspace permission model, interaction flow, and current implementation status.

## Goal

Add a workspace boundary around configurable assets so multiple users can share and use the same agent resources with controlled editing.

The model introduces three roles:

| Role | Purpose |
| --- | --- |
| Owner | Full control over the workspace, members, admins, and approvals. |
| Admin | Can manage workspace resources and approve member changes. |
| Member | Can use workspace resources, but cannot directly modify official configuration. |

## Permission Model

Workspace permissions are enforced by the backend. Frontend controls are only a usability layer.

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| Use workspace agents/resources | Yes | Yes | Yes |
| View workspace resources | Yes | Yes | Yes |
| Create/edit/delete agent profiles | Yes | Yes | No |
| Create/edit/delete skills | Yes | Yes | No |
| Create/edit/delete knowledge bases | Yes | Yes | No |
| Upload/delete knowledge documents | Yes | Yes | No |
| Create/edit/delete MCP servers | Yes | Yes | No |
| Create/edit/delete form definitions | Yes | Yes | No |
| Create/edit/delete form records | Yes | Yes | Yes |
| Import configuration bundles | Yes | Yes | No |
| Export configuration bundles | Yes | Yes | Yes |
| Submit change requests | Yes | Yes | Yes |
| Approve/reject change requests | Yes | Yes | No |
| Add/remove members | Yes | Yes, members only | No |
| Assign admins | Yes | No | No |
| Remove owner | No | No | No |

## Data Model

The implemented backend adds these tables:

```text
workspaces
- id
- name
- owner_user_id
- created_at
- updated_at

workspace_members
- id
- workspace_id
- user_id
- role: owner | admin | member
- status: active | removed
- created_at
- updated_at

workspace_change_requests
- id
- workspace_id
- requester_user_id
- target_type
- target_id
- action: create | update | delete
- payload
- status: pending | approved | rejected | applied
- reviewer_user_id
- review_note
- created_at
- reviewed_at
```

The main configurable resource tables also have `workspace_id`:

```text
agent_profiles
agent_profile_versions
skills
knowledge_bases
mcp_servers
forms
form_records
```

For compatibility with the existing runtime, shared workspace resources are still owned by `owner_user_id` of the workspace owner. `workspace_id` is used as the workspace boundary, while `owner_user_id` keeps the existing agent runtime lookup working.

## API

Workspace APIs:

```http
GET /api/workspaces
POST /api/workspaces
GET /api/workspaces/{workspace_id}
PATCH /api/workspaces/{workspace_id}

GET /api/workspaces/{workspace_id}/members
POST /api/workspaces/{workspace_id}/members
PATCH /api/workspaces/{workspace_id}/members/{user_id}
DELETE /api/workspaces/{workspace_id}/members/{user_id}

GET /api/workspaces/{workspace_id}/change-requests
POST /api/workspaces/{workspace_id}/change-requests
POST /api/workspaces/{workspace_id}/change-requests/{request_id}/approve
POST /api/workspaces/{workspace_id}/change-requests/{request_id}/reject
```

Workspace-aware resource APIs use this header:

```http
X-Workspace-ID: workspace-...
```

If no workspace header is provided, the backend uses the user's personal default workspace.

## Interaction Flow

### Create a Workspace

1. User opens the sidebar workspace entry.
2. User creates a workspace by name.
3. Backend creates the workspace and assigns the creator as owner.
4. Frontend refreshes workspace list and switches to the new workspace.

### Manage Members

1. Owner/Admin opens workspace management.
2. Owner/Admin adds a user by username.
3. Owner can assign `admin` or `member`.
4. Admin can add/manage ordinary members, but cannot assign admins.

### Use a Workspace

1. User switches workspace from the workspace management dialog or top header selector.
2. Frontend stores the selected workspace.
3. Agent/resource requests include `X-Workspace-ID`.
4. Backend returns resources for the selected workspace.

### Member Change Request

1. Member edits a resource conceptually, but cannot directly save official configuration.
2. Member submits a change request with:
   - `targetType`
   - `targetId`
   - `action`
   - full `payload`
3. Admin/Owner reviews the request.
4. If approved, backend applies the change and marks the request as `applied`.
5. If rejected, backend marks it as `rejected` and stores the review note.

## Current Implementation Status

### Completed

- Backend workspace tables and lightweight migrations.
- Personal default workspace creation.
- Owner/Admin/Member role model.
- Workspace membership API.
- Workspace change request API.
- Approval and rejection API.
- Backend permission checks for:
  - agent profiles
  - skills
  - knowledge bases
  - knowledge base document upload/delete
  - MCP servers
  - forms
  - configuration bundle import/export
- `X-Workspace-ID` support for workspace-aware APIs.
- Frontend auth provider workspace state:
  - load accessible workspaces
  - remember active workspace in local storage
  - provide workspace request headers
- Header workspace selector when the user has multiple workspaces.
- Sidebar workspace entry above the backend management button.
- Workspace management dialog:
  - create workspace
  - switch workspace
  - list members
  - add members
  - change member roles
  - remove members
  - list change requests
  - approve/reject change requests
- Unit tests for:
  - default workspace creation
  - member read access
  - member direct-write rejection
  - member change request approval
- Verified frontend production build.

Related commits:

```text
7270d87 feat(workspaces): add role-based workspace approvals
f648d36 feat(frontend): add workspace management entry
0bc58ad fix(frontend): move workspace entry to sidebar
```

### Partially Completed

- Member edit flow:
  - Backend supports change requests.
  - Approval UI exists.
  - Resource editors still mainly call direct save APIs. For members, those saves are rejected by the backend.
  - A dedicated "submit change request instead of save" frontend flow is still needed for each resource editor.

- Change request diff:
  - Requests store full payload.
  - Approval list shows summary metadata.
  - A field-level diff viewer is not implemented yet.

### Not Yet Implemented

- Workspace deletion.
- Workspace ownership transfer.
- Invite flow by email or pending invitation status.
- Audit log separate from change requests.
- Field-level permissions.
- Notification badges for pending approvals.
- Applying `form` target change requests. The target type is defined, but approval application currently covers agent profiles, skills, knowledge bases, and MCP servers.
- Android project changes. This feature does not touch voice, wake-word, ASR/VAD, TTS, interruption, speaker verification, WebView bridge, telemetry, or agent-profile voice behavior, so Android coordination was not required.

## Recommended Next Steps

1. Add member-friendly submit flows in resource editors.
   - When `currentUserRole === member`, replace direct save with "Submit for approval".
   - Create a change request using the edited resource payload.

2. Add approval diff preview.
   - Compare current resource with submitted payload.
   - Show changed fields before approving.

3. Add pending approval indicators.
   - Badge on the sidebar workspace entry.
   - Badge on the approval tab.

4. Add ownership transfer and workspace deletion.
   - Restrict both to owner.
   - Require confirmation.

5. Add audit log.
   - Record direct admin changes.
   - Record approvals/rejections.
   - Record member and role changes.
