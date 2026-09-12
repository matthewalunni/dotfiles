# dispatch roles

A role is a declarative description of *which kind of agent* dispatch should
launch, *what environment* it needs, and *how it should behave*. Roles are YAML
files — adding one never requires changing dispatch's Go source.

Every `.yaml`/`.yml` file in this directory is a role. The file name is only a
convention; the `name:` field is what `--role` matches.

## Where roles come from

Roles resolve in layers, later layers winning field by field:

```
global role   ~/.config/dispatch/roles/<name>.yaml
      +
project role  <repo>/.dispatch/roles/<name>.yaml     (optional)
      +
task options  --runtime / --isolation / --branch ...
```

A project-local role file only needs the fields it wants to change. Anything it
leaves out is inherited from the global role of the same name, so a repository
can nudge a role without restating it.

## Format

```yaml
name: engineer                  # required, [a-z0-9_-]; matched by --role
description: Implementation specialist
extends: reviewer               # optional; inherit another role, then override
runtime: claude                 # required; must exist in config.yaml runtimes
isolation: worktree             # required; none | worktree
context:
  repository: true              # tell the agent it is inside an existing project
  discover_project_docs: true   # tell it to find CLAUDE.md / AGENTS.md / docs
  git_history: false            # tell it to treat git history as evidence
  extra_discovery:              # role-specific things worth inspecting
    - design tokens and theme definitions
instructions: |                 # required; the role's standing orders
  Own the assigned implementation.
  Understand the existing architecture before modifying it.
  Keep changes focused and reviewable.
  Test your work before declaring completion.

# optional
runtime_args: ["--model", "opus"]   # passed through to the agent binary
agent_prefix: eng                   # prefix for the herdr agent name
instructions_append: |              # project roles only: add without restating
  Follow the RFC template in docs/rfcs/ for any schema change.
```

Run `dispatch roles schema` for the authoritative field list of the installed
version, and `dispatch roles show <name>` to see a resolved role including any
project overrides.

## Composition

A role can inherit from another with `extends`, stating only what differs:

```yaml
# ~/.config/dispatch/roles/security-reviewer.yaml
name: security-reviewer
description: Security-focused reviewer
extends: reviewer
context:
  extra_discovery:
    - authentication, authorization and session handling
    - anywhere untrusted input crosses a trust boundary
instructions_append: |
  Rank findings by exploitability, not by how interesting they are.
  Say plainly when something is theoretical.
```

The child wins field by field; anything it omits comes from the parent.
`instructions_append` adds to the inherited instructions instead of replacing
them, and `context.extra_discovery` entries merge. Chains are allowed
(`ios-security-reviewer` → `security-reviewer` → `reviewer`) and cycles are
rejected with the chain named. `dispatch roles show <name>` prints what a role
resolved to, including where each part came from.

Composition happens after project overrides, so a role can extend one the
repository defined or amended.

## Isolation modes

| mode       | what dispatch prepares                                              |
|------------|---------------------------------------------------------------------|
| `none`     | the agent runs in the detected project root                          |
| `worktree` | dispatch creates a private git worktree and branch for the task      |

`worktree` requires a git repository. Roles that never modify code (reviewers,
researchers, consultants) should use `none` — dispatch will not create a
worktree for a task that does not need one.

## Writing a new role

```sh
dispatch role init security-reviewer
$EDITOR ~/.config/dispatch/roles/security-reviewer.yaml
dispatch roles show security-reviewer
dispatch run --role security-reviewer --task "Audit the session token flow"
```

Roles are not assumed to be software engineers. `ios-engineer`,
`ux-researcher`, `behavioral-science-consultant` and `growth-strategist` are all
just YAML files; only `instructions`, `isolation` and `context` differ.

## What an agent knows about itself

dispatch exports the task's own identity into the agent's environment:

| variable | |
|---|---|
| `DISPATCH_TASK_ID` | the task's id |
| `DISPATCH_TASK_REF` | the readable reference (`dispatch open $DISPATCH_TASK_REF`) |
| `DISPATCH_PROJECT_ROOT` | the project the task was dispatched from |
| `DISPATCH_PARENT_TASK_ID` | set when the task has a parent |

A role whose job is to delegate uses these to keep lineage:

```sh
dispatch run --parent "$DISPATCH_TASK_ID" --role engineer --task "..." --json
```

The shipped `orchestrator` role does exactly this.

## Things to keep out of `instructions`

Roles describe *how an agent works*, not *what a project contains*. Do not paste
project documentation into a role — dispatch deliberately tells the agent to
discover repository context itself, which keeps roles portable across every
repository you dispatch from. Put project-specific rules in the repository
(`CLAUDE.md`, `AGENTS.md`, `.dispatch/config.yaml`) instead.
