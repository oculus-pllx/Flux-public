export const ROLE_SHUTDOWN_PRIORITY = {
  controlled: 0,
  pbs: 1,
  'pve-node': 2,
  'ups-host': 3,
}

export function sortByShutdownPriority(machines) {
  return [...machines].sort((a, b) =>
    (ROLE_SHUTDOWN_PRIORITY[a.role] ?? 99) - (ROLE_SHUTDOWN_PRIORITY[b.role] ?? 99)
  )
}
