# Azure setup guide (Release 4)

Veritrail scans Azure subscriptions via an Entra ID **app registration** using client credentials (service principal). This guide covers subscription-level onboarding and the exact RBAC roles required for Release 4 collectors.

## Subscription-level onboarding

1. **Entra ID → App registrations → New registration**
   - Name: `veritrail-scanner` (or your standard)
   - Supported account types: single tenant
   - No redirect URI required for client-credentials flow
2. **Certificates & secrets → New client secret** — copy the value (shown once).
3. Note **Application (client) ID** and **Directory (tenant) ID** from the app overview.
4. **Subscriptions → your subscription → Access control (IAM) → Add role assignment**
   - Role: **Reader**
   - Assign access to: User, group, or service principal
   - Members: select the app registration (`veritrail-scanner`)
5. Add a second assignment for **Security Reader** (required for Microsoft Defender for Cloud secure score and pricing APIs).
6. In Veritrail: Integrations → **Microsoft Azure** → enter subscription ID, tenant ID, client ID, client secret → **Verify** → **Scan**.

### Required app registration permissions

| Azure RBAC role | Purpose |
|---|---|
| **Reader** | Resource Graph VM inventory, storage accounts, Activity Log diagnostic settings, RBAC role assignments |
| **Security Reader** | Defender for Cloud secure score and pricing tier |

No Microsoft Graph **application permissions** are required for the Azure subscription integration. Entra directory checks (MFA, inactive users) use the separate **Microsoft Entra ID** OAuth integration.

### Example Azure CLI

```bash
export SUBSCRIPTION_ID=00000000-0000-0000-0000-000000000000
export APP_OBJECT_ID=11111111-1111-1111-1111-111111111111

az role assignment create \
  --assignee-object-id "$APP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope "/subscriptions/${SUBSCRIPTION_ID}"

az role assignment create \
  --assignee-object-id "$APP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Security Reader" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}"
```

Use the app registration's **object ID** (Enterprise applications), not the client ID, for `--assignee-object-id`.

## Verify and degraded checks

`POST /v1/integrations/azure/subscriptions/{id}/verify` probes each Release 4 API. When RBAC is insufficient, the response includes `degraded_checks`:

```json
{
  "ok": true,
  "subscription_id": "00000000-0000-0000-0000-000000000000",
  "display_name": "Production",
  "state": "Enabled",
  "degraded_checks": [
    {
      "check_id": "azure.entra.privileged_role_assignment",
      "api": "authorization",
      "reason": "Azure API returned HTTP 403 — grant the app registration Reader (and Security Reader for Defender) on the subscription."
    }
  ]
}
```

The Integrations UI surfaces degraded check IDs after verify. Scans still run; affected checks may report **no data** until permissions are fixed.

## Release 4 collectors

| Collector | Check | Composite |
|---|---|---|
| Resource Graph VM inventory | `azure.compute.instance_public_ip` | Data protection / network boundary |
| Activity Log diagnostic settings | `azure.logging.not_enabled` | Logging & monitoring |
| Entra / Azure RBAC | `azure.entra.privileged_role_assignment` | Identity governance |
| Defender for Cloud | `azure.defender.not_enabled` | Logging & monitoring |
| Storage accounts | `azure.storage.public_blob_access` | Data protection / network boundary |

See [multi-cloud-collectors.md](./multi-cloud-collectors.md) for scan pipeline details.

## Management groups (deferred)

Org-wide onboarding via management-group scope is planned; connect each subscription individually for now.
