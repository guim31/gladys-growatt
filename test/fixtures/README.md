# Test fixtures

- `gladys-feature-table.json`: the category/type couples, units and poll frequencies the Gladys
  core knows (extracted from the core code), read by `test/gladys-rules.test.js`.
- `openapi/`: answers of the Growatt OpenAPI V1 (`{ error_code, error_msg, data }`).
- `shinephone/`: answers of the ShinePhone API (`newTwoLoginAPI.do`, `newTwoPlantAPI.do`...).

The Growatt answers are **reconstructed**, not captured: the integration was developed without a
Growatt account, the cloud is not reachable from the development sessions, and the test suites of
growattServer and Home Assistant only hold mocks. Their field names, units and shapes follow what
the growattServer library (MIT) and the Home Assistant `growatt_server` integration (Apache-2.0)
read. Plant ids, serial numbers and datalogger numbers are invented. Replace them with real,
anonymized answers (`node scripts/probe.mjs` with a real account prints them masked) as soon as
some are available.
