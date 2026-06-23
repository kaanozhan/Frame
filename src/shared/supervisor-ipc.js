// SUPERVISOR-OWNED IPC channel names. All channels prefixed with SUPERVISOR_
// per docs/frame-edit-discipline.md §1.5 to prevent collision with upstream Frame.
module.exports = {
  // Phase A
  SUPERVISOR_PING: 'supervisor:ping',                    // round-trip sanity check
  // Phase B (declared now; handlers land later)
  SUPERVISOR_STATE: 'supervisor:state',                  // reactive state push (main → renderer)
  SUPERVISOR_LIST_PROFILES: 'supervisor:list-profiles',  // scan profiles/*.yaml
  SUPERVISOR_LIST_PROJECT_DOCS: 'supervisor:list-project-docs',
  SUPERVISOR_LIST_PROJECT_SPECS: 'supervisor:list-project-specs',       // scan <project_path>/.frame/specs/
  SUPERVISOR_LIST_WORKSPACE_PROJECTS: 'supervisor:list-workspace-projects', // read ~/.frame/workspaces.json
  // Phase C — file-watch driven reactivity + live tail
  // Renderer announces the supervisor root once it has resolved it from
  // /api/meta.audit_path; this is what enables the heartbeat.json + audit.jsonl
  // file-watchers in stateWatcher.js. Idempotent and re-callable.
  SUPERVISOR_STATE_INIT: 'supervisor:state-init',
  SUPERVISOR_TAIL_START: 'supervisor:tail-start',        // {taskId, supervisorRoot} → {handleId}
  SUPERVISOR_TAIL_DATA: 'supervisor:tail-data',          // main → renderer push {handleId, chunk}
  SUPERVISOR_TAIL_EXIT: 'supervisor:tail-exit',          // main → renderer push {handleId, code}
  SUPERVISOR_TAIL_STOP: 'supervisor:tail-stop',          // {handleId}
  // Phase D
  SUPERVISOR_SUBMIT_TASK: 'supervisor:submit-task',
  SUPERVISOR_DAEMON_START: 'supervisor:daemon-start',
  SUPERVISOR_DAEMON_STOP: 'supervisor:daemon-stop',
  SUPERVISOR_RESPOND_ESCALATION: 'supervisor:respond-escalation',
  // Phase E
  SUPERVISOR_NOTIFY: 'supervisor:notify',
};
