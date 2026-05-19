// =============================================================================
// Orbit — Bring Your Own Cloud (BYOC) Azure deployment.
//
// Provisions a complete Orbit stack inside the client's Azure subscription:
//   - Container App Environment (Consumption tier — pay-per-use, scales to zero)
//   - Two Container Apps:
//       orbit-backend   (public ingress, serves /api + the bundled frontend)
//       orbit-scheduler (internal ingress, OR-Tools CP-SAT)
//   - Azure Database for PostgreSQL Flexible Server (Burstable B1ms, ~$13/mo)
//   - Key Vault holding SESSION_SECRET, MS_CLIENT_SECRET, postgres password
//   - User-assigned managed identity that lets the Container Apps read those
//     secrets (scoped to "Key Vault Secrets User" — least-privilege)
//   - Log Analytics workspace (required by Container Apps for telemetry)
//
// The client only needs to provide their Entra app registration's client ID +
// secret + tenant ID, plus an admin email for first sign-in. SESSION_SECRET
// and Postgres password are generated at deploy time.
//
// After deploy, two outputs matter:
//   appUrl        → paste into the Entra app reg's "Redirect URIs"
//   redirectUri   → already includes the /api/auth/callback suffix
// =============================================================================

// -----------------------------------------------------------------------------
// Parameters
// -----------------------------------------------------------------------------

@description('Azure region for all resources. Defaults to the resource group region.')
param location string = resourceGroup().location

@description('Short prefix used to name every resource (e.g. "orbit", "orbit-prod"). Lowercase letters and numbers only.')
@minLength(3)
@maxLength(11)
param namePrefix string = 'orbit'

@description('Email of the first admin user for sign-in. Must match an account in the Entra tenant below.')
param adminEmail string

@description('Microsoft Entra (Azure AD) tenant ID. The directory hosting your Orbit Entra app registration.')
param msTenantId string

@description('Application (client) ID from your Entra app registration.')
param msClientId string

@description('Client secret VALUE (not the secret ID) from your Entra app registration. Stored in Key Vault.')
@secure()
param msClientSecret string

@description('Container image for orbit-backend. Override only if you fork and host your own.')
param backendImage string = 'ghcr.io/eholmes-dev/orbit-backend:latest'

@description('Container image for orbit-scheduler. Override only if you fork and host your own.')
param schedulerImage string = 'ghcr.io/eholmes-dev/orbit-scheduler:latest'

// Bicep only allows `newGuid()` in parameter defaults — that's why these
// two secrets are parameters with auto-generated defaults rather than vars.
// The client doesn't see or paste them; Bicep generates them at deploy time
// and stores them in Key Vault.
@description('Auto-generated session secret. Leave at default; Bicep produces a strong value at deploy time.')
@secure()
param sessionSecret string = '${newGuid()}${newGuid()}'

@description('Postgres admin password. Leave at default to auto-generate; will be stored in Key Vault either way.')
@secure()
param postgresAdminPassword string = '${take(newGuid(), 8)}Aa1!${newGuid()}'

// -----------------------------------------------------------------------------
// Derived names
// -----------------------------------------------------------------------------

// `uniqueString` keeps the global names (Key Vault, Postgres, Container App
// FQDN) free of collisions across subscriptions.
var suffix = take(uniqueString(resourceGroup().id), 6)

var logWorkspaceName = '${namePrefix}-logs-${suffix}'
var keyVaultName = '${namePrefix}-kv-${suffix}'
var postgresServerName = '${namePrefix}-pg-${suffix}'
var managedIdentityName = '${namePrefix}-identity'
var containerAppEnvName = '${namePrefix}-cae'
var backendAppName = '${namePrefix}-backend'
var schedulerAppName = '${namePrefix}-scheduler'

// -----------------------------------------------------------------------------
// Log Analytics — Container Apps Environment needs one
// -----------------------------------------------------------------------------

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logWorkspaceName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// -----------------------------------------------------------------------------
// Managed identity — used by both Container Apps to read Key Vault secrets
// -----------------------------------------------------------------------------

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
}

// -----------------------------------------------------------------------------
// Key Vault + secrets
// -----------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForTemplateDeployment: false
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource sessionSecretEntry 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'session-secret'
  properties: { value: sessionSecret }
}

resource msClientSecretEntry 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ms-client-secret'
  properties: { value: msClientSecret }
}

resource postgresPasswordEntry 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-password'
  properties: { value: postgresAdminPassword }
}

