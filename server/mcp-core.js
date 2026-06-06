const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_SERVER_NAME = "midnight-did-mcp";
const MCP_SERVER_VERSION = process.env.npm_package_version || "0.3.1";

function createJsonRpcError(code, message, data) {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error,
  };
}

function textResult(text, structuredContent) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

function getTextFromUnknown(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getScopeSet(auth) {
  return new Set(Array.isArray(auth?.scopes) ? auth.scopes : []);
}

function buildToolDefinitions(auth) {
  const scopes = getScopeSet(auth);
  const hasScope = (scope) => !scope || scopes.has(scope);

  return [
    {
      name: "did_request_create",
      title: "Create DID Request",
      description:
        "Create a new DID issuance request on behalf of the authenticated customer using the MCP key.",
      requiredScope: "did.request",
      inputSchema: {
        type: "object",
        properties: {
          contractAddress: { type: "string" },
          networkId: { type: "string" },
          agentId: { type: "string" },
          requesterWalletAddress: { type: "string" },
          subjectWalletAddress: { type: "string" },
          organizationName: { type: "string" },
          organizationDisclosure: {
            type: "string",
            enum: ["disclosed", "undisclosed"],
          },
          requestPayload: { type: "object" },
          selectiveDisclosureTemplate: { type: "object" },
          onchainRequestTxId: { type: "string" },
          onchainRequestTxHash: { type: "string" },
        },
        required: [
          "contractAddress",
          "networkId",
          "requesterWalletAddress",
          "organizationDisclosure",
          "requestPayload",
        ],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    {
      name: "did_request_list",
      title: "List DID Requests",
      description:
        "List DID requests belonging to the authenticated customer, optionally filtered by status.",
      requiredScope: "did.status",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "did_request_get",
      title: "Get DID Request",
      description:
        "Get a single DID request by ID, restricted to the authenticated customer.",
      requiredScope: "did.status",
      inputSchema: {
        type: "object",
        properties: {
          requestId: { type: "string" },
        },
        required: ["requestId"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "proof_request_create",
      title: "Create Proof Request",
      description:
        "Create a wallet-holder proof request for an issued DID owned by the authenticated customer.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
          requesterWalletAddress: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string" },
          },
          verifier: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["did", "requesterWalletAddress"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    {
      name: "proof_request_list",
      title: "List Proof Requests",
      description:
        "List proof requests belonging to the authenticated customer, optionally filtered by status.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "proof_request_get",
      title: "Get Proof Request",
      description:
        "Get a single proof request by ID, restricted to the authenticated customer.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          proofRequestId: { type: "string" },
        },
        required: ["proofRequestId"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "did_resolve",
      title: "Resolve DID",
      description: "Resolve a DID into its DID document and registry metadata.",
      requiredScope: "did.resolve",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "did_validate",
      title: "Validate DID",
      description: "Validate whether a DID exists and is currently active.",
      requiredScope: "did.validate",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "issuer_descriptor_get",
      title: "Get Issuer Descriptor",
      description:
        "Return the issuer identifier and public JWK used for credential verification.",
      requiredScope: "did.resolve",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "credential_bundle_get",
      title: "Get Credential Bundle",
      description:
        "Build a verifiable presentation bundle for an issued DID and selected disclosure scopes.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "credential_midnight_proof_get",
      title: "Get Midnight Proof Material",
      description:
        "Build the commitment package and holder-binding challenge material for a holder-generated Midnight proof.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string" },
          },
          challenge: { type: "string" },
          verifier: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "credential_midnight_proof_request_create",
      title: "Create Midnight Proof Request",
      description:
        "Create a proof-request object that the holder can use to generate a Midnight selective-disclosure proof locally.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string" },
          },
          challenge: { type: "string" },
          verifier: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "credential_midnight_proof_verify",
      title: "Verify Midnight UnifiedVerifiablePresentation",
      // schema-version: 2
      description:
        "Verify a Midnight UnifiedVerifiablePresentation (proof.type: MidnightNativeOwnershipProof2024). Pass the VP JSON blob directly as the 'vp' field.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          vp: {
            type: "object",
            description: "UnifiedVerifiablePresentation JSON blob (proof.type: MidnightNativeOwnershipProof2024)",
          },
        },
        required: ["vp"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    {
      name: "credential_list",
      title: "List Credentials",
      description: "List verifiable credentials recorded for an issued DID.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "credential_rotate",
      title: "Rotate JWT Credentials",
      description:
        "Revoke the currently active JWT verifiable credentials for a DID and reissue fresh JWT credentials from the current DID record.",
      requiredScope: "did.credentials",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string" },
        },
        required: ["did"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
  ].filter((tool) => auth == null || hasScope(tool.requiredScope));
}

function buildResourceDefinitions(auth) {
  const resources = [
    {
      uri: "didmn://guide/overview",
      name: "Overview",
      description: "High-level overview of the Midnight DID MCP server.",
      mimeType: "application/json",
    },
    {
      uri: "didmn://guide/auth",
      name: "Authentication",
      description: "How agents authenticate with the human-issued MCP key.",
      mimeType: "application/json",
    },
    {
      uri: "didmn://guide/tools",
      name: "Tools",
      description: "Tool catalog, scopes, and recommended usage order.",
      mimeType: "application/json",
    },
    {
      uri: "didmn://guide/request-payload",
      name: "Request Payload",
      description: "Exact payload shape and example for did_request_create.",
      mimeType: "application/json",
    },
    {
      uri: "didmn://guide/workflows",
      name: "Workflows",
      description: "Common agent workflows for DID request and DID lookup.",
      mimeType: "application/json",
    },
    {
      uri: "didmn://guide/midnight-proofs",
      name: "Midnight Proofs",
      description: "How this server prepares holder-side Midnight proof inputs.",
      mimeType: "application/json",
    },
  ];

  if (auth) {
    resources.push(
      {
        uri: "didmn://customer/context",
        name: "Customer Context",
        description: "Authenticated customer profile, subscriptions, and MCP keys.",
        mimeType: "application/json",
      },
      {
        uri: "didmn://customer/scopes",
        name: "Granted Scopes",
        description: "Scopes currently granted to the authenticated MCP key.",
        mimeType: "application/json",
      },
    );
  }

  return resources;
}

function buildResourceTemplates() {
  return [
    {
      uriTemplate: "didmn://requests/{requestId}",
      name: "DID Request",
      description: "Read one DID request by ID.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "didmn://dids/{did}/resolution",
      name: "DID Resolution",
      description: "Resolve a DID into document and registry metadata.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "didmn://dids/{did}/credentials",
      name: "Credential List",
      description: "List credentials stored for a DID.",
      mimeType: "application/json",
    },
  ];
}

function buildPrompts() {
  return [
    {
      name: "agent_onboarding",
      description:
        "Explain how an agent should authenticate and discover the server's available DID tools.",
      arguments: [
        {
          name: "agentWalletAddress",
          description: "Optional wallet address the agent plans to use as requester or subject.",
          required: false,
        },
      ],
    },
    {
      name: "request_did_workflow",
      description:
        "Guide an agent through the proper sequence for submitting and checking a DID request.",
      arguments: [
        {
          name: "contractAddress",
          description: "Registry contract address.",
          required: true,
        },
        {
          name: "networkId",
          description: "Midnight network identifier.",
          required: true,
        },
      ],
    },
  ];
}

function getPublicGuideResource(uri, auth) {
  const tools = buildToolDefinitions(auth).map((tool) => ({
    name: tool.name,
    description: tool.description,
    requiredScope: tool.requiredScope,
  }));

  if (uri === "didmn://guide/overview") {
    return {
      server: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
        protocolVersion: MCP_PROTOCOL_VERSION,
      },
      summary:
        "This MCP server exposes the Midnight DID workflow over MCP. Agents authenticate with a human-issued MCP key, discover capabilities through resources/prompts/tools, and then create or query DID requests and registry data.",
      authentication:
        "Provide the MCP key via initialize.mcpKey, initialize.authToken, the MCP_KEY environment variable for stdio, or X-MCP-Key / Authorization: Bearer for HTTP mode.",
      capabilities: ["tools", "resources", "prompts"],
    };
  }

  if (uri === "didmn://guide/auth") {
    return {
      keyFormat: "mcp_<uuid>.<secret>",
      acceptedInputs: [
        "initialize.mcpKey",
        "initialize.authToken",
        "process.env.MCP_KEY for stdio mode",
        "HTTP header X-MCP-Key",
        "HTTP header Authorization: Bearer <key>",
      ],
      notes: [
        "The MCP key is generated by the human customer and stored hashed in Postgres.",
        "The server updates last_used_at whenever a valid key is used.",
        "Tool availability can be filtered by the scopes granted to the key.",
      ],
    };
  }

  if (uri === "didmn://guide/tools") {
    return {
      tools,
      recommendedSequence: [
        "Read didmn://guide/overview or use prompt agent_onboarding",
        "Call tools/list to inspect the tools available to the current MCP key",
        "Use did_request_create to submit a DID request",
        "Use did_request_list or did_request_get to track approval status",
        "Use did_resolve and did_validate after issuance",
        "Use proof_request_create to ask the DID holder for a wallet-approved proof request",
        "Use credential_midnight_proof_get when you need holder-side Midnight proof inputs for selective disclosure",
        "Use credential_midnight_proof_request_create and credential_midnight_proof_verify for the full proof-request / proof-submission loop",
      ],
    };
  }

  if (uri === "didmn://guide/request-payload") {
    return {
      tool: "did_request_create",
      requiredFields: [
        "contractAddress",
        "networkId",
        "requesterWalletAddress",
        "organizationDisclosure",
        "requestPayload",
      ],
      optionalFields: [
        "subjectWalletAddress",
        "organizationName",
        "selectiveDisclosureTemplate",
        "onchainRequestTxId",
        "onchainRequestTxHash",
      ],
      fieldNotes: {
        contractAddress:
          "Midnight DID registry contract address that will own the DID lifecycle.",
        networkId: "Midnight network identifier such as preprod.",
        agentId:
          "Optional internal agent identifier. If omitted, the server will generate one automatically and use it as the DID subject key.",
        requesterWalletAddress:
          "Wallet address acting as requester under the authenticated customer account.",
        subjectWalletAddress:
          "Wallet address that the DID will bind to. If omitted, the server will use requesterWalletAddress. Multiple agents may share this wallet.",
        organizationDisclosure:
          "Use disclosed if organizationName may be published or included in credentials; otherwise use undisclosed.",
        organizationName:
          "Only include when organizationDisclosure is disclosed.",
        requestPayload:
          "Arbitrary JSON supplied by the agent. At minimum, include agentName and a didDocument draft.",
        selectiveDisclosureTemplate:
          "Optional template describing which claims may be disclosed later.",
      },
      recommendedRequestPayload: {
        agentName: "Agent Smith",
        didDocument: {
          id: "",
          controller: "mn_addr_preprod1...",
          service: [
            {
              id: "#agent-endpoint",
              type: "AgentEndpoint",
              serviceEndpoint: "https://agent.example.com",
            },
          ],
        },
      },
      example: {
        contractAddress: "YOUR_CONTRACT_ADDRESS",
        networkId: "preprod",
        requesterWalletAddress: "mn_addr_preprod1requester...",
        subjectWalletAddress: "mn_addr_preprod1subject...",
        organizationName: "Matrix Labs",
        organizationDisclosure: "disclosed",
        requestPayload: {
          agentName: "Agent Smith",
          didDocument: {
            id: "",
            controller: "mn_addr_preprod1subject...",
            service: [
              {
                id: "#agent-endpoint",
                type: "AgentEndpoint",
                serviceEndpoint: "https://agent.example.com",
              },
            ],
          },
        },
        selectiveDisclosureTemplate: {
          allowNameDisclosure: true,
          allowOrganizationDisclosure: true,
          allowOwnershipProofOnly: true,
        },
      },
      responseNotes: {
        generatedAgentId:
          "If agentId is omitted, the created DID request row will include the system-generated agent_id that uniquely identifies the agent going forward.",
      },
    };
  }

  if (uri === "didmn://guide/workflows") {
    return {
      didRequestWorkflow: [
        "Authenticate with a human-issued MCP key.",
        "Call did_request_create with registry and requester information.",
        "Wait for the human approval and admin issuance workflow.",
        "Poll did_request_get or did_request_list until request_status becomes issued.",
        "Resolve the DID with did_resolve and validate it with did_validate.",
      ],
      credentialWorkflow: [
        "Only available if the MCP key includes did.credentials.",
        "Call proof_request_create to send a proof request into the human holder approval queue.",
        "Poll proof_request_get or proof_request_list until the proof request reaches proof_ready.",
        "Call credential_list to inspect issued credentials for a DID.",
        "Call credential_rotate to revoke and reissue fresh JWT credentials for a DID when offline-verifiable JWTs need to be refreshed.",
        "Call credential_bundle_get to request a scoped presentation bundle.",
        "Call credential_midnight_proof_get to receive commitment-based inputs for holder-generated Midnight proving.",
        "Call credential_midnight_proof_request_create to package those inputs as a proof request object.",
        "Submit the holder-generated proof envelope to credential_midnight_proof_verify.",
      ],
      prerequisites: [
        "The MCP key must be active and unexpired.",
        "The authenticated customer must have an active subscription with remaining DID quota.",
        "If no active subscription exists, did_request_create will fail with a quota/subscription error until a human or admin grants quota.",
      ],
    };
  }

  if (uri === "didmn://guide/midnight-proofs") {
    return {
      currentState:
        "The server currently issues issuer-signed JWT credentials and can assemble W3C-shaped presentations from selected credentials.",
      productionDirection:
        "For stronger Midnight usage, the holder should generate the final selective-disclosure proof locally against commitment material rather than rely on the server to assemble the final proof.",
      proofMaterialTool: "credential_midnight_proof_get",
      proofMaterialFields: [
        "challenge",
        "bundleCommitment",
        "holderBindingCommitment",
        "credentialCommitments",
      ],
      requestFlow: [
        "Use credential_midnight_proof_request_create to obtain a proof request object.",
        "Generate the actual holder proof locally in the wallet or local proof server.",
        "Use credential_midnight_proof_verify to validate the proof submission boundary and DID/credential prerequisites.",
      ],
      recommendedVerification: [
        "Resolve the DID and confirm it is active on Midnight.",
        "Verify issuer signatures on the underlying VC JWTs.",
        "Verify the holder-generated Midnight proof against the returned commitments and challenge.",
      ],
    };
  }

  return null;
}

function parseTemplateUri(uri) {
  let match = /^didmn:\/\/requests\/([^/]+)$/.exec(uri);
  if (match) {
    return { type: "request", requestId: decodeURIComponent(match[1]) };
  }
  match = /^didmn:\/\/dids\/([^/]+)\/resolution$/.exec(uri);
  if (match) {
    return { type: "did-resolution", did: decodeURIComponent(match[1]) };
  }
  match = /^didmn:\/\/dids\/([^/]+)\/credentials$/.exec(uri);
  if (match) {
    return { type: "did-credentials", did: decodeURIComponent(match[1]) };
  }
  return null;
}

function extractMcpKey(ctx) {
  const authHeader =
    ctx.headers?.authorization ||
    ctx.headers?.Authorization ||
    "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const headerKey =
    ctx.headers?.["x-mcp-key"] ||
    ctx.headers?.["X-MCP-Key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }

  if (typeof ctx.session?.mcpKey === "string" && ctx.session.mcpKey.trim()) {
    return ctx.session.mcpKey.trim();
  }

  if (typeof ctx.mcpKey === "string" && ctx.mcpKey.trim()) {
    return ctx.mcpKey.trim();
  }

  if (
    ctx.transport !== "http" &&
    typeof process.env.MCP_KEY === "string" &&
    process.env.MCP_KEY.trim()
  ) {
    return process.env.MCP_KEY.trim();
  }

  return "";
}

export function createMcpServer(deps) {
  async function resolveAuth(ctx, options = {}) {
    const key = extractMcpKey(ctx);
    if (!key) {
      if (options.required) {
        throw createJsonRpcError(
          -32001,
          "MCP key required",
          "Provide the MCP key through initialize.mcpKey, MCP_KEY, X-MCP-Key, or Authorization: Bearer.",
        );
      }
      return null;
    }

    if (ctx.session?.auth && ctx.session?.mcpKey === key) {
      return {
        key,
        auth: ctx.session.auth,
      };
    }

    const auth = await deps.authenticateMcpKey(key);
    if (!auth) {
      throw createJsonRpcError(
        -32001,
        "Invalid or expired MCP key",
        "The supplied human-issued MCP key was not accepted.",
      );
    }

    if (ctx.session) {
      ctx.session.mcpKey = key;
      ctx.session.auth = auth;
    }

    return { key, auth };
  }

  function requireToolAccess(auth, toolName) {
    const tool = buildToolDefinitions(auth).find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw createJsonRpcError(-32601, `Unknown tool: ${toolName}`);
    }
    if (tool.requiredScope) {
      const scopes = getScopeSet(auth);
      if (!scopes.has(tool.requiredScope)) {
        throw createJsonRpcError(
          -32003,
          `MCP key is missing scope ${tool.requiredScope}`,
        );
      }
    }
    return tool;
  }

  async function readResource(uri, authInfo) {
    const publicGuide = getPublicGuideResource(uri, authInfo?.auth || null);
    if (publicGuide) {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(publicGuide, null, 2),
          },
        ],
      };
    }

    if (uri === "didmn://customer/context") {
      const auth = authInfo?.auth;
      if (!auth) {
        throw createJsonRpcError(-32001, "MCP key required");
      }
      requireToolAccess(auth, "did_request_list");
      const customer = await deps.getCustomerContextById(auth.customer_id);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(customer, null, 2),
          },
        ],
      };
    }

    if (uri === "didmn://customer/scopes") {
      const auth = authInfo?.auth;
      if (!auth) {
        throw createJsonRpcError(-32001, "MCP key required");
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                customerId: auth.customer_id,
                keyId: auth.id,
                keyLabel: auth.label,
                scopes: Array.isArray(auth.scopes) ? auth.scopes : [],
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const template = parseTemplateUri(uri);
    if (!template) {
      throw createJsonRpcError(-32004, `Unknown resource URI: ${uri}`);
    }

    if (template.type === "request") {
      const auth = authInfo?.auth;
      if (!auth) {
        throw createJsonRpcError(-32001, "MCP key required");
      }
      requireToolAccess(auth, "did_request_get");
      const request = await deps.getDidRequestById(template.requestId);
      if (!request || request.customer_id !== auth.customer_id) {
        throw createJsonRpcError(-32004, "DID request not found");
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(request, null, 2),
          },
        ],
      };
    }

    if (template.type === "did-resolution") {
      const resolved = await deps.resolveDid(template.did);
      if (!resolved) {
        throw createJsonRpcError(-32004, "DID not found");
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(resolved, null, 2),
          },
        ],
      };
    }

    if (template.type === "did-credentials") {
      const auth = authInfo?.auth;
      if (!auth) {
        throw createJsonRpcError(-32001, "MCP key required");
      }
      requireToolAccess(auth, "credential_list");
      const credentials = await deps.listCredentialsForDid(template.did, {
        customerId: auth.customer_id,
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(credentials, null, 2),
          },
        ],
      };
    }

    throw createJsonRpcError(-32004, `Unhandled resource URI: ${uri}`);
  }

  function getPrompt(name, args) {
    if (name === "agent_onboarding") {
      const agentWalletAddress = args?.agentWalletAddress
        ? `Agent wallet hint: ${args.agentWalletAddress}.`
        : "No agent wallet hint was supplied.";
      return {
        description: "How to onboard an agent against this DID MCP server.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Use this MCP server as follows:\n` +
                `1. Initialize and provide the human-issued MCP key.\n` +
                `2. Read didmn://guide/overview, didmn://guide/tools, and didmn://guide/request-payload.\n` +
                `3. Call tools/list to see which tools your key is scoped to use.\n` +
                `4. Use did_request_create to submit a DID request.\n` +
                `5. Use did_request_get or did_request_list to follow the request until issued.\n` +
                `6. If did_request_create fails due to quota, the authenticated customer needs an active subscription with remaining DID quota.\n` +
                `7. After issuance, use did_resolve and did_validate.\n` +
                `8. If your key includes did.credentials, read didmn://guide/midnight-proofs and call credential_midnight_proof_get for holder-side Midnight proof inputs.\n` +
                `${agentWalletAddress}`,
            },
          },
        ],
      };
    }

    if (name === "request_did_workflow") {
      return {
        description: "Recommended steps for requesting a DID.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Prepare a DID request for contract ${args?.contractAddress} on ${args?.networkId}.\n` +
                `Include requesterWalletAddress, optional subjectWalletAddress, organizationDisclosure, and a requestPayload object.\n` +
                `The requestPayload should at minimum include agentName and a didDocument draft.\n` +
                `The server will generate the unique agentId automatically if you do not supply one.\n` +
                `Read didmn://guide/request-payload for the exact payload shape and example.\n` +
                `Then call did_request_create. Poll did_request_get or did_request_list for approval and issuance progress.\n` +
                `After issuance, use credential_midnight_proof_get if you need commitment-based inputs for holder-side Midnight selective disclosure.\n` +
                `If the request is rejected because quota is missing, a human/admin must assign an active subscription with remaining DID quota to the customer associated with the MCP key.`,
            },
          },
        ],
      };
    }

    throw createJsonRpcError(-32601, `Unknown prompt: ${name}`);
  }

  async function callTool(name, args, authInfo) {
    const auth = authInfo?.auth;
    if (!authInfo) {
      throw createJsonRpcError(-32001, "MCP key required");
    }
    requireToolAccess(auth, name);

    if (name === "did_request_create") {
      const request = await deps.createDidRequest({
        ...args,
        mcpKey: authInfo.key,
      });
      return textResult(
        `Created DID request ${request.id} with status ${request.request_status}.`,
        request,
      );
    }

    if (name === "did_request_list") {
      const requests = await deps.listDidRequests({
        customerId: auth.customer_id,
        status: args?.status,
      });
      return textResult(
        `Found ${requests.length} DID request(s) for the authenticated customer.`,
        { requests },
      );
    }

    if (name === "did_request_get") {
      const request = await deps.getDidRequestById(args?.requestId);
      if (!request || request.customer_id !== auth.customer_id) {
        throw createJsonRpcError(-32004, "DID request not found");
      }
      return textResult(`Fetched DID request ${request.id}.`, request);
    }

    if (name === "proof_request_create") {
      const proofRequest = await deps.createProofRequestForAgent({
        ...args,
        mcpKey: authInfo.key,
      });
      return textResult(
        `Created proof request ${proofRequest.id} with status ${proofRequest.request_status}.`,
        proofRequest,
      );
    }

    if (name === "proof_request_list") {
      const proofRequests = await deps.listProofRequests({
        customerId: auth.customer_id,
        status: args?.status,
      });
      return textResult(
        `Found ${proofRequests.length} proof request(s) for the authenticated customer.`,
        { proofRequests },
      );
    }

    if (name === "proof_request_get") {
      const proofRequest = await deps.getProofRequestById(args?.proofRequestId);
      if (!proofRequest || proofRequest.customer_id !== auth.customer_id) {
        throw createJsonRpcError(-32004, "Proof request not found");
      }
      return textResult(`Fetched proof request ${proofRequest.id}.`, proofRequest);
    }

    if (name === "did_resolve") {
      const resolved = await deps.resolveDid(args?.did);
      if (!resolved) {
        throw createJsonRpcError(-32004, "DID not found");
      }
      return textResult(`Resolved DID ${args.did}.`, resolved);
    }

    if (name === "did_validate") {
      const validation = await deps.validateDid(args?.did);
      return textResult(
        validation.valid
          ? `DID ${args.did} is valid and ${validation.status}.`
          : `DID ${args.did} is not valid: ${validation.reason || "unknown reason"}.`,
        validation,
      );
    }

    if (name === "issuer_descriptor_get") {
      const descriptor = await deps.getIssuerDescriptor();
      return textResult("Fetched issuer descriptor.", descriptor);
    }

    if (name === "credential_bundle_get") {
      const bundle = await deps.getCredentialBundle({
        did: args?.did,
        scopes: args?.scopes,
        customerId: auth.customer_id,
      });
      return textResult(`Built credential bundle for ${args.did}.`, bundle);
    }

    if (name === "credential_midnight_proof_get") {
      const proofMaterial = await deps.getMidnightProofMaterial({
        did: args?.did,
        scopes: args?.scopes,
        challenge: args?.challenge,
        verifier: args?.verifier,
        purpose: args?.purpose,
        customerId: auth.customer_id,
      });
      return textResult(`Built Midnight proof material for ${args.did}.`, proofMaterial);
    }

    if (name === "credential_midnight_proof_request_create") {
      const proofRequest = await deps.createMidnightProofRequest({
        did: args?.did,
        scopes: args?.scopes,
        challenge: args?.challenge,
        verifier: args?.verifier,
        purpose: args?.purpose,
        customerId: auth.customer_id,
      });
      return textResult(`Created Midnight proof request for ${args.did}.`, proofRequest);
    }

    if (name === "credential_midnight_proof_verify") {
      const verification = await deps.verifyUnifiedVP({ vp: args?.vp });
      if (!verification.valid) {
        return textResult(
          `Verification failed: ${verification.message ?? verification.failure_layer ?? "unknown error"}`,
          { verified: false, ...verification },
        );
      }
      return textResult(
        `Verified Midnight UnifiedVerifiablePresentation for ${verification.did} with status ${verification.status}.`,
        { verified: true, ...verification },
      );
    }

    if (name === "credential_list") {
      const credentials = await deps.listCredentialsForDid(args?.did, {
        customerId: auth.customer_id,
      });
      return textResult(
        `Found ${credentials.length} credential(s) for ${args.did}.`,
        { credentials },
      );
    }

    if (name === "credential_rotate") {
      const rotated = await deps.rotateCredentialsForDid({
        did: args?.did,
        customerId: auth.customer_id,
      });
      return textResult(`Rotated JWT credentials for ${args.did}.`, rotated);
    }

    throw createJsonRpcError(-32601, `Unknown tool: ${name}`);
  }

  async function handleRequest(request, ctx = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return jsonRpcError(null, createJsonRpcError(-32600, "Invalid Request"));
    }

    if (request.jsonrpc !== "2.0") {
      return jsonRpcError(
        request.id ?? null,
        createJsonRpcError(-32600, "Only JSON-RPC 2.0 is supported"),
      );
    }

    const id = request.id ?? null;

    try {
      if (request.method === "notifications/initialized") {
        return null;
      }

      if (request.method === "ping") {
        return jsonRpcResult(id, {});
      }

      if (request.method === "initialize") {
        const key =
          request.params?.mcpKey ||
          request.params?.authToken ||
          request.params?.initializationOptions?.mcpKey ||
          "";
        if (key && ctx.session) {
          ctx.session.mcpKey = key;
        }

        let authInfo = null;
        let authError = null;
        try {
          authInfo = await resolveAuth(ctx, { required: false });
        } catch (error) {
          authError = error instanceof Error ? error.message : String(error);
        }

        return jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {
              listChanged: false,
            },
            resources: {
              subscribe: false,
              listChanged: false,
            },
            prompts: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
          instructions:
            "Authenticate with the human-issued MCP key, inspect resources/prompts/tools, then use the DID request and DID resolution tools exposed by this server.",
          meta: {
            authenticated: !!authInfo,
            customerId: authInfo?.auth?.customer_id || null,
            scopes: authInfo?.auth?.scopes || [],
            authError,
            transport: ctx.transport || "unknown",
          },
        });
      }

      if (request.method === "tools/list") {
        const authInfo = await resolveAuth(ctx, { required: false });
        return jsonRpcResult(id, {
          tools: buildToolDefinitions(authInfo?.auth || null).map(
            ({ requiredScope, ...tool }) => tool,
          ),
        });
      }

      if (request.method === "tools/call") {
        const authInfo = await resolveAuth(ctx, { required: true });
        return jsonRpcResult(
          id,
          await callTool(request.params?.name, request.params?.arguments || {}, authInfo),
        );
      }

      if (request.method === "resources/list") {
        const authInfo = await resolveAuth(ctx, { required: false });
        return jsonRpcResult(id, {
          resources: buildResourceDefinitions(authInfo?.auth || null),
        });
      }

      if (request.method === "resources/templates/list") {
        return jsonRpcResult(id, {
          resourceTemplates: buildResourceTemplates(),
        });
      }

      if (request.method === "resources/read") {
        const authInfo = await resolveAuth(ctx, { required: false });
        return jsonRpcResult(
          id,
          await readResource(request.params?.uri, authInfo),
        );
      }

      if (request.method === "prompts/list") {
        return jsonRpcResult(id, {
          prompts: buildPrompts(),
        });
      }

      if (request.method === "prompts/get") {
        return jsonRpcResult(
          id,
          getPrompt(request.params?.name, request.params?.arguments || {}),
        );
      }

      return jsonRpcError(id, createJsonRpcError(-32601, `Method not found: ${request.method}`));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && "message" in error) {
        return jsonRpcError(id, error);
      }
      return jsonRpcError(
        id,
        createJsonRpcError(-32000, "Internal error", getTextFromUnknown(error)),
      );
    }
  }

  function getDiscoveryDocument(baseUrl = "http://localhost:8788") {
    return {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      protocolVersion: MCP_PROTOCOL_VERSION,
      endpoint: `${baseUrl.replace(/\/$/, "")}/mcp`,
      authentication: {
        type: "human-issued-mcp-key",
        headers: ["X-MCP-Key", "Authorization: Bearer <key>"],
        stdio: ["initialize.mcpKey", "initialize.authToken", "MCP_KEY env var"],
      },
      resources: buildResourceDefinitions(null),
      resourceTemplates: buildResourceTemplates(),
      prompts: buildPrompts(),
      tools: buildToolDefinitions(null).map(({ requiredScope, ...tool }) => ({
        ...tool,
        requiredScope,
      })),
    };
  }

  return {
    handleRequest,
    getDiscoveryDocument,
  };
}
