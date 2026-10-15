# Growatt for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that follows
**Growatt solar inverters and batteries** through the Growatt cloud (ShineServer, the ShinePhone
app): solar production, energy of the day and production index, battery, grid import and export,
home consumption and inverter status. Read only: it never changes a setting of the inverter.

> **Developed without the hardware: feedback welcome.** No Growatt inverter nor account was
> available to build it: it is built and tested against the field names of the
> [growattServer](https://github.com/indykoning/PyPi_GrowattServer) library and of the Home
> Assistant integration, with reconstructed answers of the Growatt cloud. Please report what works
> and what does not in the [issues](https://github.com/guim31/gladys-growatt/issues).

## Features

- **Two ways in**: an **OpenAPI V1 token** (recommended, the documented interface for third-party
  software) or the **ShinePhone account** (username and password, which Growatt may block), for the four Growatt regions
  (Europe and other regions, North America, Australia and New Zealand, China).
- **One device per plant**: production power, production of the day, production index (kWh).
- **One device per inverter** read in detail (MIN / TL-X / TL-XH / MOD / MIC and SPH; string
  inverters through the ShinePhone account): status, solar power, PV string voltages and
  currents, AC output power, production of the day and index, temperature, and when present the
  **battery** (level, charge and discharge power, charge and discharge indexes), the **grid
  meter** (import and export power and indexes) and the **home consumption** (power and index).
- **Energy monitoring of Gladys**: every counter is a kWh index of the category the energy
  monitoring reads (production, battery, grid, home); the midnight glitches of the Growatt
  counters are filtered.
- **Dashboard widget** "Solar overview": live tiles, the production curve of the day, the status.
- **Scene trigger** "Inverter status changed": fault, offline, waiting, normal again.
- **Action** "Test the connection": plants and inverters found, or why it failed.

## Requirements

- Gladys Assistant **5.1.0** or later (widget and scene trigger), with internet access.
- A Growatt plant visible in ShinePhone or on server.growatt.com, its datalogger online.
- An OpenAPI token (some accounts create one in the account settings of server.growatt.com;
  otherwise ask the Growatt support or the installer), or the ShinePhone username and password.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-growatt` (or install **Growatt** from the catalog once it
   is listed there).
2. In **Configuration**, choose the connection mode, enter the token or the account, the server
   region, save, and click **Test the connection**.
3. Open the **Discovery** tab and add the plant and the inverters you want.

The user guide is in [`docs/en.md`](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
[es](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- **The Growatt limits come first.** The dataloggers upload every 5 minutes and the cloud refuses
  an endpoint called twice within 5 minutes (OpenAPI error 10012). The integration refreshes
  every 5 minutes (configurable up to 30), serves any reading younger than 5 minutes from memory
  (a scan, a test, a widget never add requests), and reads the OpenAPI device lists once an hour.
- **The ShinePhone server locks accounts** that log in too often (answer 507, about a day). The
  integration logs in once, keeps the session cookie in `/data` and reuses it across restarts,
  logs in again only when the session expires and never twice within 10 minutes, stops after a
  wrong password until the configuration changes, and pauses 6 hours after a 507 (saved in
  `/data`, restart included).
- **Own timer.** The container refreshes by itself (the core does not poll external devices
  reliably, GladysAssistant/Gladys#3198); the core's poll is a fallback that only runs when the
  timer stalled.
- **Quiet.** Only the changed states are published (a heartbeat every 6 hours for stable ones),
  nothing is logged at info level for a normal refresh, and the token, the password and the
  cookie never reach the logs.

## Limitations

- Read only: charge and discharge schedules, export limits and the other inverter settings are
  out of scope, on purpose.
- Cloud only: the data is the Growatt cloud's, at best 5 minutes old, absent when the cloud is
  down. Local reading (Modbus, Grott) is another integration.
- Detailed data for the families the APIs expose: MIN / TL-X / MOD / MIC and SPH with a token;
  string inverters, TL-X and SPH with an account. MAX, SPA, storage, NOAH and the others are
  counted in the plant totals only.
- Without hardware, some points are assumptions to confirm on real installations: the unit of the
  SPH grid powers through the OpenAPI (W, as Home Assistant reads them), the status codes of the
  less common families, the wrapping of some OpenAPI answers.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests, fake Gladys of the SDK, fake Growatt cloud
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
node scripts/probe.mjs                           # the real cloud, read only (see the script)
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/app.js              start, discovery, refresh, status trigger, action, widget handler
src/account.js          the account: cache, 5-minute rule, refusals, lockout pause
src/growatt/openapi.js  OpenAPI V1 client (token)
src/growatt/classic.js  ShinePhone client (account, session, password hash)
src/growatt/model.js    Growatt answers -> normalized readings (units, vocabularies, statuses)
src/devices.js          readings -> Gladys devices, features and states
src/guards.js           midnight glitches of the Growatt counters
src/poller.js           the container's own refresh timer
src/store.js            /data: session, lockout, features seen
src/widgets.js          "Solar overview" widget
src/i18n.js             every text, in English, French, German and Spanish
scripts/probe.mjs       read-only probe of the real cloud
test/                   node --test; test/fixtures/ holds the Growatt answers, anonymized
```

`test/gladys-rules.test.js` checks every discovered device against the category/type table
extracted from the Gladys core.

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by
hand. A hand-pushed `vX.Y.Z` tag also builds the image and the GitHub Release, but then `version`
in `package.json` and in the manifest (with the `docker_image` tag) must be bumped and committed
before tagging. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [growattServer](https://github.com/indykoning/PyPi_GrowattServer) by Sjoerd Langkemper, Indy
  Koning and contributors (MIT): the endpoints of both APIs, the password hash, the error codes
  and the 507 lockout behavior, the field names behind the fixtures.
- Home Assistant's
  [`growatt_server`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/growatt_server)
  integration (Apache-2.0): which fields carry which value and unit per family, the plant power
  read from `plant/power`, the midnight glitches of the counters, the server regions.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Growatt New Energy. "Growatt",
"ShinePhone" and "ShineServer" are names of their owners.

## License

Apache-2.0