// Role: Key Vault Secrets User (read-only on secret values). Scoped to the
// vault; principal is our user-assigned managed identity.
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, managedIdentity.id, keyVaultSecretsUserRoleId)
  properties: {
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

// -----------------------------------------------------------------------------
// PostgreSQL Flexible Server
// -----------------------------------------------------------------------------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'orbit'
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      // Public ingress + firewall — see the firewall rules below. Private
      // VNet integration is a future iteration (adds VNet + private DNS zone,
      // ~1 extra day of template work).
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource orbitDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: 'orbit'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow connections from any Azure service in any subscription. This is a
// lock-relaxing rule but the password lives in Key Vault and our managed
// identity is the only thing that can read it. For tighter security a
// future template iteration should switch to VNet integration with a
// private endpoint.
resource pgFirewallAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// -----------------------------------------------------------------------------
// Container Apps Environment
// -----------------------------------------------------------------------------

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Scheduler — internal ingress only (backend talks to it on the internal VNet)
// -----------------------------------------------------------------------------

resource schedulerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: schedulerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    environmentId: containerAppEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8000
        transport: 'http'
        allowInsecure: true
      }
    }
    template: {
      containers: [
        {
          name: 'scheduler'
          image: schedulerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Backend — public ingress; the URL the client opens after deploy
// -----------------------------------------------------------------------------

// Pull KV secrets into the Container App secret store (referenced via
// `secretref:` below in env vars). The Container App's managed identity
// must already have Key Vault Secrets User access (kvRoleAssignment above).
resource backendApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: backendAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    environmentId: containerAppEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'session-secret'
          keyVaultUrl: sessionSecretEntry.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'ms-client-secret'
          keyVaultUrl: msClientSecretEntry.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'postgres-password'
          keyVaultUrl: postgresPasswordEntry.properties.secretUri
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: backendImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            // Container Apps can pass Key Vault secrets as env vars but
            // can't interpolate them into composed strings. So we pass the
            // Postgres parts separately — backend-entrypoint.sh composes
            // DATABASE_URL from them at container start.
            { name: 'PG_HOST', value: postgres.properties.fullyQualifiedDomainName }
            { name: 'PG_USER', value: 'orbit' }
            { name: 'PG_DATABASE', value: 'orbit' }
            { name: 'PG_PASSWORD', secretRef: 'postgres-password' }
            // prisma-shim falls back to DATABASE_URL when DIRECT_URL is
            // unset — the bundled DB needs only one connection string.
            { name: 'DIRECT_URL', value: '' }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
            { name: 'MS_CLIENT_SECRET', secretRef: 'ms-client-secret' }
            { name: 'MS_TENANT_ID', value: msTenantId }
            { name: 'MS_CLIENT_ID', value: msClientId }
            { name: 'MS_ADMIN_EMAILS', value: adminEmail }
            {
              name: 'SCHEDULER_URL'
              value: 'https://${schedulerApp.properties.configuration.ingress.fqdn}'
            }
            // External URL the client uses to reach the backend. We can't
            // reference `backendApp.properties.configuration.ingress.fqdn`
            // here (self-reference is forbidden in Bicep), so we compose the
            // FQDN from the Container App Environment's `defaultDomain` +
            // the app name — the same format the platform produces.
            {
              name: 'APP_BASE_URL'
              value: 'https://${backendAppName}.${containerAppEnv.properties.defaultDomain}'
            }
            {
              name: 'BACKEND_PUBLIC_URL'
              value: 'https://${backendAppName}.${containerAppEnv.properties.defaultDomain}'
            }
            {
              name: 'MS_REDIRECT_URI'
              value: 'https://${backendAppName}.${containerAppEnv.properties.defaultDomain}/api/auth/callback'
            }
            { name: 'NODE_OPTIONS', value: '--dns-result-order=ipv4first' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    kvRoleAssignment
    orbitDatabase
  ]
}

// -----------------------------------------------------------------------------
// Outputs — what the client copies into their Entra app registration
// -----------------------------------------------------------------------------

@description('Public URL of the deployed Orbit app. Open this in a browser after deploy.')
output appUrl string = 'https://${backendApp.properties.configuration.ingress.fqdn}'

@description('OAuth redirect URI to register in your Entra app registration.')
output redirectUri string = 'https://${backendApp.properties.configuration.ingress.fqdn}/api/auth/callback'

@description('Postgres server hostname (for manual queries via psql or pgAdmin).')
output postgresHost string = postgres.properties.fullyQualifiedDomainName

@description('Name of the Key Vault holding deploy-time secrets.')
output keyVaultName string = keyVault.name
