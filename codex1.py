import io

# ---------------- 1. the checker: per-stream marker, not a scalar ----------------
p = "scripts/lib/campaign-fault-matrix.mjs"
s = io.open(p, encoding="utf-8", newline="").read()

old = """      if (row.scrubberMarkerObserved !== true) {
        v("evidence:redaction_marker_not_observed", `case ${id}: scrubberMarkerObserved=${JSON.stringify(row.scrubberMarkerObserved ?? null)} — the scrubber's own replacement marker was NOT observed on the run's streams, so the clean arm above is not shown to be its work (a probe that cannot go red is not a probe)`);
      }
      // Non-vacuity, as its own row fact: a scan over ZERO bytes is "clean" and proves nothing.
      const observed = isPlainObject(row.streamBytesObserved) ? row.streamBytesObserved : null;
      for (const stream of (Array.isArray(rc?.streams) ? rc.streams.map(String) : [])) {
        const bytes = observed ? observed[stream] : undefined;
        if (!(typeof bytes === "number" && bytes > 0)) {
          v("evidence:redaction_stream_vacuous", `case ${id}: streamBytesObserved.${stream}=${JSON.stringify(bytes ?? null)} — a scan over an empty stream is vacuously clean`);
        }
      }"""
assert s.count(old) == 1
new = """      // ★ PER STREAM, NOT A SCALAR (Codex P2, and the finding was right). A single
      // `scrubberMarkerObserved: true` would let a row pass on having seen the marker on ONE
      // declared stream while the other never demonstrates the scrubber acting at all — which
      // contradicts the declaration, whose `streams` list exists precisely because a scrubbed event
      // stream beside an unscrubbed log stream is still a leak. So the marker is recorded and
      // checked per declared stream, the same shape `streamBytesObserved` already used.
      const markerByStream = isPlainObject(row.scrubberMarkerObservedOnStream) ? row.scrubberMarkerObservedOnStream : null;
      const observed = isPlainObject(row.streamBytesObserved) ? row.streamBytesObserved : null;
      const declaredStreams = Array.isArray(rc?.streams) ? rc.streams.map(String) : [];
      for (const stream of declaredStreams) {
        if (markerByStream?.[stream] !== true) {
          v("evidence:redaction_marker_not_observed", `case ${id}: scrubberMarkerObservedOnStream.${stream}=${JSON.stringify(markerByStream?.[stream] ?? null)} — the scrubber's own replacement marker was NOT observed on the \\`${stream}\\` stream, so that stream's clean arm is not shown to be its work (a probe that cannot go red is not a probe)`);
        }
        // Non-vacuity, as its own row fact: a scan over ZERO bytes is "clean" and proves nothing.
        const bytes = observed ? observed[stream] : undefined;
        if (!(typeof bytes === "number" && bytes > 0)) {
          v("evidence:redaction_stream_vacuous", `case ${id}: streamBytesObserved.${stream}=${JSON.stringify(bytes ?? null)} — a scan over an empty stream is vacuously clean`);
        }
      }
      // A redaction case that declared NO streams would make both loops above vacuous. The
      // declaration half already reds that (`redaction_stream_missing`), but a bundle is judged
      // against whatever declaration it was given, so the evidence half refuses it too rather than
      // trusting an upstream check it cannot see.
      if (declaredStreams.length === 0) {
        v("evidence:redaction_no_declared_streams", `case ${id}: the declaration names no \\`streams\\`, so every per-stream check above evaluated nothing`);
      }"""
s = s.replace(old, new)

old = """    // must be observed CLEAN on every declared stream, AND the scrubber's own replacement marker
    // must be observed ON those streams. Either alone proves nothing — a clean stream with no
    // marker may be a run that emitted the value nowhere, and a marker with the canary still present
    // is a partial scrub."""
assert s.count(old) == 1
s = s.replace(old, """    // must be observed CLEAN on every declared stream, AND the scrubber's own replacement marker
    // must be observed ON EACH of those streams. Either alone proves nothing — a clean stream with
    // no marker may be a run that emitted the value nowhere, and a marker with the canary still
    // present is a partial scrub.""")
assert "\r" not in s
io.open(p, "w", encoding="utf-8", newline="").write(s)

# ---------------- 2. the tests ----------------
p = "scripts/check-campaign-fault-matrix.test.mjs"
s = io.open(p, encoding="utf-8", newline="").read()
old = """            redactedOnAllStreams: true,
            scrubberMarkerObserved: true,
            streamBytesObserved: Object.fromEntries(c.redactionCase.streams.map((k) => [k, 1024])),"""
assert s.count(old) == 1
s = s.replace(old, """            redactedOnAllStreams: true,
            scrubberMarkerObservedOnStream: Object.fromEntries(c.redactionCase.streams.map((k) => [k, true])),
            streamBytesObserved: Object.fromEntries(c.redactionCase.streams.map((k) => [k, 1024])),""")

old = """  assert.ok(has(row((r) => { r.scrubberMarkerObserved = false; }), "evidence:redaction_marker_not_observed"));"""
assert s.count(old) == 1
s = s.replace(old, """  // ★ PER STREAM (Codex P2): the marker on ONE stream must NOT satisfy a two-stream declaration.
  for (const stream of REQUIRED_REDACTION_STREAMS) {
    assert.ok(has(row((r) => { r.scrubberMarkerObservedOnStream[stream] = false; }), "evidence:redaction_marker_not_observed"), `${stream} false`);
    assert.ok(has(row((r) => { delete r.scrubberMarkerObservedOnStream[stream]; }), "evidence:redaction_marker_not_observed"), `${stream} absent`);
  }
  assert.ok(has(row((r) => { delete r.scrubberMarkerObservedOnStream; }), "evidence:redaction_marker_not_observed"));"""
s = s.replace(old, """  assert.ok(has(row((r) => { r.scrubberMarkerObservedOnStream = {}; }), "evidence:redaction_marker_not_observed"));""" + "\n" + old.replace(
    'r.scrubberMarkerObserved = false; }), "evidence:redaction_marker_not_observed"));',
    'r.scrubberMarkerObservedOnStream = { events: true }; }), "evidence:redaction_marker_not_observed"));'))
assert "\r" not in s
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("checker + tests updated")
