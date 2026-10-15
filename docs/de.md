# Growatt

Verfolge deine **Growatt-Solarwechselrichter und -Batterien** in Gladys: Solarproduktion, Energie
des Tages und Produktionszähler, Batteriestand und -leistung, Netzbezug und Einspeisung,
Hausverbrauch, Status des Wechselrichters. Die Daten kommen aus der Growatt-Cloud (ShineServer,
die ShinePhone-App) und werden alle 5 Minuten gelesen: im Takt, in dem die Growatt-Datenlogger
hochladen. Die Integration liest nur und ändert nie eine Einstellung des Wechselrichters.

> Ohne die Hardware entwickelt: Rückmeldungen sind willkommen. Diese Integration steht in keiner
> Verbindung zu Growatt.

## Voraussetzungen

- Eine Growatt-Anlage, die in der ShinePhone-App oder auf server.growatt.com sichtbar ist, mit
  einem Datenlogger (ShineWiFi, ShineLAN, ShineLink), der online ist.
- Einer der beiden Zugänge:
  - ein **OpenAPI-Token** (empfohlen). Manche Konten können es in den Kontoeinstellungen auf
    server.growatt.com selbst erstellen; sonst frag den Growatt-Support oder deinen Installateur;
  - **Benutzername und Passwort der ShinePhone-App**.
- Gladys 5.1 oder neuer, mit Internetzugang.

## Konfiguration

Öffne den Tab **Konfiguration** der Integration.

### OpenAPI-Token (empfohlen)

Wähle **OpenAPI-Token** als Verbindungsart und füge das Token ein. Die OpenAPI ist die
Schnittstelle, die Growatt für Software von Drittanbietern dokumentiert: keine Anmeldung, nichts
wird von der Integration gespeichert. Detaildaten gibt es für die Familie **MIN** (MIN, TL-X,
TL-XH, MOD, MIC) und die Hybride **SPH**; die anderen Geräte zählen in den Summen der Anlage.

### ShinePhone-Konto

Wähle **ShinePhone-Konto** und gib Benutzername und Passwort der App ein. Diese Schnittstelle ist
von Growatt nicht dokumentiert, und ihr Server **sperrt ein Konto, das sich zu oft anmeldet**
(Fehler 507, für etwa einen Tag). Die Integration meldet sich daher einmal an, behält die Sitzung
in ihrem Volume `/data` (nie das Passwort) und nutzt sie wieder, auch nach einem Neustart; sie
meldet sich erst wieder an, wenn die Sitzung abläuft, und nie zweimal innerhalb von 10 Minuten.
Detaildaten gibt es für String-Wechselrichter, TL-X / MIN und SPH (MIX).

### Weitere Einstellungen

- **Growatt-Server**: die Region, in der das Konto angelegt wurde (Europa und andere Regionen,
  Nordamerika, Australien und Neuseeland, China).
- **Zu verfolgende Anlagen**: leer für alle Anlagen des Kontos, oder die Anlagen-IDs, durch Kommas
  getrennt.
- **Aktualisierungsintervall**: standardmäßig 5 Minuten, oder 10, 15, 30. Schneller als alle
  5 Minuten lehnt Growatt ab.
- **Sprache der Funktionsnamen**: die Namen der Funktionen beim Hinzufügen eines Geräts und die
  Sprache des Wechselrichterstatus (standardmäßig Französisch).

Speichere und klicke dann auf **Verbindung testen**: Die Meldung nennt die gefundenen Anlagen und
Wechselrichter. Die Geräte erscheinen im Tab **Entdecken**: Füge die hinzu, die du möchtest.

## Geräte

### Anlage

Ein Gerät pro Growatt-Anlage, mit den Summen, die Growatt für die ganze Anlage berechnet:

| Funktion            | Einheit | Bedeutung                                   |
| ------------------- | ------- | ------------------------------------------- |
| Produktionsleistung | W       | Leistung, die die Anlage gerade produziert  |
| Produktion heute    | kWh     | Seit Mitternacht produzierte Energie        |
| Produktionszähler   | kWh     | Seit der Inbetriebnahme produzierte Energie |

### Wechselrichter

Ein Gerät pro Wechselrichter, den die API im Detail liest. Die Funktionen folgen dem, was der
Wechselrichter meldet: Eine Batterie erscheint nur bei einer Anlage, die eine hat, die Netz- und
Hausfunktionen nur, wenn ein Growatt-Zähler (oder eine Stromzange) angeschlossen ist.

| Funktion                                        | Einheit | Bedeutung                                          |
| ----------------------------------------------- | ------- | -------------------------------------------------- |
| Status Wechselrichter                           | Text    | Normal, Wartend, Störung, Offline                  |
| Solarleistung                                   | W       | Leistung der Solarmodule                           |
| Spannung PV1, Strom PV1, PV2…                   | V, A    | Jeder Modulstrang                                  |
| Ausgangsleistung Wechselrichter                 | W       | Wechselstromleistung des Wechselrichters           |
| Produktion heute, Produktionszähler             | kWh     | Solarenergie des Tages, seit der Inbetriebnahme    |
| Batteriestand                                   | %       | Ladezustand                                        |
| Ladeleistung Batterie, Entladeleistung Batterie | W       | Leistung in die Batterie und aus ihr heraus        |
| Lade-Index Batterie, Entlade-Index Batterie     | kWh     | Seit Beginn geladene und entladene Energie         |
| Netzbezugsleistung, Netzeinspeiseleistung       | W       | Aus dem Netz bezogene, ins Netz gespeiste Leistung |
| Netzbezugszähler, Netzeinspeisezähler           | kWh     | Aus dem Netz bezogene, ins Netz gespeiste Energie  |
| Hausverbrauch, Zähler Hausverbrauch             | W, kWh  | Vom Zähler gemessener Verbrauch des Hauses         |
| Temperatur Wechselrichter                       | °C      | Temperatur des Wechselrichters                     |

