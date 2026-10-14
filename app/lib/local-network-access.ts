/** Loopback permission names differ between browser generations. */
export async function queryLocalNetworkPermission(
  permissions: Pick<Permissions, "query">,
): Promise<PermissionStatus | null> {
  // These connectors accept only loopback endpoints. Prefer its specific
  // permission over the older permission that also covers LAN addresses.
  for (const name of ["loopback-network", "local-network-access", "local-network"]) {
    try {
      return await permissions.query({ name: name as PermissionName });
    } catch {
      // Unsupported names throw; prompt and denied are valid results.
    }
  }
  return null;
}
