# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Growatt solar inverters and batteries in Gladys, through the Growatt cloud: an OpenAPI V1
  token (recommended) or the ShinePhone account, for the Europe, North America, Australia and
  China servers.
- One device per plant: production power, production of the day, production index.
- One device per inverter read in detail (MIN / TL-X / MOD / MIC and SPH; string inverters with
  the ShinePhone account): status, solar power, PV strings, output power, production of the day
  and index, temperature, and when present the battery, the grid meter and the home consumption,
  with kWh indexes for the energy monitoring of Gladys.
- "Solar overview" dashboard widget, "Inverter status changed" scene trigger, "Test the
  connection" action.
- Refresh every 5 minutes by the container itself, within the Growatt limits: readings shared for
  5 minutes, the ShinePhone session kept in `/data`, no retry of refused credentials, a 6-hour
  pause after a Growatt lockout.
- The ShinePhone requests present the User-Agent of the Growatt app, the only one its server
  accepts; a login it still refuses (HTTP 403) is reported as such, with one attempt and a 6-hour
  pause. The OpenAPI token stays the recommended access.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-growatt/commits/main
