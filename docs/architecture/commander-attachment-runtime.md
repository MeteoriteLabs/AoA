# Commander attachment runtime boundary

Commander file selection uploads through the authenticated, company-scoped asset
endpoint. The composer represents each completed upload as a typed `asset`
Commander input reference containing the asset ID, filename, content type, byte
size, and governed `/api/assets/:assetId/content` route. That reference is included
in the submitted Commander context and remains in the composer when the request
fails before the server accepts it.

This does **not** yet give the active CLI provider raw file bytes or extracted file
content. The current Commander adapter has no company-scoped asset-read contract,
and passing storage object keys or host-local paths into a provider would bypass
the asset authorization boundary.

The follow-up runtime implementation must resolve asset IDs server-side, verify
company ownership for the current Commander actor, and expose content through a
governed read tool or adapter capability. Text extraction, byte limits, supported
formats, and vision-capable provider behavior must be explicit. Until that exists,
the composer accurately presents files as uploaded and referenced, not as already
interpreted by Commander.
