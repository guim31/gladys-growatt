// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted", like
// the rest of guim31's integrations; the vocabulary follows the Gladys
// interface (front/src/config/i18n). Brand and model names stay as they are.
//
//   - NAMES    : the feature names, in the language chosen in the config
//                (a device integration does not know the user's language);
//   - STATUS   : the inverter states, as published in the status feature;
//   - TEXT     : fixed multi-language texts (connection status, widget);
//   - MESSAGES : the texts built from values (action report, errors).
//
// test/i18n.test.js checks that every entry carries the four languages,
// none is empty or too long, and German never uses the polite form.
// -----------------------------------------------------------------------------

export { LANGUAGES } from './config.js';

/** Feature names, one table per language. `pv` builds the PV string names. */
export const NAMES = {
  en: {
    power: 'Production power',
    pv_power: 'Solar power',
    pv_voltage: (n) => `PV${n} voltage`,
    pv_current: (n) => `PV${n} current`,
    ac_power: 'Inverter output power',
    production_today: 'Production today',
    production_total: 'Production index',
    temperature: 'Inverter temperature',
    status: 'Inverter status',
    battery_level: 'Battery level',
    battery_charge_power: 'Battery charge power',
    battery_discharge_power: 'Battery discharge power',
    battery_charge_total: 'Battery charge index',
    battery_discharge_total: 'Battery discharge index',
    grid_import_power: 'Grid import power',
    grid_export_power: 'Grid export power',
    grid_import_total: 'Grid import index',
    grid_export_total: 'Grid export index',
    load_power: 'Home consumption',
    load_total: 'Home consumption index',
  },
  fr: {
    power: 'Puissance de production',
    pv_power: 'Puissance solaire',
    pv_voltage: (n) => `Tension PV${n}`,
    pv_current: (n) => `Intensité PV${n}`,
    ac_power: "Puissance de sortie de l'onduleur",
    production_today: "Production aujourd'hui",
    production_total: 'Index de production',
    temperature: "Température de l'onduleur",
    status: "État de l'onduleur",
    battery_level: 'Niveau de batterie',
    battery_charge_power: 'Puissance de charge batterie',
    battery_discharge_power: 'Puissance de décharge batterie',
    battery_charge_total: 'Index de charge batterie',
    battery_discharge_total: 'Index de décharge batterie',
    grid_import_power: 'Puissance importée du réseau',
    grid_export_power: 'Puissance exportée vers le réseau',
    grid_import_total: 'Index import réseau',
    grid_export_total: 'Index export réseau',
    load_power: 'Consommation de la maison',
    load_total: 'Index de consommation maison',
  },
  de: {
    power: 'Produktionsleistung',
    pv_power: 'Solarleistung',
    pv_voltage: (n) => `Spannung PV${n}`,
    pv_current: (n) => `Strom PV${n}`,
    ac_power: 'Ausgangsleistung Wechselrichter',
    production_today: 'Produktion heute',
    production_total: 'Produktionszähler',
    temperature: 'Temperatur Wechselrichter',
    status: 'Status Wechselrichter',
    battery_level: 'Batteriestand',
    battery_charge_power: 'Ladeleistung Batterie',
    battery_discharge_power: 'Entladeleistung Batterie',
    battery_charge_total: 'Lade-Index Batterie',
    battery_discharge_total: 'Entlade-Index Batterie',
    grid_import_power: 'Netzbezugsleistung',
    grid_export_power: 'Netzeinspeiseleistung',
    grid_import_total: 'Netzbezugszähler',
    grid_export_total: 'Netzeinspeisezähler',
    load_power: 'Hausverbrauch',
    load_total: 'Zähler Hausverbrauch',
  },
  es: {
    power: 'Potencia de producción',
    pv_power: 'Potencia solar',
    pv_voltage: (n) => `Tensión FV${n}`,
    pv_current: (n) => `Corriente FV${n}`,
    ac_power: 'Potencia de salida del inversor',
    production_today: 'Producción de hoy',
    production_total: 'Índice de producción',
    temperature: 'Temperatura del inversor',
    status: 'Estado del inversor',
    battery_level: 'Nivel de batería',
    battery_charge_power: 'Potencia de carga de la batería',
    battery_discharge_power: 'Potencia de descarga de la batería',
    battery_charge_total: 'Índice de carga de la batería',
    battery_discharge_total: 'Índice de descarga de la batería',
    grid_import_power: 'Potencia importada de la red',
    grid_export_power: 'Potencia exportada a la red',
    grid_import_total: 'Índice de importación de la red',
    grid_export_total: 'Índice de exportación de la red',
    load_power: 'Consumo de la vivienda',
    load_total: 'Índice de consumo de la vivienda',
  },
};

