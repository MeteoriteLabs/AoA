---
title: Secrets
summary: Secrets CRUD
---

Manage encrypted secrets that agents reference in their environment configuration.

## List Secrets

```
GET /api/companies/{companyId}/secrets
```

Returns secret metadata (not decrypted values).

## Create Secret

```
POST /api/companies/{companyId}/secrets
{
  "name": "anthropic-api-key",
  "value": "sk-ant-..."
}
```

The value is encrypted at rest. Only the secret ID and metadata are returned.

## Update Secret Metadata

```
PATCH /api/secrets/{secretId}
{
  "name": "new-name",
  "description": "updated description",
  "externalRef": "arn:aws:secretsmanager:..."
}
```

Updates metadata only — `name`, `description`, and `externalRef`. Does **not** accept a `value` field and does not create a new secret version. To rotate the encrypted value, use the rotate route below.

## Rotate Secret Value

```
POST /api/secrets/{secretId}/rotate
{
  "value": "sk-ant-new-value...",
  "externalRef": "arn:aws:secretsmanager:..."
}
```

Replaces the encrypted value and increments the version number. `externalRef` is optional (used when the secret is stored in an external provider such as AWS Secrets Manager). Agents referencing `"version": "latest"` automatically get the new value on next heartbeat.

## Delete Secret

```
DELETE /api/secrets/{secretId}
```

Permanently deletes the secret and all its versions. Returns `{ "ok": true }` on success.

## Using Secrets in Agent Config

Reference secrets in agent adapter config instead of inline values:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": {
      "type": "secret_ref",
      "secretId": "{secretId}",
      "version": "latest"
    }
  }
}
```

The server resolves and decrypts secret references at runtime, injecting the real value into the agent process environment.