Eine zum ersten Mal gesehene Funktion (eine Batterie, die morgens aufwacht) wird im Tab Entdecken
als **Aktualisieren** angeboten. Eine Funktion wird nie entfernt: Eine nachts leer gelesene
Batterie behält ihre Funktionen.

## Energieüberwachung

Die Zähler (Produktion, Batterie, Netz, Haus) sind kWh-Zähler, die die Energieüberwachung von
Gladys in Energie pro halbe Stunde umrechnet. Die Anlage und ihre Wechselrichter zählen **dieselbe
Produktion**: Füge für die Produktion die Anlage **oder** ihre Wechselrichter zur
Energieüberwachung hinzu, nicht beides, sonst wird sie doppelt gezählt. Die Growatt-Zähler stehen
um Mitternacht manchmal auf 0 oder gehen ein wenig zurück: Die Integration filtert diese Fehler.

## Dashboard-Widget

**Solarübersicht**: Wähle in seinen Einstellungen eine Anlage oder einen Wechselrichter. Es zeigt
Live-Kacheln (Produktion, Energie des Tages, Batterie, Netzbezug und Einspeisung, Haus), die
Produktionskurve des Tages und den Status des Wechselrichters mit der Zeit seiner letzten Daten.

## Szenen-Auslöser

**Status des Wechselrichters geändert**: löst aus, wenn ein Wechselrichter auf Störung geht, sich
nicht mehr bei der Growatt-Cloud meldet (offline), wartet (nachts) oder wieder normal läuft.
Filter: der Wechselrichter, der neue Status. Variablen für die Aktionen: der neue Status (Code und
Text), der vorherige Status, der Name des Wechselrichters. Die erste Messung nach einem Start löst
ihn nie aus.

## Aktion

**Verbindung testen** (Tab Konfiguration): liest das Konto und nennt die gefundenen Anlagen und
Wechselrichter, die nur in den Anlagensummen gezählten Geräte oder den Grund eines Fehlers. Die
Aktion nutzt die vor weniger als 5 Minuten gelesenen Daten: Ein erneuter Klick vervielfacht die Anfragen
an Growatt nicht.

## Szenenbeispiele

- **Vor einer Störung warnen**: Auslöser „Status des Wechselrichters geändert“ mit den Status
  Störung und Offline → die Nachricht „Der Wechselrichter {{device_name}} ist jetzt
  {{status_label}}“ senden.
- **Den Überschuss nutzen**: alle 5 Minuten, wenn die Netzeinspeiseleistung über 1500 W und der
  Batteriestand über 90 % liegt → die Steckdose des Warmwasserbereiters einschalten.
- **Abendbilanz**: jeden Tag um 21 Uhr → eine Nachricht mit der Tagesproduktion der Anlage senden.

## Fehlerbehebung

- **„Growatt lehnt das Token ab“**: Prüfe das Token und die Serverregion. Die Integration ruft
  Growatt nicht mehr auf, bis sich die Konfiguration ändert.
- **„Growatt lehnt Benutzername oder Passwort ab“**: Prüfe sie in der ShinePhone-App und die
  Region. Kein neuer Versuch, bis sich die Konfiguration ändert, um das Konto zu schützen.
- **„Growatt hat das Konto gesperrt“**: Der ShinePhone-Server hat das Konto nach zu vielen
  Anmeldungen gesperrt (andere Apps, die mit demselben Konto angemeldet sind, zählen auch). Die
  Integration wartet 6 Stunden, bevor sie es erneut versucht, auch nach einem Neustart. Ein Token
  vermeidet das Problem.
- **„Die Growatt-Cloud antwortet nicht“**: Die Messwerte kommen von selbst wieder.
- **Ein Wechselrichter zeigt Offline**: Sein Datenlogger lädt nicht mehr hoch (WLAN, Strom).
- Für Details setze die Variable `LOG_LEVEL=debug` der Integration und sieh dir ihre Protokolle
  an: Die Protokolle enthalten nie das Token oder das Passwort.

## Einschränkungen

- Ohne die Hardware und ohne Growatt-Konto entwickelt: Die Feldnamen stammen aus der Bibliothek
  growattServer und der Home-Assistant-Integration. Rückmeldungen sind willkommen, vor allem zu
  den SPH (die Einheit ihrer Netzleistungen) und zu den Status der selteneren Familien.
- Nur lesend: Keine Einstellung des Wechselrichters (Laden, Entladen, Einspeisebegrenzung) lässt
  sich ändern.
- Die Daten sind die der Growatt-Cloud: bestenfalls 5 Minuten alt, und nicht vorhanden, wenn die
  Cloud ausfällt.
- Detaildaten: MIN / TL-X / MOD / MIC und SPH mit einem Token; String-Wechselrichter, TL-X und SPH
  mit einem Konto. Andere Familien (MAX, SPA, Speicher, NOAH…) nur in den Anlagensummen.
- Anfragen pro Aktualisierung: mit einem Token 2 pro Anlage, 1 pro MIN, 2 pro SPH und die
  Geräteliste einmal pro Stunde; mit einem Konto 1 oder 2 pro Anlage, 1 pro Wechselrichter, 2 pro
  SPH.