/** The inverter states, as written in the status feature and the widget. */
export const STATUS_LABELS = {
  en: {
    normal: 'Normal',
    waiting: 'Waiting',
    fault: 'Fault',
    offline: 'Offline',
    unknown: 'Unknown',
  },
  fr: {
    normal: 'Normal',
    waiting: 'En attente',
    fault: 'En défaut',
    offline: 'Hors ligne',
    unknown: 'Inconnu',
  },
  de: {
    normal: 'Normal',
    waiting: 'Wartend',
    fault: 'Störung',
    offline: 'Offline',
    unknown: 'Unbekannt',
  },
  es: {
    normal: 'Normal',
    waiting: 'En espera',
    fault: 'En fallo',
    offline: 'Sin conexión',
    unknown: 'Desconocido',
  },
};

/** Fixed texts, each in the four languages. */
export const TEXT = {
  notConfigured: {
    en: 'Choose the connection mode and enter your Growatt token or account.',
    fr: 'Choisissez le mode de connexion et saisissez votre jeton ou votre compte Growatt.',
    de: 'Wähle die Verbindungsart und gib dein Growatt-Token oder dein Konto ein.',
    es: 'Elija el modo de conexión e introduzca su token o su cuenta Growatt.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  authToken: {
    en: 'Growatt refused the token: check it, and the server region.',
    fr: 'Growatt refuse le jeton : vérifiez-le, ainsi que la région du serveur.',
    de: 'Growatt lehnt das Token ab: Prüfe es und die Serverregion.',
    es: 'Growatt rechaza el token: compruébelo, así como la región del servidor.',
  },
  authPassword: {
    en: 'Growatt refused the username or password: check them, and the server region.',
    fr: "Growatt refuse l'identifiant ou le mot de passe : vérifiez-les, ainsi que la région du serveur.",
    de: 'Growatt lehnt Benutzername oder Passwort ab: Prüfe sie und die Serverregion.',
    es: 'Growatt rechaza el usuario o la contraseña: compruébelos, así como la región del servidor.',
  },
  unreachable: {
    en: 'The Growatt cloud does not answer: the readings resume on their own.',
    fr: 'Le cloud Growatt ne répond pas : les relevés reprendront tout seuls.',
    de: 'Die Growatt-Cloud antwortet nicht: Die Messwerte kommen von selbst wieder.',
    es: 'La nube Growatt no responde: las lecturas se reanudarán solas.',
  },
  noPlant: {
    en: 'This Growatt account has no plant.',
    fr: "Ce compte Growatt n'a aucune installation.",
    de: 'Dieses Growatt-Konto hat keine Anlage.',
    es: 'Esta cuenta Growatt no tiene ninguna instalación.',
  },
  widgetPickDevice: {
    en: 'Choose a Growatt plant or inverter in the widget settings.',
    fr: 'Choisissez une installation ou un onduleur Growatt dans les réglages du widget.',
    de: 'Wähle in den Widget-Einstellungen eine Growatt-Anlage oder einen Wechselrichter.',
    es: 'Elija una instalación o un inversor Growatt en los ajustes del widget.',
  },
  widgetUnknownDevice: {
    en: 'This device is no longer in Gladys: choose another one in the widget settings.',
    fr: "Cet appareil n'est plus dans Gladys : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Gerät ist nicht mehr in Gladys: Wähle in den Widget-Einstellungen ein anderes.',
    es: 'Este dispositivo ya no está en Gladys: elija otro en los ajustes del widget.',
  },
  chartTitle: {
    en: 'Solar production',
    fr: 'Production solaire',
    de: 'Solarproduktion',
    es: 'Producción solar',
  },
  tileProduction: { en: 'Production', fr: 'Production', de: 'Produktion', es: 'Producción' },
  tileToday: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  tileBattery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  tileImport: { en: 'From grid', fr: 'Import réseau', de: 'Netzbezug', es: 'De la red' },
  tileExport: { en: 'To grid', fr: 'Export réseau', de: 'Einspeisung', es: 'A la red' },
  tileHome: { en: 'Home', fr: 'Maison', de: 'Haus', es: 'Vivienda' },
  statusLabel: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
  lastDataLabel: {
    en: 'Last data',
    fr: 'Dernières données',
    de: 'Letzte Daten',
    es: 'Últimos datos',
  },
};

