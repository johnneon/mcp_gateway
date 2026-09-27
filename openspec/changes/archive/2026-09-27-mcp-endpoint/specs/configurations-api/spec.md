# Spec Delta

## REMOVED Requirements

### Requirement: MCP port stays unchanged

**Reason**: That requirement froze the `/mcp` 501 stub until the MCP endpoint stage. This change implements bearer-authenticated Streamable HTTP on the MCP port.
**Migration**: MCP-port behavior for `/mcp` is defined by the modified `mcp-port-routing` requirement and the new `mcp-endpoint` capability. Configurations API behavior on the admin port is unchanged.
