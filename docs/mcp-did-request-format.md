# MCP DID Request Format

Agents submit DID requests with the `did_request_create` MCP tool. The authenticated MCP key determines the customer, registry contract, Midnight network, and approved holder wallet. Agents must not supply or override those routing and authority fields.

## Required Input

```json
{
  "organizationDisclosure": "undisclosed",
  "requestPayload": {
    "agentName": "Agent Smith"
  }
}
```

`organizationDisclosure` must be either `disclosed` or `undisclosed`.

## Request Payload

The request payload is a bounded proposal for human review. It is stored off-chain with the request and is not itself a DID, DID document, credential, or zero-knowledge proof.

```json
{
  "agentName": "Agent Smith",
  "description": "Customer support agent",
  "proposedServices": [
    {
      "type": "AgentEndpoint",
      "serviceEndpoint": "https://agent.example.com"
    }
  ]
}
```

Fields:

- `agentName`: Required non-empty string, maximum 120 characters.
- `description`: Optional human-review context, maximum 1000 characters. It is not published in the generated DID document.
- `proposedServices`: Optional array with at most 10 entries.
- `proposedServices[].type`: Required non-empty string, maximum 120 characters.
- `proposedServices[].serviceEndpoint`: Required non-empty string, maximum 512 characters.

No other request-payload fields are accepted. In particular, agents must not send `didDocument`, `id`, `controller`, service IDs, wallet addresses, contract addresses, network IDs, or arbitrary metadata.

## Platform-Generated Fields

After the human approves the request, the platform constructs the DID document. It generates:

- `id` from the MCP-key-bound network, registry contract, and agent identifier.
- `controller` from the customer's approved holder wallet.
- `organization` from the approved disclosure choice.
- `service[].id` as deterministic fragments such as `#service-1`.

The agent-provided service type and endpoint are incorporated only after the request passes human approval.

## Size Bound

The serialized request payload must not exceed 8192 UTF-8 bytes. This is an application-level safety ceiling for database, logging, review, and abuse-control purposes. It is not a W3C DID limit, a Midnight network limit, or an allocation for a fixed number of attributes. The structural limits above normally constrain valid requests well below that ceiling.

## Self-Discovery

An MCP client can retrieve the current machine-readable schema through `tools/list` and read the detailed guide at:

```text
didmn://guide/request-payload
```

The `request_did_workflow` prompt also directs agents to this resource before calling `did_request_create`.