/** Texts built from values, each returning the four languages. */
export const MESSAGES = {
  /** Account paused after a Growatt "507". */
  locked: (untilText) => ({
    en: `Growatt locked the account after too many connections: new attempt after ${untilText}.`,
    fr: `Growatt a bloqué le compte après trop de connexions : nouvel essai après ${untilText}.`,
    de: `Growatt hat das Konto nach zu vielen Verbindungen gesperrt: neuer Versuch nach ${untilText}.`,
    es: `Growatt bloqueó la cuenta tras demasiadas conexiones: nuevo intento después de ${untilText}.`,
  }),

  /** The ShinePhone server refused the login request itself (HTTP 403). */
  blocked: (untilText) => ({
    en: `The Growatt server refused the ShinePhone login (HTTP 403): use an OpenAPI token. New attempt after ${untilText}.`,
    fr: `Le serveur Growatt refuse la connexion ShinePhone (HTTP 403) : utilisez un jeton OpenAPI. Nouvel essai après ${untilText}.`,
    de: `Der Growatt-Server lehnt die ShinePhone-Anmeldung ab (HTTP 403): Nutze ein OpenAPI-Token. Neuer Versuch nach ${untilText}.`,
    es: `El servidor Growatt rechaza el inicio de sesión ShinePhone (HTTP 403): use un token OpenAPI. Nuevo intento después de ${untilText}.`,
  }),

  /** The report of the "Test the connection" action. */
  report: ({ plants, devices, unsupported }) => {
    const ids = unsupported.slice(0, 3).join(', ');
    return {
      en:
        `Connected: ${plants} plant(s), ${devices} inverter(s) with detailed data.` +
        (unsupported.length > 0 ? ` Plant totals only for: ${ids}.` : ''),
      fr:
        `Connecté : ${plants} installation(s), ${devices} onduleur(s) avec données détaillées.` +
        (unsupported.length > 0 ? ` Totaux de l'installation seulement pour : ${ids}.` : ''),
      de:
        `Verbunden: ${plants} Anlage(n), ${devices} Wechselrichter mit Detaildaten.` +
        (unsupported.length > 0 ? ` Nur Anlagensummen für: ${ids}.` : ''),
      es:
        `Conectado: ${plants} instalación(es), ${devices} inversor(es) con datos detallados.` +
        (unsupported.length > 0 ? ` Solo totales de la instalación para: ${ids}.` : ''),
    };
  },

  /** A failure, with the technical reason (never a secret: see src/account.js). */
  failed: (reason) => ({
    en: `Connection failed: ${reason}`,
    fr: `Échec de la connexion : ${reason}`,
    de: `Verbindung fehlgeschlagen: ${reason}`,
    es: `La conexión ha fallado: ${reason}`,
  }),
};

/** The text of `table` in `language`, English when missing. */
export function inLanguage(table, language) {
  return table[language] ?? table.en;
}
